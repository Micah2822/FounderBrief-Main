import type { TrafficDayData } from "@/lib/types";

// Plausible Analytics — website traffic. One aggregate endpoint, an API key
// and a domain. Plausible buckets days in the site's own configured timezone.

const BASE = "https://plausible.io/api/v1";

async function aggregate(
  key: string,
  domain: string,
  fromDate: string,
  toDate: string
): Promise<{ visitors: number; pageviews: number }> {
  const url = new URL(`${BASE}/stats/aggregate`);
  url.searchParams.set("site_id", domain);
  url.searchParams.set("period", "custom");
  url.searchParams.set("date", `${fromDate},${toDate}`);
  url.searchParams.set("metrics", "visitors,pageviews");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Plausible ${res.status}`);
  const json = await res.json();
  return {
    visitors: json.results?.visitors?.value ?? 0,
    pageviews: json.results?.pageviews?.value ?? 0,
  };
}

export async function collectTraffic(
  key: string,
  domain: string,
  dateStr: string // YYYY-MM-DD
): Promise<TrafficDayData> {
  const [day, top_sources] = await Promise.all([
    aggregate(key, domain, dateStr, dateStr),
    topSources(key, domain, dateStr),
  ]);
  return { ...day, domain, top_sources };
}

/** Where yesterday's visitors came from — the "did my post work?" answer. */
async function topSources(
  key: string,
  domain: string,
  dateStr: string
): Promise<{ source: string; visitors: number }[]> {
  try {
    const url = new URL(`${BASE}/stats/breakdown`);
    url.searchParams.set("site_id", domain);
    url.searchParams.set("period", "custom");
    url.searchParams.set("date", `${dateStr},${dateStr}`);
    url.searchParams.set("property", "visit:source");
    url.searchParams.set("metrics", "visitors");
    url.searchParams.set("limit", "3");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.results ?? [])
      .map((r: any) => ({ source: String(r.source), visitors: r.visitors ?? 0 }))
      .filter((r: any) => r.visitors > 0);
  } catch {
    return []; // sources are additive detail — never fail the collection over them
  }
}

export async function visitorsInWindow(
  key: string,
  domain: string,
  fromDate: string,
  toDate: string
): Promise<number> {
  return (await aggregate(key, domain, fromDate, toDate)).visitors;
}

/** Used at connect time to prove the domain + key pair works. */
export async function verifyPlausible(key: string, domain: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await aggregate(key, domain, today, today);
}
