import type { ProductDayData } from "@/lib/types";

// The founder's OWN Supabase project, connected as a data source.
// We use PostgREST directly: schema discovery via its OpenAPI root,
// row counts via HEAD + Prefer: count=exact. No SQL driver needed.

function headers(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** List tables and their timestamp-ish columns from the PostgREST OpenAPI spec. */
export async function discoverSchema(url: string, key: string) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: headers(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not reach that Supabase project (${res.status})`);
  const spec = await res.json();
  const defs = spec.definitions ?? {};
  return Object.entries(defs).map(([table, def]: [string, any]) => ({
    table,
    timestamp_columns: Object.entries(def.properties ?? {})
      .filter(([, p]: [string, any]) => /timestamp|date/i.test(p.format ?? ""))
      .map(([col]) => col),
  }));
}

async function countRows(
  url: string,
  key: string,
  table: string,
  tsColumn?: string,
  from?: Date,
  to?: Date
): Promise<number> {
  const u = new URL(`${url.replace(/\/$/, "")}/rest/v1/${table}`);
  u.searchParams.set("select", "*");
  if (tsColumn && from) u.searchParams.append(tsColumn, `gte.${from.toISOString()}`);
  if (tsColumn && to) u.searchParams.append(tsColumn, `lt.${to.toISOString()}`);
  const res = await fetch(u, {
    method: "HEAD",
    headers: { ...headers(key), Prefer: "count=exact" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Count on ${table} failed (${res.status})`);
  const range = res.headers.get("content-range"); // "0-24/31" or "*/31"
  return parseInt(range?.split("/")[1] ?? "0", 10) || 0;
}

export async function collectProduct(
  url: string,
  key: string,
  table: string,
  tsColumn: string,
  range: { from: Date; to: Date }
): Promise<ProductDayData> {
  const [new_signups, total_signups] = await Promise.all([
    countRows(url, key, table, tsColumn, range.from, range.to),
    countRows(url, key, table),
  ]);
  return { new_signups, total_signups, table };
}

/**
 * When the most recent row was created, or null if the table is empty or
 * unreadable.
 *
 * Without this the brief could only say "no new signups for two days", which is
 * true whenever yesterday and the day before were both empty — and reads as
 * though signups stopped on Monday even when the last one was months ago. The
 * founder's real question is "how long has it been", and that needs the actual
 * date, not the absence of two.
 */
export async function lastRowAt(
  url: string,
  key: string,
  table: string,
  tsColumn: string
): Promise<string | null> {
  const u = new URL(`${url.replace(/\/$/, "")}/rest/v1/${table}`);
  u.searchParams.set("select", tsColumn);
  u.searchParams.set("order", `${tsColumn}.desc`);
  u.searchParams.set("limit", "1");
  const res = await fetch(u, { headers: headers(key), cache: "no-store" });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.[tsColumn] ?? null;
}

export async function countInWindow(
  url: string,
  key: string,
  table: string,
  tsColumn: string,
  from: Date,
  to: Date
): Promise<number> {
  return countRows(url, key, table, tsColumn, from, to);
}
