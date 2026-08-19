// Fails if a route handler under /api has no authentication of its own.
//
//   node scripts/check-api-auth.mjs
//
// `middleware.ts` deliberately does NOT run on /api — see the note on its
// `config.matcher`. Excluding it removed a redundant network round trip to
// Supabase Auth on every API call and turned a nonsensical 307-to-/login into
// the route's own 401. What it also removed is the blanket session check that
// used to stand behind every handler.
//
// So the invariant is now: **every exported handler under /api authenticates
// itself.** One that forgets is not a weaker route, it is a public one. That
// used to be caught by middleware and is now caught by nothing — which is
// exactly the shape of problem check-tenant-scoping.mjs exists for, so this is
// its companion. Audited clean when written; the job is keeping it that way.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Handlers that authenticate by something other than a user session. Each
// needs a reason, and each reason is the thing that must stay true.
const ALLOWED = [
  {
    file: "app/api/cron/hourly/route.ts",
    method: "GET",
    gate: /CRON_SECRET/,
    why: "called by GitHub Actions with no session; the bearer CRON_SECRET compared with timingSafeEqual is the boundary, and it fails closed when the secret is unset",
  },
  {
    file: "app/api/billing/webhook/route.ts",
    method: "POST",
    gate: /constructEvent/,
    why: "Stripe sends no session cookie; the webhook signature verified against the RAW body is the boundary, and a failure must return rather than fall through",
  },
];

// What a session check looks like. `getUser()` revalidates against Supabase
// Auth; `getSession()` deliberately does NOT count — it trusts a cookie the
// client can write, which is the exact mistake this check exists to catch.
const SESSION_GATE = /\bgetUser\s*\(\s*\)/;

const METHOD = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;

// Several routes gate through a local `requireUser()` wrapper rather than
// calling getUser() inline, so a direct-call test alone reports them as
// unprotected. Collect the names of helpers *defined in this file* whose own
// body checks the session, and count a call to one of them as a gate.
//
// Deliberately file-local: a helper imported from elsewhere is not read here,
// and treating an unresolved name as a gate is how this check would start
// passing things it has not actually verified.
function localGateNames(src) {
  const names = new Set();
  const decl = /(?:async\s+function|function)\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const found = [...src.matchAll(decl)];
  for (let i = 0; i < found.length; i++) {
    const body = src.slice(found[i].index, found[i + 1]?.index ?? src.length);
    if (SESSION_GATE.test(body)) names.add(found[i][1]);
  }
  return names;
}

function gatesItself(body, helpers) {
  if (SESSION_GATE.test(body)) return true;
  for (const name of helpers) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(body)) return true;
  }
  return false;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts" || name === "route.tsx") out.push(p);
  }
  return out;
}

const problems = [];
const checked = [];

for (const path of walk(join(ROOT, "app", "api"))) {
  const src = readFileSync(path, "utf8");
  const rel = relative(ROOT, path);
  const helpers = localGateNames(src);

  // Each handler's body runs to the start of the next exported handler, or to
  // the end of the file — enough to tell whether it gates itself.
  const found = [...src.matchAll(METHOD)];
  for (let i = 0; i < found.length; i++) {
    const method = found[i][1];
    const body = src.slice(found[i].index, found[i + 1]?.index ?? src.length);
    const line = src.slice(0, found[i].index).split("\n").length;

    const exempt = ALLOWED.find((a) => a.file === rel && a.method === method);
    if (exempt) {
      // An exemption is only real while the gate it names is still there.
      if (exempt.gate.test(body)) checked.push(`${rel} ${method} (exempt)`);
      else problems.push({ rel, line, method, why: `exempt via ${exempt.gate}, but that gate is gone` });
      continue;
    }

    if (gatesItself(body, helpers)) checked.push(`${rel} ${method}`);
    else problems.push({ rel, line, method, why: "no getUser() and no documented exemption" });
  }
}

if (problems.length) {
  console.error("API routes with no authentication of their own:\n");
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}  ${p.method}  — ${p.why}`);
  }
  console.error(
    `\n${problems.length} unprotected handler${problems.length === 1 ? "" : "s"}.` +
      "\nmiddleware.ts does not run on /api, so nothing else is guarding these." +
      '\nAdd a getUser() check, or add an entry to ALLOWED in this script with a reason.'
  );
  process.exit(1);
}

console.log(
  `API auth OK — ${checked.length} handlers, each authenticating itself ` +
    `(${ALLOWED.length} documented exceptions).`
);
