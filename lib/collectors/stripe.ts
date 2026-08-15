import type { RevenueDayData } from "@/lib/types";

// Stripe — revenue and customers, via the REST API directly (no SDK dep).
// Founders should use a RESTRICTED key (rk_...) with read-only access to
// Charges and Customers. Amounts are converted from cents to major units.

const BASE = "https://api.stripe.com/v1";

async function stripeList(
  key: string,
  path: string,
  params: Record<string, string>
): Promise<any[]> {
  const items: any[] = [];
  let starting_after: string | undefined;
  // Cap at 3 pages (300 items/day) — beyond that scale, sums are estimates
  for (let page = 0; page < 3; page++) {
    const url = new URL(BASE + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("limit", "100");
    if (starting_after) url.searchParams.set("starting_after", starting_after);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Stripe ${path} → ${res.status}`);
    const json = await res.json();
    items.push(...(json.data ?? []));
    if (!json.has_more || !json.data?.length) break;
    starting_after = json.data[json.data.length - 1].id;
  }
  return items;
}

function unix(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

/** Gross revenue (succeeded charges, dominant currency) in a window. */
export async function revenueInWindow(
  key: string,
  from: Date,
  to: Date
): Promise<{ gross: number; currency: string; charges: number }> {
  const charges = await stripeList(key, "/charges", {
    "created[gte]": unix(from),
    "created[lt]": unix(to),
  });
  const succeeded = charges.filter((c) => c.status === "succeeded" && c.paid);
  // Sum only the dominant currency — never silently mix currencies
  const byCurrency = new Map<string, number>();
  for (const c of succeeded) {
    byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + c.amount);
  }
  let currency = "usd";
  let cents = 0;
  for (const [cur, amt] of byCurrency) {
    if (amt > cents) {
      currency = cur;
      cents = amt;
    }
  }
  return {
    gross: Math.round(cents) / 100,
    currency,
    charges: succeeded.length,
  };
}

export async function collectRevenue(
  key: string,
  range: { from: Date; to: Date }
): Promise<RevenueDayData> {
  const [rev, customers] = await Promise.all([
    revenueInWindow(key, range.from, range.to),
    stripeList(key, "/customers", {
      "created[gte]": unix(range.from),
      "created[lt]": unix(range.to),
    }),
  ]);
  return {
    gross_revenue: rev.gross,
    currency: rev.currency,
    charges: rev.charges,
    new_customers: customers.length,
  };
}

/** Used at connect time to prove the key works and can read charges. */
/**
 * Check the key can read **both** resources the brief needs.
 *
 * This used to test `/charges` only, so a key granted Charges but not Customers
 * connected cleanly, showed a tick, and then failed every night when the brief
 * counted new customers — the founder having no reason to suspect the key.
 * Stripe's permission list is grouped into collapsed categories, so granting
 * one and missing the other is the likely mistake, not an unlikely one.
 *
 * Stripe's own message names the missing permission ("This API key does not
 * have the required permissions..."), which is far more useful than anything we
 * could write, and stays correct when Stripe redesigns its permission UI.
 * Passed through verbatim rather than replaced.
 */
export async function verifyStripe(key: string): Promise<void> {
  for (const resource of ["charges", "customers"] as const) {
    const res = await fetch(`${BASE}/${resource}?limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.ok) continue;

    const detail = await res
      .json()
      .then((b) => b?.error?.message as string | undefined)
      .catch(() => undefined);
    throw new Error(
      detail ?? `Stripe rejected this key when reading ${resource} (${res.status}).`
    );
  }
}
