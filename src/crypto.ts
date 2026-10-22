// Small crypto helpers.
// AES-GCM encryption for the Moodle token at rest in D1. The key (TOKEN_KEY secret, base64 of 32 random bytes)
// lives only in Cloudflare secrets, so a leaked database export alone does not reveal the token.
// Stored format: "v1.<base64 iv>.<base64 ciphertext>".

/** Constant-time string comparison, so a secret can't be guessed from response timing. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be base64 of exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyB64),
    new TextEncoder().encode(plain));
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}

export async function decrypt(sealed: string, keyB64: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("unknown token format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await importKey(keyB64),
    unb64(data));
  return new TextDecoder().decode(plain);
}
