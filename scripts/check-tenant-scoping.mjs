// Fails if a service-role query is missing its tenant filter.
//
//   node scripts/check-tenant-scoping.mjs
//
// `createAdminClient()` carries no user context and bypasses RLS, so a query
// without `.eq("user_id", …)` returns *every tenant's* rows and nothing objects.
// In the brief pipeline that is worse than a normal leak: `allowedNumbers()`
// would make another founder's figures quotable in this founder's prose.
//
// RLS cannot catch this — bypassing it is the point of the service role — so
// the protection has always been "remember every time". This makes it
// mechanical instead. Audited clean when written; the job is keeping it that way.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Queries that are correct *because* they span tenants. Each needs a reason.
const ALLOWED = [
  {
    file: "app/api/cron/hourly/route.ts",
    table: "user_settings",
    why: "the cron's whole job is to walk every onboarded user; selects no tenant data beyond scheduling fields",
  },
  {
    file: "app/api/cron/hourly/route.ts",
    table: "briefs",
    why: "the pre-filter that drops users whose brief is already finished. Spans tenants for the same reason the user_settings select above does — the cron walks everyone — and is keyed by brief_date because there are at most three distinct ones, where a user_id list would be every user. Reads no brief CONTENT, only (user_id, brief_date, emailed_at, partial), and the result is used solely to decide who to skip: nothing crosses into another tenant's brief or prompt. It is also purely an optimisation — processUser re-reads its own row scoped by user_id — so removing it changes speed, not correctness.",
  },
  {
    file: "app/api/billing/webhook/route.ts",
    table: "user_settings",
    why: "Stripe events carry no user_id, so the tenant is resolved by stripe_customer_id — a real tenant filter only because migration 0004 puts a unique index on that column. If that index is ever dropped, this exemption stops being true.",
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = [join(ROOT, "app"), join(ROOT, "lib")].flatMap((d) => walk(d));
const problems = [];

for (const path of files) {
  const src = readFileSync(path, "utf8");
  // Only files that actually reach the database with the service role.
  if (!src.includes("createAdminClient")) continue;
  const rel = relative(ROOT, path);

  const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
  for (const m of src.matchAll(re)) {
    const table = m[1];
    // The statement runs to the next `;` — builder chains and upsert argument
    // objects both terminate there, and neither contains one internally.
    const end = src.indexOf(";", m.index);
    let stmt = src.slice(m.index, end === -1 ? src.length : end);

    // Strip the argument to `.select(...)` before looking for the filter.
    //
    // A column list is not a tenant filter, but it is the most likely place
    // for the string "user_id" to appear — so `.select("user_id, brief_date")`
    // with no `.eq()` anywhere used to satisfy this check while reading every
    // tenant's rows. That is precisely the bug this script exists to catch,
    // and it was passing it.
    stmt = stmt.replace(/\.select\(\s*(["'`])[\s\S]*?\1/g, ".select(");

    if (stmt.includes("user_id")) continue;

    const line = src.slice(0, m.index).split("\n").length;
    if (ALLOWED.some((a) => a.file === rel && a.table === table)) continue;
    problems.push({ rel, line, table });
  }
}

if (problems.length) {
  console.error("Service-role queries with no tenant filter:\n");
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}  .from("${p.table}")`);
  }
  console.error(
    `\n${problems.length} unscoped quer${problems.length === 1 ? "y" : "ies"}.` +
      "\nAdd .eq(\"user_id\", …), or add an entry to ALLOWED in this script with a reason."
  );
  process.exit(1);
}

console.log(`Tenant scoping OK — every service-role query filters by user_id (${ALLOWED.length} documented exception${ALLOWED.length === 1 ? "" : "s"}).`);
