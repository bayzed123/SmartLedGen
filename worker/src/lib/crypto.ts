/**
 * Encrypts user-supplied API keys (Google Places, Hunter, Gemini, OpenAI,
 * Anthropic) before they ever touch D1. The key never leaves the Worker in
 * plaintext once submitted, and is only decrypted in-memory at the moment
 * a job actually needs to call that provider.
 *
 * ENCRYPTION_KEY is a Worker secret (base64, 32 random bytes) — set once
 * with `wrangler secret put ENCRYPTION_KEY` (see README). It is NOT the
 * same as any user's provider key.
 */

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64ToBytes(base64Key);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(
  plaintext: string,
  base64Key: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: bytesToB64(new Uint8Array(ciphertextBuf)),
    iv: bytesToB64(iv),
  };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  base64Key: string
): Promise<string> {
  const key = await importKey(base64Key);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(iv) },
    key,
    b64ToBytes(ciphertext)
  );
  return new TextDecoder().decode(plainBuf);
}

/** PBKDF2 password hashing for signup/login — no plaintext password ever stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `${bytesToB64(salt)}:${bytesToB64(new Uint8Array(derivedBits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = b64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const computedB64 = bytesToB64(new Uint8Array(derivedBits));
  // Constant-time-ish comparison
  if (computedB64.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < computedB64.length; i++) {
    diff |= computedB64.charCodeAt(i) ^ hashB64.charCodeAt(i);
  }
  return diff === 0;
}
