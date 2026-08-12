// Reports which stored Stripe credentials are full secret keys (sk_) rather
// than restricted ones (rk_). The connect route now rejects sk_, but rows
// written before that still hold one — and a secret key can create charges and
// issue refunds, so those users need to rotate in Stripe and reconnect.
//
//   node scripts/audit-stripe-keys.mjs
//
// Read-only: decrypts in memory, prints user ids and a count, writes nothing.
// Never prints a key. Needs ENCRYPTION_KEY and SUPABASE_SERVICE_ROLE_KEY from
// .env.local, so run it locally against production values, not in CI.

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";

// PostgREST over plain fetch rather than supabase-js: the SDK constructs a
// Realtime client on import, which cannot start on Node < 22 without a
// WebSocket polyfill even though nothing here subscribes to anything. Same
// reason lib/collectors/supabase.ts talks to PostgREST directly.

/** Quoted values may span lines (see scripts/check-github-app.mjs). */
function parseEnv(text) {
  const out = {};
  const re = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))\s*$/gm;
  for (const m of text.replace(/\r\n/g, "\n").matchAll(re)) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));

const encKey = Buffer.from(env.ENCRYPTION_KEY ?? "", "base64");
if (encKey.length !== 32) {
  console.error("ENCRYPTION_KEY missing or not 32-byte base64 in .env.local");
  process.exit(1);
}

// Mirrors lib/crypto.ts — kept inline so this script stays runnable as plain
// node without a TypeScript build step.
function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const d = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
}

const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}

const query = new URL(`${baseUrl.replace(/\/$/, "")}/rest/v1/integrations`);
query.searchParams.set("provider", "eq.stripe");
query.searchParams.set("select", "user_id,access_token,config,updated_at");

const res = await fetch(query, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  cache: "no-store",
});
if (!res.ok) {
  console.error(`query failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}

const rows = await res.json();
const secret = [];
const restricted = [];
const unreadable = [];

for (const row of rows) {
  if (!row.access_token) continue;
  let key;
  try {
    key = decrypt(row.access_token);
  } catch {
    // Wrong ENCRYPTION_KEY, or a row encrypted under a rotated one.
    unreadable.push(row.user_id);
    continue;
  }
  const bucket = key.startsWith("sk_") ? secret : restricted;
  bucket.push({ user_id: row.user_id, mode: row.config?.mode ?? "?", updated_at: row.updated_at });
}

console.log(`stripe integrations: ${rows.length}`);
console.log(`  restricted (rk_): ${restricted.length}`);
console.log(`  SECRET (sk_):     ${secret.length}`);
if (unreadable.length) console.log(`  unreadable:       ${unreadable.length}`);

if (secret.length) {
  console.log("\nThese users hold a full secret key and must rotate it in Stripe:");
  for (const r of secret) console.log(`  ${r.user_id}  ${r.mode} mode  connected ${r.updated_at}`);
  console.log("\nAfter they rotate, have them reconnect with a restricted (rk_) key.");
}
if (unreadable.length) {
  console.log("\nCould not decrypt (wrong or rotated ENCRYPTION_KEY):");
  for (const id of unreadable) console.log(`  ${id}`);
}
