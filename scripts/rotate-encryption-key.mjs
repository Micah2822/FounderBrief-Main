// Re-encrypt every stored integration credential under the current
// ENCRYPTION_KEY, reading rows still held under ENCRYPTION_KEY_OLD.
//
//   node scripts/rotate-encryption-key.mjs              # dry run, changes nothing
//   node scripts/rotate-encryption-key.mjs --commit     # writes
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// `decrypt()` is AES-256-GCM with an auth tag, so a wrong key does not yield
// garbage — it throws. Changing ENCRYPTION_KEY in Vercel WITHOUT running this
// makes every stored credential permanently unreadable, and the only recovery
// is asking every customer to reconnect. There is no way to write this calmly
// during an incident, which is the only time it is ever needed.
//
// ═══════════════════════════════════════════════════════════════════════════
// RUNBOOK — FOLLOW IN THIS ORDER
//
// `lib/crypto.ts` accepts BOTH keys while ENCRYPTION_KEY_OLD is set. That is
// what makes this zero-downtime: production reads old rows and new rows at the
// same time, so it never matters how far the rewrite has got.
//
//   STEP 1 — generate the new key by running:
//       openssl rand -base64 32
//
//   STEP 2 — Vercel › Settings › Environment Variables
//       ADD     ENCRYPTION_KEY_OLD = the CURRENT value of ENCRYPTION_KEY
//       CHANGE  ENCRYPTION_KEY     = the new value from step 1
//       Then REDEPLOY and wait until it is live.
//       Production now writes with the new key and reads with either.
//       Do NOT skip the redeploy: an env change does not reach a running
//       deployment, so until it is live nothing has actually changed.
//
//   STEP 3 — .env.local: set the SAME two values
//       ENCRYPTION_KEY     = new value      (same as Vercel)
//       ENCRYPTION_KEY_OLD = previous value (same as Vercel)
//       The names match production deliberately, so this is a copy of step 2
//       rather than a translation. A mismatch here rewrites every row under a
//       key the deployment does not have.
//
//   STEP 4 — dry run, and read the output
//       node scripts/rotate-encryption-key.mjs
//
//   STEP 5 — commit the rewrite
//       node scripts/rotate-encryption-key.mjs --commit
//       Re-run until it reports `failed 0`. Rows already on the new key are
//       detected and skipped, so re-running is always safe.
//
//   STEP 6 — only once step 5 reports every row rotated
//       Verify: sign in and load a brief that uses an integration.
//       Vercel: DELETE ENCRYPTION_KEY_OLD, then REDEPLOY.
//       .env.local: delete ENCRYPTION_KEY_OLD.
//       Skipping this breaks nothing, but leaves two live keys, so a
//       compromised environment yields both instead of one.
//
// ═══════════════════════════════════════════════════════════════════════════
// SAFETY
//
// Never prints a decrypted value. Rows are rewritten one at a time, and each
// re-encryption is decrypted back and compared BEFORE the write — a row that
// cannot be read back is worse than one left alone, because the old ciphertext
// is then gone. A crash leaves a mix of old- and new-key rows, which
// production reads happily and a re-run finishes.

import { readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const COMMIT = process.argv.includes("--commit");

// .env.local cannot be parsed line-by-line: GITHUB_APP_PRIVATE_KEY is a quoted
// multi-line value and a naive parser truncates it. Shared with the other
// scripts — see ARCHITECTURE › Known issues.
function parseEnv(text) {
  const out = {};
  const re = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))\s*$/gm;
  for (const m of text.replace(/\r\n/g, "\n").matchAll(re)) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

const fileEnv = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));

// Real process env wins, so a dry run can be rehearsed without editing
// .env.local:
//   ENCRYPTION_KEY=$(openssl rand -base64 32) \
//   ENCRYPTION_KEY_OLD="$(grep '^ENCRYPTION_KEY=' .env.local | cut -d= -f2-)" \
//   node scripts/rotate-encryption-key.mjs
const env = new Proxy({}, { get: (_, k) => process.env[k] ?? fileEnv[k] });

function keyBuf(raw, label) {
  if (!raw) throw new Error(`${label} is not set`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`${label} must be 32 bytes base64`);
  return buf;
}

// Same variable names production uses — see STEP 3 above.
const NEW = keyBuf(env.ENCRYPTION_KEY, "ENCRYPTION_KEY");
const OLD = keyBuf(env.ENCRYPTION_KEY_OLD, "ENCRYPTION_KEY_OLD");
if (OLD.equals(NEW)) {
  throw new Error("ENCRYPTION_KEY_OLD is the same as ENCRYPTION_KEY — nothing to rotate");
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase URL / service role key missing");

// Same format as lib/crypto.ts: iv.tag.ciphertext, each base64.
function decryptWith(key, payload) {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
}

function encryptWith(key, plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const rows = await rest("integrations?select=id,provider,access_token");
const withToken = rows.filter((r) => r.access_token);

console.log(`${rows.length} integration rows, ${withToken.length} carrying a token`);
console.log(COMMIT ? "MODE: commit\n" : "MODE: dry run — nothing will be written\n");

let rotated = 0;
let already = 0;
let failed = 0;

for (const row of withToken) {
  let plaintext;
  try {
    plaintext = decryptWith(OLD, row.access_token);
  } catch {
    // Already on the new key (a previous partial run), or genuinely unreadable.
    try {
      decryptWith(NEW, row.access_token);
      already++;
      console.log(`  skip    ${row.provider}  ${row.id}  (already re-encrypted)`);
    } catch {
      failed++;
      console.error(`  FAILED  ${row.provider}  ${row.id}  (readable by neither key)`);
    }
    continue;
  }

  const reEncrypted = encryptWith(NEW, plaintext);
  // Verify before writing: a row that cannot be read back is worse than one
  // left alone, because the old ciphertext is gone.
  if (decryptWith(NEW, reEncrypted) !== plaintext) {
    failed++;
    console.error(`  FAILED  ${row.provider}  ${row.id}  (round-trip mismatch)`);
    continue;
  }

  if (COMMIT) {
    await rest(`integrations?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ access_token: reEncrypted }),
    });
  }
  rotated++;
  console.log(`  ${COMMIT ? "rotated" : "would  "} ${row.provider}  ${row.id}`);
}

console.log(`\nrotated ${rotated}   already ${already}   failed ${failed}`);

if (failed) {
  console.error("\nSome rows could not be rotated. Do NOT swap the key in Vercel:");
  console.error("those users would need to reconnect. Investigate first.");
  process.exit(1);
}

if (!COMMIT) {
  console.log("\nDry run only. Re-run with --commit when the plan above looks right.");
} else {
  console.log(`
Done — every row is now under ENCRYPTION_KEY.

Production has been able to read old and new rows throughout, because
ENCRYPTION_KEY_OLD is still set. Nothing was down.

Finish step 6 from the top of this file:

  1. Verify: sign in and load a brief that uses an integration.
  2. Vercel → Environment Variables → DELETE ENCRYPTION_KEY_OLD → REDEPLOY.
  3. Delete ENCRYPTION_KEY_OLD from .env.local.

Until you do, two keys are live and a compromised environment yields both.`);
}
