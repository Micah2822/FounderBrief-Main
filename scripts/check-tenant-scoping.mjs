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
    const stmt = src.slice(m.index, end === -1 ? src.length : end);
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
