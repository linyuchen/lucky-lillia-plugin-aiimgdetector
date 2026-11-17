// Evaluated only by an explicitly enabled diagnostic operation. Standard DOM
// constructor/dispatch semantics are retained, including isTrusted === false.
(() => {
  const Constructor = globalThis.__synthidPlatformMouseEventConstructor || globalThis.MouseEvent;
  const target = document.body;
  if (typeof Constructor !== 'function' || !target) throw Error('POINTER_DIAGNOSTIC_UNAVAILABLE');
  const width = window.innerWidth, height = window.innerHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) throw Error('POINTER_DIAGNOSTIC_UNAVAILABLE');
  const counts = { diagnosticOnly: true, synthetic: true, mouseEventConstructorAvailable: true,
    requestedMoves: 4, constructedEvents: 0, constructedTrusted: 0, constructedUntrusted: 0,
    dispatchCalls: 0, dispatchedEvents: 0, uncancelledDispatches: 0, observedEvents: 0,
    observedTrusted: 0, observedUntrusted: 0, listenerInstalled: false, listenerRemoved: false };
  const issued = new WeakSet();
  let closed = false;
  const listener = event => {
    if (!issued.has(event)) return;
    counts.observedEvents++;
    if (event.isTrusted === true) counts.observedTrusted++;
    else if (event.isTrusted === false) counts.observedUntrusted++;
  };
  target.addEventListener('mousemove', listener, { capture: true, passive: true });
  counts.listenerInstalled = true;
  return {
    step(index) {
      if (closed || !Number.isInteger(index) || index !== counts.constructedEvents || index > 3) throw Error('POINTER_DIAGNOSTIC_SEQUENCE');
      // Four reproducible viewport-relative points; no coordinates leave realm.
      const [x, y] = [[0.07, 0.53], [0.11, 0.61], [0.15, 0.69], [0.09, 0.76]][index];
      const event = new Constructor('mousemove', { bubbles: true, cancelable: true, composed: true,
        view: window, detail: 0, button: 0, buttons: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
        clientX: Math.round(width * x), clientY: Math.round(height * y) });
      issued.add(event);
      counts.constructedEvents++;
      if (event.isTrusted === true) counts.constructedTrusted++;
      else if (event.isTrusted === false) counts.constructedUntrusted++;
      counts.dispatchCalls++;
      const platformDispatch = globalThis.__synthidPlatformDispatchEvent;
      if (platformDispatch ? platformDispatch(target, event) : target.dispatchEvent(event)) counts.uncancelledDispatches++;
      counts.dispatchedEvents++;
    },
    close() {
      if (!closed) {
        closed = true;
        target.removeEventListener('mousemove', listener, { capture: true });
        counts.listenerRemoved = true;
      }
      return { ...counts };
    },
  };
})()
