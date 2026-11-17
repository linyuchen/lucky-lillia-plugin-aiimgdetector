import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import { installRuntimeWebCompat, normalizeRuntimeNetworkSample } from './runtime-web-compat.mjs';

const MAX_CHILDREN = 32;
let active = false;
const data = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) throw TypeError('CHILD_COMPAT_DATA_OPTIONS_REQUIRED');
  return descriptor?.value;
};

/** Dedicated JSDOM26 worker hook, installed after the top window is created.
 * HTMLFrameElement calls this shared module export dynamically; JSDOM's public
 * top-level factory retains its original destructured function. This host hook
 * is never assigned to a DOM object or passed as a page callback. */
export function installRuntimeChildWebCompat(options = {}) {
  if (active) throw Error('CHILD_COMPAT_ALREADY_INSTALLED');
  const descriptor = Object.getOwnPropertyDescriptor(WindowModule, 'createWindow');
  if (jsdomPackage.version !== '26.1.0' || !descriptor?.writable || typeof descriptor.value !== 'function') {
    throw Error('CHILD_COMPAT_UNSUPPORTED_JSDOM');
  }
  if (!options || typeof options !== 'object') throw TypeError('CHILD_COMPAT_INVALID_OPTIONS');
  const childOptions = {};
  for (const key of ['physicalMemoryBytes', 'deviceMemoryMaxGiB', 'platform', 'virtualScreen', 'virtualMouse', 'clockPrecision100us', 'userActivationWebIdlCompatibility']) {
    const value = data(options, key);
    if (value !== undefined) childOptions[key] = value;
  }
  const networkSample = normalizeRuntimeNetworkSample(data(options, 'networkSample'));
  if (networkSample) childOptions.networkSample = Object.freeze(networkSample);
  if (childOptions.physicalMemoryBytes !== undefined && (!Number.isSafeInteger(childOptions.physicalMemoryBytes) || childOptions.physicalMemoryBytes <= 0)
      || childOptions.deviceMemoryMaxGiB !== undefined && ![8, 32].includes(childOptions.deviceMemoryMaxGiB)
      || childOptions.platform !== undefined && !['Win32', 'MacIntel', 'Linux x86_64', 'Linux aarch64'].includes(childOptions.platform)
      || childOptions.virtualScreen !== undefined && typeof childOptions.virtualScreen !== 'boolean'
      || childOptions.virtualMouse !== undefined && typeof childOptions.virtualMouse !== 'boolean'
      || childOptions.clockPrecision100us !== undefined && typeof childOptions.clockPrecision100us !== 'boolean'
      || childOptions.userActivationWebIdlCompatibility !== undefined && typeof childOptions.userActivationWebIdlCompatibility !== 'boolean') {
    throw TypeError('CHILD_COMPAT_INVALID_OPTIONS');
  }
  Object.freeze(childOptions);
  const original = descriptor.value;
  const controllers = [];
  const stats = { observedChildren: 0, installationAttempts: 0, installedChildren: 0, skippedFactories: 0,
    unsupportedRealms: 0, installationFailures: 0, disposedChildren: 0,
    disposalFailures: 0, limitReached: false, restoreConflict: false, disposed: false };
  const count = key => { stats[key] = Math.min(1000000, stats[key] + 1); };
  function createWindowWithCompatibility(factoryOptions) {
    const child = Reflect.apply(original, this, arguments);
    if (stats.disposed) return child;
    // parentOrigin is supplied by HTMLFrameElement, not the top-level API.
    if (!factoryOptions || !Object.hasOwn(factoryOptions, 'parentOrigin')) {
      count('skippedFactories'); return child;
    }
    count('observedChildren');
    if (factoryOptions.runScripts !== 'outside-only') { count('unsupportedRealms'); return child; }
    if (stats.installationAttempts >= MAX_CHILDREN) { stats.limitReached = true; return child; }
    count('installationAttempts');
    try {
      // createWindow returns the backing object; _globalProxy is the real vm
      // global returned by frame.contentWindow and used by realm evaluation.
      const proxy = Object.getOwnPropertyDescriptor(child, '_globalProxy')?.value;
      if (!proxy || proxy.Function === Function || proxy.eval === eval) { count('unsupportedRealms'); return child; }
      // Child clocks retain their own creation origin. Parent HTTP navigation
      // records and origins are intentionally not passed to an unrelated realm.
      controllers.push(installRuntimeWebCompat(proxy, childOptions));
      count('installedChildren');
    } catch {
      // Do not leak a new host Error object into page appendChild/navigation.
      // A counted failure makes the compatibility attempt explicitly incomplete.
      count('installationFailures');
    }
    return child;
  }
  Object.defineProperty(WindowModule, 'createWindow', { ...descriptor, value: createWindowWithCompatibility });
  active = true;
  return {
    snapshot() {
      let userActivationReads;
      for (const controller of controllers) {
        const reads = controller.snapshot().userActivationReads;
        if (!reads) continue;
        userActivationReads ??= Object.fromEntries(Object.keys(reads).map(kind => [kind, {}]));
        for (const [kind, counters] of Object.entries(reads)) for (const [name, value] of Object.entries(counters)) {
          userActivationReads[kind][name] = Math.min(1000000, (userActivationReads[kind][name] ?? 0) + value);
        }
      }
      return { ...stats, ...(userActivationReads ? { userActivationReads } : {}) };
    },
    dispose() {
      if (stats.disposed) return;
      stats.disposed = true;
      const current = Object.getOwnPropertyDescriptor(WindowModule, 'createWindow');
      if (current?.value === createWindowWithCompatibility) Object.defineProperty(WindowModule, 'createWindow', descriptor);
      else stats.restoreConflict = true;
      for (const controller of controllers.reverse()) {
        try { controller.dispose(); count('disposedChildren'); }
        catch { count('disposalFailures'); }
      }
      controllers.length = 0;
      active = false;
    },
  };
}
