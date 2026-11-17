(function installActivationDiagnostic(transientMs = 0, clock = () => performance.now()) {
  if (![0, 5000].includes(transientMs) || typeof clock !== 'function') throw Error('INVALID_ACTIVATION_CONTROL');
  const prototype = Object.getPrototypeOf(navigator.userActivation);
  const previous = Object.fromEntries(['hasBeenActive','isActive'].map(key=>[key,Object.getOwnPropertyDescriptor(prototype,key)]));
  if (Object.values(previous).some(value=>!value?.get || !value.configurable)) throw Error('ACTIVATION_STATE_UNAVAILABLE');
  let startedAt = clock();
  const apply = Reflect.apply;
  let disposed = false;
  const getters = {
    get hasBeenActive() { apply(previous.hasBeenActive.get, this, []); return true; },
    get isActive() { apply(previous.isActive.get, this, []); return transientMs > 0 && clock() - startedAt < transientMs; },
  };
  const installed = {};
  for (const key of Object.keys(previous)) {
    installed[key] = {...previous[key],get:Object.getOwnPropertyDescriptor(getters,key).get};
    Object.defineProperty(prototype,key,installed[key]);
  }
  return {
    // Explicit experiment control; this does not create a trusted DOM event.
    activate() {
      if (disposed) throw Error('ACTIVATION_CONTROL_DISPOSED');
      startedAt = clock();
      return { diagnosticOnly:true, sticky:true, transient:transientMs>0, transientMs, disposed:false };
    },
    snapshot() { return {diagnosticOnly:true,sticky:true,transient:transientMs>0 && clock()-startedAt<transientMs,transientMs,disposed}; },
    dispose() {
      if(disposed) return; disposed=true;
      for(const key of Object.keys(previous)) if(Object.getOwnPropertyDescriptor(prototype,key)?.get===installed[key].get) Object.defineProperty(prototype,key,previous[key]);
    },
  };
})
