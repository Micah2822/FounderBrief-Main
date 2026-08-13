import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM for integration tokens at rest.
// ENCRYPTION_KEY: 32-byte base64 (openssl rand -base64 32).

function parseKey(raw: string | undefined, label: string): Buffer {
  if (!raw) throw new Error(`${label} is not set`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${label} must be 32 bytes base64`);
  return buf;
}

function key(): Buffer {
  return parseKey(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY");
}

/**
 * Keys `decrypt()` will try, newest first.
 *
 * `ENCRYPTION_KEY_OLD` is set **only during a key rotation** and makes it
 * zero-downtime. Without it, rotation has an unavoidable gap: the script
 * re-encrypts rows in the database, but the running deployment still holds the
 * previous key until a new build goes live, and every read in between throws.
 * Accepting both keys for the duration removes the gap entirely.
 *
 * Unset it once `scripts/rotate-encryption-key.mjs` reports every row rotated —
 * leaving it in place means a compromise of the environment yields two usable
 * keys instead of one.
 */
function decryptionKeys(): Buffer[] {
  const primary = key();
  const previous = process.env.ENCRYPTION_KEY_OLD;
  return previous ? [primary, parseKey(previous, "ENCRYPTION_KEY_OLD")] : [primary];
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

/**
 * `context` should identify whose credential is being read — normally the
 * user id. It is logged, never the plaintext.
 *
 * Decrypting an integration credential is the single most sensitive operation
 * in the app, and until now it left no trace: a bulk read of every customer's
 * key looked exactly like a normal night's brief generation. One line per
 * decrypt makes an anomaly visible in the Vercel logs.
 */
export function decrypt(payload: string, context?: string): string {
  if (context) console.log(`decrypt integration credential for ${context}`);
  const [ivB64, tagB64, dataB64] = payload.split(".");

  // GCM authenticates, so a wrong key throws rather than returning garbage —
  // which is what makes trying each key in turn safe. A value can only be
  // "decrypted" by the key that actually produced it.
  let lastError: unknown;
  for (const k of decryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("decrypt failed");
}
