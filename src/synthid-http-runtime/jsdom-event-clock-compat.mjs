import EventModule from 'jsdom/lib/jsdom/living/events/Event-impl.js';
import PerformanceModule from 'jsdom/lib/jsdom/living/hr-time/Performance-impl.js';
import generatedUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import {uncoarsenedPerformanceNow,coarsenCompletedClockForOrigin,chromiumTimeClamperActive,quantizeCompletedClock100us} from './runtime-clock-precision-control.mjs';

const EventImpl = EventModule.implementation;
const PerformanceImpl = PerformanceModule.implementation;
const performanceNow = uncoarsenedPerformanceNow;
const ownData = (object, key) => {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const unsupported = () => { throw Error('EVENT_CLOCK_UNSUPPORTED_JSDOM'); };

/** Experimental standards correction, for a dedicated isolated JSDOM worker.
 * JSDOM26 stamps events with Date.now(); DOM timestamps use the creation realm's
 * relative high-resolution clock. No browser identity/trust value is changed.
 * This mutates one internal prototype process-wide, and must be disposed. */
export function installEventClockCompatibility(options = {}) {
  if(!options||typeof options!=='object')throw Error('EVENT_CLOCK_INVALID_OPTIONS');
  const precisionDescriptor=Object.getOwnPropertyDescriptor(options,'clockPrecision100us');
  if(precisionDescriptor&&!Object.hasOwn(precisionDescriptor,'value'))throw Error('EVENT_CLOCK_INVALID_OPTIONS');
  const suppliedPrecision=precisionDescriptor?.value;
  const clockPrecision100us=suppliedPrecision===undefined?false:suppliedPrecision;
  if(typeof clockPrecision100us!=='boolean')throw Error('EVENT_CLOCK_INVALID_OPTIONS');
  const prototype = EventImpl.prototype;
  const source = Function.prototype.toString.call(EventImpl);
  if (jsdomPackage.version !== '26.1.0' || typeof performanceNow !== 'function' ||
      Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value !== EventImpl ||
      !Object.isExtensible(prototype) || Object.hasOwn(prototype, 'timeStamp') ||
      !source.includes('this._globalObject = globalObject;') ||
      !source.includes('this.timeStamp = Date.now();') ||
      source.indexOf('this._globalObject = globalObject;') > source.indexOf('this.timeStamp = Date.now();')) unsupported();
  const clocks = new WeakMap();
  let disposed = false;
  function stampAtCreation(epochAssignment) {
    if (disposed || !EventImpl.prototype.isPrototypeOf(this) ||
        Object.hasOwn(this, 'timeStamp') || !Number.isFinite(epochAssignment)) unsupported();
    const realm = ownData(this, '_globalObject');
    if (!realm || (typeof realm !== 'object' && typeof realm !== 'function')) unsupported();
    let clock = clocks.get(realm);
    if (!clock) {
      // The Window getter returns its own original Performance wrapper. Capture
      // the implementation once, never use a page-replaced performance.now().
      const descriptor = Object.getOwnPropertyDescriptor(realm, 'performance');
      if (!descriptor || typeof descriptor.get !== 'function' || descriptor.set !== undefined) unsupported();
      const wrapper = Reflect.apply(descriptor.get, realm, []);
      if (!ownData(wrapper, generatedUtils.implSymbol)) unsupported();
      clock = generatedUtils.implForWrapper(wrapper);
      if (!PerformanceImpl.prototype.isPrototypeOf(clock) ||
          ownData(clock, '_globalObject') !== realm ||
          !Number.isFinite(ownData(clock, '_nowAtTimeOrigin')) ||
          !Number.isFinite(ownData(clock, 'timeOrigin'))) unsupported();
      clocks.set(realm, clock);
    }
    const completed = Reflect.apply(performanceNow, clock, []);
    const value = clockPrecision100us ? (chromiumTimeClamperActive()?coarsenCompletedClockForOrigin(completed,clock._nowAtTimeOrigin):quantizeCompletedClock100us(completed)) : completed;
    if (!Number.isFinite(value) || value < 0) unsupported();
    // Match the exact property flags produced by EventImpl's normal assignment.
    // Every subsequent access uses this stable own value, not the setter/clock.
    Object.defineProperty(this, 'timeStamp', { value, writable: true, enumerable: true, configurable: true });
  }
  Object.defineProperty(prototype, 'timeStamp', { set: stampAtCreation, configurable: true, enumerable: false });
  return {
    dispose() {
      if (disposed) return;
      const current = Object.getOwnPropertyDescriptor(prototype, 'timeStamp');
      if (!current || current.set !== stampAtCreation || current.get !== undefined ||
          current.configurable !== true || current.enumerable !== false) throw Error('EVENT_CLOCK_RESTORE_CONFLICT');
      delete prototype.timeStamp;
      disposed = true;
    },
  };
}
