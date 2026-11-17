// Scoped JSDOM 26 correction for retained, detached sourceless leaf iframes.
// Install before child web compatibility; dispose after it, before root close.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import FrameModule from 'jsdom/lib/jsdom/living/nodes/HTMLFrameElement-impl.js';
import NodeModule from 'jsdom/lib/jsdom/living/nodes/Node-impl.js';
import EventTargetModule from 'jsdom/lib/jsdom/living/events/EventTarget-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };

let active = false;
const object = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const data = (value, key) => {
  if (!object(value)) return;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && Object.hasOwn(d, 'value') ? d.value : undefined;
};
const sameDescriptor = (a, b) => !!a && !!b && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']
  .every(key => Object.hasOwn(a, key) === Object.hasOwn(b, key) && Object.is(a[key], b[key]));

export function installRuntimeDetachedFrameCompat(window, options = {}) {
  const root = data(window, '_globalObject');
  const limitOption = object(options) ? Object.getOwnPropertyDescriptor(options, 'maximumFrames') : undefined;
  const maximumFrames = limitOption?.value ?? 32;
  if (!object(window) || !object(root) || data(root, '_globalProxy') !== window
      || data(root, '_runScripts') !== 'outside-only' || window.Function === Function
      || !object(options) || limitOption && !Object.hasOwn(limitOption, 'value')
      || !Number.isInteger(maximumFrames) || maximumFrames < 1 || maximumFrames > 32) throw Error('DETACHED_FRAME_INVALID_OPTIONS');
  if (active) throw Error('DETACHED_FRAME_ALREADY_INSTALLED');
  if (jsdomPackage.version !== '26.1.0') throw Error('DETACHED_FRAME_UNSUPPORTED_JSDOM');
  const framePrototype = FrameModule.implementation.prototype;
  const eventPrototype = EventTargetModule.implementation.prototype;
  const hooks = [], records = [], frameRecords = new WeakMap();
  const detachedDocuments = new WeakSet(), detachedWindows = new WeakSet();
  const stats = { diagnosticOnly: true, detachedFrameCompatibility: true, nativeParityProven: false,
    sourcelessLeafFramesOnly: true, maximumFrames, trackedFrames: 0, retainedFrames: 0,
    observedAttachments: 0, skippedUnownedFrames: 0, skippedSourcedFrames: 0,
    skippedUntrackedFrames: 0, skippedChangedFrames: 0, skippedNestedFrames: 0,
    frameLimitReached: false, timerCallsSuppressed: 0, closeCallsSuppressed: 0,
    nodeEventsSuppressed: 0, windowEventsSuppressed: 0, preparationFailures: 0,
    detachFailures: 0, disposed: false, disposedRetainedFrames: 0,
    restoredProperties: 0, restoreConflicts: 0, restoreFailures: 0,
    restoredHooks: 0, hookRestoreConflicts: 0, cleanupFailures: 0, forcedTimerCleanups: 0, hostTimersCreated: 0 };
  const count = key => { stats[key] = Math.min(1000000, stats[key] + 1); };
  let pendingFrame;
  const belongs = doc => {
    let current = data(doc, '_defaultView');
    for (let depth = 0; object(current) && depth < 32; depth++) {
      if (current === window || current === root) return true;
      const next = data(current, '_parent');
      if (next === current) return false;
      current = next;
    }
    return false;
  };
  const eligibleAttributes = frame => data(frame, '_localName') === 'iframe'
    && !frame.hasAttributeNS(null, 'src') && !frame.hasAttributeNS(null, 'srcdoc')
    && !frame.hasAttributeNS(null, 'sandbox');
  const restoreProperties = record => {
    for (let index = record.properties.length - 1; index >= 0; index--) {
      const { target, key, previous, next } = record.properties[index];
      try {
        if (!sameDescriptor(Object.getOwnPropertyDescriptor(target, key), next)) { count('restoreConflicts'); continue; }
        if (previous) Object.defineProperty(target, key, previous); else delete target[key];
        count('restoredProperties');
      } catch { count('restoreFailures'); }
    }
    record.properties.length = 0;
  };
  function prepare(frame, backing) {
    if (records.length >= maximumFrames) { stats.frameLimitReached = true; return; }
    const realm = data(backing, '_globalProxy'), document = data(backing, '_document');
    const doc = object(document) ? utils.implForWrapper(document) : undefined;
    const realmFunction = data(realm, 'Function');
    if (!object(realm) || typeof realmFunction !== 'function' || realmFunction === Function || !object(doc)
        || data(backing, '_runScripts') !== 'outside-only' || doc.URL !== 'about:blank') { count('preparationFailures'); return; }
    const record = { frame, realm, backing, document, doc, windowImpl: utils.implForWrapper(realm),
      detached: false, properties: [], originalClose: data(realm, 'close') };
    const add = (key, next) => {
      const previous = Object.getOwnPropertyDescriptor(realm, key);
      Object.defineProperty(realm, key, next);
      record.properties.push({ target: realm, key, previous, next: Object.getOwnPropertyDescriptor(realm, key) });
    };
    try {
      if (typeof record.originalClose !== 'function' || Reflect.has(realm, 'closed')) throw Error('UNSUPPORTED_FRAME');
      for (const key of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'close']) {
        const previous = Object.getOwnPropertyDescriptor(realm, key);
        if (!previous && key === 'requestAnimationFrame') continue;
        if (!previous || !Object.hasOwn(previous, 'value') || typeof previous.value !== 'function'
            || !previous.configurable) throw Error('UNSUPPORTED_FRAME');
        const invoke = (receiver, args) => {
          if (record.detached) {
            count(key === 'close' ? 'closeCallsSuppressed' : 'timerCallsSuppressed');
            return key === 'close' ? undefined : 0;
          }
          return Reflect.apply(previous.value, receiver, args);
        };
        const wrapper = realmFunction('invoke', 'return function ' + key + '(){ return invoke(this, arguments); };')(invoke);
        Object.defineProperty(wrapper, 'length', { value: previous.value.length, configurable: true });
        add(key, { ...previous, value: wrapper });
      }
      const closed = realmFunction('read', 'return Object.getOwnPropertyDescriptor({get closed(){return read();}}, "closed").get')(() => record.detached);
      add('closed', { get: closed, enumerable: true, configurable: true });
      records.push(record); frameRecords.set(frame, record); count('trackedFrames');
    } catch { restoreProperties(record); count('preparationFailures'); }
  }
  function finishDetached(record) {
    try { Reflect.apply(record.originalClose, record.realm, []); }
    catch {
      count('cleanupFailures');
      // A failing request abort or DOM cleanup must not skip the private timer
      // shutdown later in JSDOM close. Re-enter without the owned document.
      const descriptor = Object.getOwnPropertyDescriptor(record.backing, '_document');
      if (descriptor?.configurable && descriptor.value === record.document) {
        try {
          delete record.backing._document;
          Reflect.apply(record.originalClose, record.realm, []);
          count('forcedTimerCleanups');
        } catch { count('cleanupFailures'); }
      }
    }
    if (!data(record.backing, '_document') && !record.cleaned) { record.cleaned = true; count('disposedRetainedFrames'); }
    detachedDocuments.delete(record.doc); detachedWindows.delete(record.windowImpl);
  }
  const retire = record => { restoreProperties(record); record.retired = true; };
  function dispose() {
    if (stats.disposed) return snapshot();
    stats.disposed = true;
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index];
      if (record.detached) finishDetached(record);
      restoreProperties(record);
    }
    records.length = 0; pendingFrame = undefined;
    for (let index = hooks.length - 1; index >= 0; index--) {
      const { target, key, previous, next } = hooks[index];
      try {
        if (sameDescriptor(Object.getOwnPropertyDescriptor(target, key), next)) {
          Object.defineProperty(target, key, previous); count('restoredHooks');
        } else count('hookRestoreConflicts');
      } catch { count('restoreFailures'); }
    }
    hooks.length = 0; active = false;
    return snapshot();
  }
  const snapshot = () => ({ ...stats });
  const hook = (target, key, make) => {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    if (!previous?.writable || typeof previous.value !== 'function') throw Error('UNSUPPORTED_HOOK');
    const next = { ...previous, value: make(previous.value) };
    Object.defineProperty(target, key, next); hooks.push({ target, key, previous, next });
  };
  try {
    hook(framePrototype, '_attach', original => function () {
      if (stats.disposed) return Reflect.apply(original, this, arguments);
      count('observedAttachments');
      const previousPending = pendingFrame;
      pendingFrame = undefined;
      if (!belongs(this._ownerDocument)) count('skippedUnownedFrames');
      else if (!eligibleAttributes(this)) count('skippedSourcedFrames');
      else pendingFrame = this;
      try { return Reflect.apply(original, this, arguments); }
      finally { pendingFrame = previousPending; }
    });
    hook(WindowModule, 'createWindow', original => function () {
      const frame = pendingFrame;
      const result = Reflect.apply(original, this, arguments);
      if (!stats.disposed && frame) prepare(frame, result);
      return result;
    });
    hook(framePrototype, '_detach', original => function () {
      if (stats.disposed) return Reflect.apply(original, this, arguments);
      const record = frameRecords.get(this);
      if (!record) { if (belongs(this._ownerDocument)) count('skippedUntrackedFrames'); return Reflect.apply(original, this, arguments); }
      if (record.detached || record.retired) return Reflect.apply(original, this, arguments);
      if (!eligibleAttributes(this) || this._contentDocument !== record.doc
          || data(record.backing, '_document') !== record.document || record.doc.URL !== 'about:blank'
          || !record.properties.every(item => sameDescriptor(Object.getOwnPropertyDescriptor(item.target, item.key), item.next))) {
        count('skippedChangedFrames'); retire(record); return Reflect.apply(original, this, arguments);
      }
      if (data(record.backing, '_length') !== 0) { count('skippedNestedFrames'); retire(record); return Reflect.apply(original, this, arguments); }
      const previousDocument = Object.getOwnPropertyDescriptor(record.backing, '_document');
      if (!previousDocument?.writable || !previousDocument.configurable) { count('detachFailures'); retire(record); return Reflect.apply(original, this, arguments); }
      try {
        record.detached = true;
        detachedDocuments.add(record.doc); detachedWindows.add(record.windowImpl);
        // JSDOM's own close cancels its private timers and sockets. Temporarily
        // omit only the internal document slot so it cannot erase the DOM tree.
        Object.defineProperty(record.backing, '_document', { ...previousDocument, value: undefined });
        try { Reflect.apply(record.originalClose, record.realm, []); }
        finally { Object.defineProperty(record.backing, '_document', previousDocument); }
        record.doc._requestManager?.close();
        record.doc._defaultView = null;
        record.doc._clearBaseURLCache();
        record.backing._parent = null; record.backing._top = null; record.backing._frameElement = null;
        this._contentDocument = null;
        count('retainedFrames');
      } catch {
        count('detachFailures'); finishDetached(record); retire(record);
      }
      return Reflect.apply(original, this, arguments);
    });
    hook(eventPrototype, '_dispatch', original => function () {
      if (!stats.disposed) {
        if (detachedWindows.has(this)) { count('windowEventsSuppressed'); return true; }
        if (NodeModule.implementation.prototype.isPrototypeOf(this) && detachedDocuments.has(this._ownerDocument)) {
          count('nodeEventsSuppressed'); return false;
        }
      }
      return Reflect.apply(original, this, arguments);
    });
    active = true;
    return { snapshot, dispose };
  } catch { dispose(); throw Error('DETACHED_FRAME_INSTALL_FAILED'); }
}
