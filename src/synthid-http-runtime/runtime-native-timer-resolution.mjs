// Importing this module neither loads the addon nor requests timer resolution.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
let activeInstallation;
const errorCodes = new Set(['INVALID_OPTIONS', 'UNSUPPORTED_PLATFORM', 'NATIVE_ADDON_UNAVAILABLE',
  'UNSUPPORTED_NATIVE_ADDON', 'ALREADY_INSTALLED', 'ACQUIRE_FAILED', 'RELEASE_FAILED']);
export class RuntimeNativeTimerResolutionError extends Error {
  constructor(code) {
    const safe = errorCodes.has(code) ? code : 'ACQUIRE_FAILED';
    super('Runtime native timer resolution failed: ' + safe);
    this.name = 'RuntimeNativeTimerResolutionError'; this.code = safe;
  }
}

/** Own one lease for the current independent Node environment. Native leases
 * share one timeBeginPeriod(1) per environment, balanced on the last release or
 * environment cleanup. No timestamps or scheduling frequencies are changed.
 * restored means our lease was released, not an OS resolution readback. */
export function installRuntimeNativeTimerResolution() {
  if (arguments.length) throw new RuntimeNativeTimerResolutionError('INVALID_OPTIONS');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new RuntimeNativeTimerResolutionError('UNSUPPORTED_PLATFORM');
  if (activeInstallation) throw new RuntimeNativeTimerResolutionError('ALREADY_INSTALLED');
  let addon;
  try {addon = require('./native-timer-resolution/build/Release/native_timer_resolution.node');}
  catch {throw new RuntimeNativeTimerResolutionError('NATIVE_ADDON_UNAVAILABLE');}
  if (typeof addon.acquire !== 'function' || typeof addon.release !== 'function' || typeof addon.query !== 'function')
    throw new RuntimeNativeTimerResolutionError('UNSUPPORTED_NATIVE_ADDON');
  const before = addon.query();
  if (before.schemaVersion !== 1 || before.requestedPeriodMs !== 1 || before.supported !== true)
    throw new RuntimeNativeTimerResolutionError('UNSUPPORTED_NATIVE_ADDON');
  let lease;
  try {lease = addon.acquire();}
  catch {throw new RuntimeNativeTimerResolutionError('ACQUIRE_FAILED');}
  let disposed = false, releaseAttempted = false, releaseSucceeded = false, releaseFailures = 0;
  const snapshot = () => ({schemaVersion: 1, installed: true, nativeTimerResolution: true,
    method: 'timeBeginPeriod/timeEndPeriod', requestedPeriodMs: 1, acquisitionSucceeded: true,
    disposed, releaseAttempted, releaseSucceeded, releaseFailures, restored: disposed && releaseSucceeded,
    restorationScope: 'owned-lease', timestampsModified: false, frameRateModified: false,
    native: addon.query()});
  const dispose = () => {
    if (!disposed) {
      releaseAttempted = true;
      try {releaseSucceeded = addon.release(lease) === true;}
      catch {releaseFailures++; throw new RuntimeNativeTimerResolutionError('RELEASE_FAILED');}
      if (!releaseSucceeded) {releaseFailures++; throw new RuntimeNativeTimerResolutionError('RELEASE_FAILED');}
      disposed = true; lease = undefined;
      if (activeInstallation === control) activeInstallation = undefined;
    }
    return snapshot();
  };
  const control = Object.freeze({snapshot, dispose});
  activeInstallation = control;
  return control;
}
