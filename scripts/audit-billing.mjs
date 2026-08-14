// Compares Stripe to the database and reports every disagreement.
//
//   node scripts/audit-billing.mjs            # report only
//   node scripts/audit-billing.mjs --apply    # fix the tier mismatches
//
// Stripe is the source of truth for who is paying. Three things can disagree:
//
//   PAYING BUT ON FREE    someone paid and did not get what they paid for
//   FOUNDER BUT UNPAID    we are giving the product away
//   NO ACCOUNT            a subscription still billing a deleted account
//
// --apply fixes the first two, which are a column update. It never cancels a
// subscription: taking someone's access away and stopping their billing is a
// deliberate act, not something that should be one typo away in a script.
//
// This is a backstop, not the mechanism. /api/billing/return grants the tier by
// asking Stripe the moment the customer returns from checkout, and the webhook
// handles what happens when nobody is present. Run this when a customer says
// "I paid and it still says Free", or occasionally to confirm the answer is
// still "nothing to report".
//
// Read-only without --apply. Needs SUPABASE_SERVICE_ROLE_KEY and
// STRIPE_BILLING_SECRET_KEY from .env.local, so run it locally against
// production values. The Stripe environment follows the key.

import { readFileSync } from "node:fs";
import Stripe from "stripe";

// PostgREST over plain fetch rather than supabase-js: the SDK constructs a
// Realtime client on import, which cannot start on Node < 22 without a
// WebSocket polyfill even though nothing here subscribes to anything.

/** Quoted values may span lines (see scripts/check-github-app.mjs). */
function parseEnv(text) {
  const out = {};
  const re = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))\s*$/gm;
  for (const m of text.replace(/\r\n/g, "\n").matchAll(re)) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

const apply = process.argv.includes("--apply");
const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));

const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = env.STRIPE_BILLING_SECRET_KEY;
if (!baseUrl || !serviceKey || !stripeKey) {
  console.error(
    "Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STRIPE_BILLING_SECRET_KEY in .env.local"
  );
  process.exit(1);
}

// Must match PAID_STATUSES in lib/stripe.ts. If these drift, this script starts
// "fixing" rows to disagree with the webhook and the two fight each other.
const PAID_STATUSES = ["active", "trialing", "past_due"];

const rest = (path, init) =>
  fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

const res = await rest(
  "user_settings?stripe_customer_id=not.is.null&select=user_id,stripe_customer_id,tier"
);
if (!res.ok) {
  console.error(`Supabase read failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
const byCustomer = new Map(rows.map((r) => [r.stripe_customer_id, r]));

const stripe = new Stripe(stripeKey);
const mode = stripeKey.includes("_live_") ? "live" : "test";

const paying = new Set();
const orphans = [];
for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
  if (!PAID_STATUSES.includes(sub.status)) continue;
  const id = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!id) continue;
  paying.add(id);
  if (!byCustomer.has(id)) orphans.push({ customer: id, subscription: sub.id, status: sub.status });
}

const underpaid = rows.filter((r) => paying.has(r.stripe_customer_id) && r.tier !== "founder");
const overGranted = rows.filter((r) => !paying.has(r.stripe_customer_id) && r.tier === "founder");

console.log(`Stripe environment: ${mode}`);
console.log(`Accounts with a Stripe customer: ${rows.length}`);
console.log(`Customers with a paid subscription: ${paying.size}\n`);

if (!underpaid.length && !overGranted.length && !orphans.length) {
  console.log("Nothing to report — Stripe and the database agree.");
  process.exit(0);
}

for (const r of underpaid) console.log(`PAYING BUT ON FREE   ${r.user_id}  ${r.stripe_customer_id}`);
for (const r of overGranted) console.log(`FOUNDER BUT UNPAID   ${r.user_id}  ${r.stripe_customer_id}`);
for (const o of orphans) console.log(`NO ACCOUNT           ${o.customer}  ${o.subscription}  ${o.status}`);

if (orphans.length) {
  console.log(
    `\n${orphans.length} subscription(s) billing someone who cannot log in to stop it.` +
      `\nCancel by hand: Stripe dashboard -> Customers -> <id> -> Delete.`
  );
}

if (!apply) {
  const fixable = underpaid.length + overGranted.length;
  if (fixable) console.log(`\n${fixable} tier mismatch(es). Re-run with --apply to fix.`);
  process.exit(underpaid.length || orphans.length ? 1 : 0);
}

console.log("");
for (const [list, tier] of [[underpaid, "founder"], [overGranted, "free"]]) {
  for (const r of list) {
    const patch = await rest(`user_settings?user_id=eq.${r.user_id}`, {
      method: "PATCH",
      body: JSON.stringify({ tier }),
    });
    console.log(patch.ok ? `set ${tier}  ${r.user_id}` : `FAILED  ${r.user_id}  ${await patch.text()}`);
  }
}
