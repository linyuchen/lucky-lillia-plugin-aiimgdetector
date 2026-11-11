// These expressions execute in the website, not in Node. Keep them as text:
// tsx/esbuild's keepNames helper must never be serialized into page.evaluate().
const liveUser = String.raw`
  let user;
  try {
    const app = window.firebase?.apps?.[0];
    user = app?.auth?.().currentUser;
  } catch {}
`

export const accountScript = String.raw`(async () => {
  const config = window.WIZ_global_data?.yeeU8 || {};
  let accepted = false;
  try { accepted = JSON.parse(localStorage.getItem('firstTime') || '{}').termsAccepted === true; } catch {}
  ${liveUser}
  if (user?.uid) {
    return { loggedIn: !user.isAnonymous, email: typeof user.email === 'string' ? user.email : undefined, accepted };
  }
  const shell = {
    loggedIn: config.isLoggedIn === true || config.isLoggedIn === 'true',
    email: typeof config.userEmail === 'string' && config.userEmail ? config.userEmail : undefined,
    accepted,
  };
  const firebase = await new Promise(resolve => {
    let done = false;
    let database;
    const finish = (value = { loggedIn: false }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      database?.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 1500);
    const request = indexedDB.open('firebaseLocalStorageDb');
    request.onerror = () => finish();
    request.onblocked = () => finish();
    request.onupgradeneeded = () => { request.transaction?.abort(); finish(); };
    request.onsuccess = () => {
      database = request.result;
      if (done) { database.close(); return; }
      if (!database.objectStoreNames.contains('firebaseLocalStorage')) { finish(); return; }
      const transaction = database.transaction('firebaseLocalStorage', 'readonly');
      transaction.onerror = () => finish();
      const cursor = transaction.objectStore('firebaseLocalStorage').openCursor();
      cursor.onerror = () => finish();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) { finish(); return; }
        const record = entry.value;
        const saved = record.value;
        if (record.fbase_key?.startsWith('firebase:authUser:') && typeof saved?.uid === 'string' && saved.uid && !saved.isAnonymous) {
          finish({ loggedIn: true, email: typeof saved.email === 'string' ? saved.email : undefined });
        } else entry.continue();
      };
    };
  });
  return firebase.loggedIn ? { ...firebase, accepted } : shell;
})()`

export const refreshTokenScript = String.raw`(async uid => {
  ${liveUser}
  if (user?.uid) {
    if (user.uid !== uid || user.isAnonymous) return '';
    const token = user.refreshToken || user.stsTokenManager?.refreshToken;
    if (typeof token === 'string' && token) return token;
  }
  return new Promise(resolve => {
    let done = false;
    let database;
    const finish = (value = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      database?.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 1500);
    const request = indexedDB.open('firebaseLocalStorageDb');
    request.onerror = () => finish();
    request.onblocked = () => finish();
    request.onupgradeneeded = () => { request.transaction?.abort(); finish(); };
    request.onsuccess = () => {
      database = request.result;
      if (done) { database.close(); return; }
      if (!database.objectStoreNames.contains('firebaseLocalStorage')) { finish(); return; }
      const transaction = database.transaction('firebaseLocalStorage', 'readonly');
      transaction.onerror = () => finish();
      const cursor = transaction.objectStore('firebaseLocalStorage').openCursor();
      cursor.onerror = () => finish();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) { finish(); return; }
        const record = entry.value;
        const saved = record.value;
        if (record.fbase_key?.startsWith('firebase:authUser:') && saved?.uid === uid && !saved.isAnonymous
          && typeof saved.stsTokenManager?.refreshToken === 'string' && saved.stsTokenManager.refreshToken) {
          finish(saved.stsTokenManager.refreshToken);
        } else entry.continue();
      };
    };
  });
})`
