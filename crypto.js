// Browser side of the data encryption: PBKDF2-SHA256 -> AES-256-GCM, gzip inside.
const KEY_STORE = "painel-gnb-key";
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function fetchEnvelope() {
  const r = await fetch(`data.enc?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function keyFromPassword(password, env) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64d(env.salt), iterations: env.iter },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"],
  );
}

export async function decrypt(key, env) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(env.iv) }, key, b64d(env.ct));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

// Stores the derived key (not the password) so this device skips the prompt.
export async function rememberKey(key, salt) {
  try {
    const raw = await crypto.subtle.exportKey("raw", key);
    localStorage.setItem(KEY_STORE, JSON.stringify({ salt, k: b64e(raw) }));
  } catch {
    /* storage unavailable: the prompt simply comes back next time */
  }
}

export async function storedKey(salt) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY_STORE) || "null");
    if (!s || s.salt !== salt) return null;
    return await crypto.subtle.importKey("raw", b64d(s.k), "AES-GCM", true, ["decrypt"]);
  } catch {
    return null;
  }
}

export function forgetKey() {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    /* nothing stored */
  }
}
