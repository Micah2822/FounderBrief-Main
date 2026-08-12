// Diagnoses "GitHub wouldn't issue a token for that installation".
//
//   node scripts/check-github-app.mjs
//
// Checks GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_PRIVATE_KEY from
// .env.local by signing an app JWT and calling GET /app — which validates the ID
// and the key together, without needing an installation. Then lists the
// installations and mints a token for each.
//
// Read-only. Never prints the private key or any token.

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

/**
 * A private key in .env.local is usually a quoted value spanning many lines, so
 * this cannot be parsed line-by-line — doing that captures only the -----BEGIN
 * line and reports a perfectly good key as truncated.
 */
function parseEnv(text) {
  const out = {};
  const re = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))\s*$/gm;
  for (const m of text.replace(/\r\n/g, "\n").matchAll(re)) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));

const appId = env.GITHUB_APP_ID;
const slug = env.GITHUB_APP_SLUG;
const rawKey = env.GITHUB_APP_PRIVATE_KEY;
let bad = false;

// ── 1. App ID ────────────────────────────────────────────────────────
if (!appId) {
  console.log("✗ GITHUB_APP_ID is missing");
  bad = true;
} else if (/^Iv\d|\./.test(appId)) {
  console.log(`✗ GITHUB_APP_ID looks like a *Client ID* ("${appId}")`);
  console.log("  The App ID is the plain number above it on the app's settings page.");
  bad = true;
} else if (!/^\d+$/.test(appId)) {
  console.log(`✗ GITHUB_APP_ID should be digits only, got "${appId}"`);
  bad = true;
} else {
  console.log(`✓ GITHUB_APP_ID = ${appId}`);
}

// ── 2. Slug ──────────────────────────────────────────────────────────
if (!slug) {
  console.log("✗ GITHUB_APP_SLUG is missing (the install URL needs it)");
  bad = true;
} else if (/[A-Z_ ]/.test(slug)) {
  console.log(`✗ GITHUB_APP_SLUG "${slug}" should be lowercase and hyphenated`);
  bad = true;
} else {
  console.log(`✓ GITHUB_APP_SLUG = ${slug}`);
}

// ── 3. Private key ───────────────────────────────────────────────────
let pem;
if (!rawKey) {
  console.log("✗ GITHUB_APP_PRIVATE_KEY is missing");
  bad = true;
} else {
  pem = rawKey.replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) {
    console.log("✗ GITHUB_APP_PRIVATE_KEY has no -----BEGIN header (truncated paste?)");
    bad = true;
  } else if (!pem.includes("-----END")) {
    console.log("✗ GITHUB_APP_PRIVATE_KEY has no -----END footer");
    console.log("  If the value spans several lines, wrap the whole thing in double quotes,");
    console.log("  or collapse it to one line with literal \\n between them.");
    bad = true;
  } else if (!pem.includes("\n")) {
    console.log("✗ GITHUB_APP_PRIVATE_KEY is one line with no newlines — escape them as \\n");
    bad = true;
  } else {
    console.log(`✓ GITHUB_APP_PRIVATE_KEY parses (${pem.split("\n").length} lines)`);
  }
}

if (bad) {
  console.log("\nFix the above, then re-run.");
  process.exit(1);
}

// ── 4. Sign a JWT and ask GitHub who we are ──────────────────────────
const b64url = (i) =>
  Buffer.from(i).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
let jwt;
try {
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  jwt = `${header}.${payload}.${b64url(signer.sign(pem))}`;
} catch (e) {
  console.log(`\n✗ Could not sign with that private key: ${e.message}`);
  console.log("  The PEM is present but malformed. Generate a fresh key on the app's page.");
  process.exit(1);
}

const gh = (path) =>
  fetch(`https://api.github.com${path}`, {
    method: path.endsWith("access_tokens") ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

const appRes = await gh("/app");
if (!appRes.ok) {
  const body = await appRes.text();
  console.log(`\n✗ GET /app failed (${appRes.status}): ${body}`);
  if (appRes.status === 401) {
    console.log("  401 means the App ID and the private key don't belong together —");
    console.log("  either the ID is wrong, or the key was generated for a different app.");
  }
  process.exit(1);
}

const app = await appRes.json();
console.log(`\n✓ Authenticated as GitHub App "${app.name}" (slug: ${app.slug})`);
if (slug !== app.slug) {
  console.log(`✗ GITHUB_APP_SLUG is "${slug}" but GitHub says "${app.slug}" — the install URL is wrong`);
}
console.log(`  permissions: ${JSON.stringify(app.permissions)}`);

// ── 5. Installations ─────────────────────────────────────────────────
const instRes = await gh("/app/installations");
if (!instRes.ok) {
  console.log(`\n✗ Could not list installations (${instRes.status})`);
  process.exit(1);
}
const installs = await instRes.json();
if (!installs.length) {
  console.log("\n✗ The app is not installed anywhere. Install it from onboarding first.");
  process.exit(1);
}

console.log(`\n✓ ${installs.length} installation(s):`);
for (const i of installs) {
  const tokenRes = await gh(`/app/installations/${i.id}/access_tokens`);
  const ok = tokenRes.ok ? "token OK" : `TOKEN FAILED ${tokenRes.status}`;
  console.log(`  id ${i.id} — ${i.account?.login} (${i.repository_selection}) — ${ok}`);
  if (!tokenRes.ok) console.log(`    ${await tokenRes.text()}`);
}
console.log("\nIf tokens mint here but the app still fails, the env vars differ in Vercel.");
