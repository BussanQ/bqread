// WKWebView custom origins may expose getRandomValues without randomUUID.
export function newId() {
  return globalThis.crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
