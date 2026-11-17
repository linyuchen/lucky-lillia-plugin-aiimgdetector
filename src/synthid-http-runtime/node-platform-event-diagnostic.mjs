import MouseEventBinding from 'jsdom/lib/jsdom/living/generated/MouseEvent.js';
import MouseEventInit from 'jsdom/lib/jsdom/living/generated/MouseEventInit.js';
import generatedUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import EventTargetModule from 'jsdom/lib/jsdom/living/events/EventTarget-impl.js';

// Explicit runtime simulation. These are NOT hardware input. The JSDOM
// user-agent construction path sets its own internal isTrusted flag; normal
// public MouseEvent construction remains false, with all public getters intact.
export function installPlatformEventDiagnostic(window) {
  const key = '__synthidPlatformMouseEventConstructor';
  const dispatchKey = '__synthidPlatformDispatchEvent';
  if (Object.hasOwn(window, key) || Object.hasOwn(window, dispatchKey)) throw Error('PLATFORM_EVENT_DIAGNOSTIC_COLLISION');
  const realm = generatedUtils.implForWrapper(new window.MouseEvent('mousemove'))._globalObject;
  const constructor = function NodeSimulatedPlatformMouseEvent(type, options) {
    if (type !== 'mousemove') throw Error('PLATFORM_EVENT_DIAGNOSTIC_TYPE');
    const init = MouseEventInit.convert(realm, options, { context: 'Node simulated input' });
    return MouseEventBinding.create(realm, [type, init], { isTrusted: true });
  };
  const dispatch = (target, event) => {
    if (target !== window.document.body) throw Error('PLATFORM_EVENT_DIAGNOSTIC_TARGET');
    const implementation = generatedUtils.implForWrapper(event);
    if (implementation._globalObject !== realm || implementation.type !== 'mousemove') throw Error('PLATFORM_EVENT_DIAGNOSTIC_TYPE');
    // Public dispatchEvent correctly clears trust. The user-agent event delivery
    // path calls _dispatch, retaining the simulated source flag through bubbling.
    return Reflect.apply(EventTargetModule.implementation.prototype._dispatch, generatedUtils.implForWrapper(target), [implementation]);
  };
  Object.defineProperty(window, key, { value: constructor, configurable: true });
  Object.defineProperty(window, dispatchKey, { value: dispatch, configurable: true });
  return { dispose() {
    if (Object.getOwnPropertyDescriptor(window, key)?.value === constructor) delete window[key];
    if (Object.getOwnPropertyDescriptor(window, dispatchKey)?.value === dispatch) delete window[dispatchKey];
  } };
}
