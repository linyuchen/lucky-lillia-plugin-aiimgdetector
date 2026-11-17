import generatedUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import DocumentModule from 'jsdom/lib/jsdom/living/nodes/Document-impl.js';

// Passive, version-sensitive JSDOM 26 diagnostic. No event listener is installed
// or wrapped, and callbacks/options getters are never read. These are current
// registration counts, not proof that a particular callback was invoked.
const TYPES = Object.freeze(['mousemove', 'pointermove', 'click']);
const LIMIT = 1000000;
const MAX_REALMS = 32;
const MAX_NODES = 4096;
const bodyGetter = Object.getOwnPropertyDescriptor(DocumentModule.implementation.prototype, 'body').get;
const own = (object, key) => {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const impl = wrapper => {
  if (!wrapper || !own(wrapper, generatedUtils.implSymbol)) return undefined;
  return generatedUtils.implForWrapper(wrapper);
};
const bounded = number => Math.min(LIMIT, Math.max(0, number));

export function countEventTargetListeners(targetImpl) {
  const table = own(targetImpl, '_eventListeners');
  const events = Object.fromEntries(TYPES.map(type => [type, { total: 0, capture: 0, bubble: 0, invalid: 0 }]));
  if (!table || typeof table !== 'object') return { available: false, events };
  for (const type of TYPES) {
    const list = own(table, type);
    if (list === undefined) continue;
    if (!Array.isArray(list)) { events[type].invalid = 1; continue; }
    const length = own(list, 'length');
    if (!Number.isSafeInteger(length) || length < 0) { events[type].invalid = 1; continue; }
    events[type].total = bounded(length);
    for (let index = 0; index < Math.min(length, LIMIT); index++) {
      const options = own(own(list, String(index)), 'options');
      const capture = own(options, 'capture');
      if (capture === true) events[type].capture++;
      else if (capture === false) events[type].bubble++;
      else events[type].invalid++;
    }
  }
  return { available: true, events };
}

export function createEventListenerDiagnostics(topWindow) {
  const records = [];
  const windows = new WeakMap();
  const observers = [];
  let disposed = false, inspectionFailures = 0, truncated = false;
  const fail = () => { inspectionFailures = bounded(inspectionFailures + 1); };
  function captureBody(record) {
    try {
      const body = Reflect.apply(bodyGetter, record.documentImpl, []);
      if (body) record.bodyImpl = body;
      return body;
    } catch { fail(); return undefined; }
  }
  function noteFrame(frame) {
    if (disposed) return;
    try {
      const frameImpl = impl(frame);
      const documentImpl = own(frameImpl, '_contentDocument');
      const window = own(documentImpl, '_defaultView');
      if (window && documentImpl) observeWindow(window, documentImpl, frameImpl);
    } catch { fail(); }
  }
  function visit(node, owner, budget) {
    if (!node || budget.left-- <= 0) { truncated = true; return; }
    const nodeImpl = impl(node);
    const name = own(nodeImpl, '_localName');
    if ((name === 'body' || name === 'frameset') && own(nodeImpl, '_ownerDocument') === owner.documentImpl) owner.bodyImpl = nodeImpl;
    if (name === 'iframe' || name === 'frame') noteFrame(node);
    // Use original DOM access only to traverse nodes; no text, attribute, URL,
    // listener callback, coordinates or realm property values enter a report.
    for (const child of node.childNodes || []) visit(child, owner, budget);
  }
  function observeWindow(window, documentImpl, frameImpl) {
    if (windows.has(window)) { captureBody(windows.get(window)); return; }
    if (records.length >= MAX_REALMS) { truncated = true; return; }
    const document = generatedUtils.wrapperForImpl(documentImpl);
    const record = { window, windowImpl: impl(window), documentImpl, frameImpl, bodyImpl: undefined };
    windows.set(window, record); records.push(record);
    captureBody(record);
    const Observer = own(window, 'MutationObserver');
    if (typeof Observer === 'function' && document) {
      const observer = new Observer(mutations => {
        if (disposed) return;
        try {
          const budget = { left: MAX_NODES };
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) visit(node, record, budget);
            for (const node of mutation.removedNodes) visit(node, record, budget);
          }
          captureBody(record);
        } catch { fail(); }
      });
      observer.observe(document, { childList: true, subtree: true });
      observers.push(observer);
    }
    if (document) visit(document, record, { left: MAX_NODES });
  }
  const document = own(topWindow, '_document');
  const documentImpl = impl(document);
  if (documentImpl) observeWindow(topWindow, documentImpl);
  else fail();

  return {
    noteFrame,
    snapshot() {
      if (disposed) return { disposed: true, inspectionFailures, truncated, top: undefined, frames: [] };
      // A synchronous scan sees newly attached frames even before the observer
      // microtask. Retained records continue to expose closed/detached realms.
      for (const record of [...records]) {
        try {
          const current = own(record.window, '_document');
          if (current) visit(current, record, { left: MAX_NODES });
        } catch { fail(); }
      }
      const realms = records.map(record => {
        const currentBody = captureBody(record);
        const closed = own(record.window, '_document') === undefined;
        return {
          closed,
          attached: record.frameImpl ? own(record.frameImpl, '_attached') === true : true,
          bodyPresent: Boolean(currentBody && !closed),
          bodyRetained: Boolean(record.bodyImpl && (!currentBody || closed)),
          window: countEventTargetListeners(record.windowImpl),
          document: countEventTargetListeners(record.documentImpl),
          body: countEventTargetListeners(record.bodyImpl),
        };
      });
      return { disposed: false, inspectionFailures, truncated, top: realms[0], frames: realms.slice(1) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const observer of observers) observer.disconnect();
      observers.length = 0; records.length = 0;
    },
  };
}
