import { createAdminClient } from "@/lib/supabase/admin";

/**
 * How many tools a free account may connect.
 *
 * Two, not three, because there are only four connectors and a large share of
 * founders can connect no more than two or three of them anyway — GitHub is
 * near-universal and Stripe is common, but Supabase requires being on Supabase
 * and Plausible is a paid analytics product. At a limit of three, most users
 * would never meet the limit at all. Two is also the smallest number at which
 * the product still works: one source is a statistic, not a brief.
 */
export const FREE_CONNECTOR_LIMIT = 2;

export type Tier = "free" | "founder";

export async function getTier(userId: string): Promise<Tier> {
  const db = createAdminClient();
  const { data } = await db
    .from("user_settings")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.tier === "founder" ? "founder" : "free";
}

/**
 * Would connecting `provider` add a tool this user does not already have?
 *
 * The `provider` exclusion is the whole point and is not an optimisation.
 * Every connector route writes with `upsert`, so a plain `count >= LIMIT` would
 * refuse a free user at the limit who is *re-saving something they already
 * have*: rotating a leaked Plausible key, or re-running the GitHub App install
 * to change which repositories it can see. They are at two, and one of those
 * two is the row being rewritten. Excluding the provider under consideration
 * makes this ask the question the paywall actually means — "is this a new
 * tool?" — rather than "are you at the limit right now?".
 *
 * Reads the tier and the connector list in one round trip; both queries are
 * scoped by user_id, as `npm run check:scoping` requires.
 */
export async function canAddConnector(
  userId: string,
  provider: string
): Promise<boolean> {
  const db = createAdminClient();
  const [{ data: settings }, { data: integrations }] = await Promise.all([
    db.from("user_settings").select("tier").eq("user_id", userId).maybeSingle(),
    db.from("integrations").select("provider").eq("user_id", userId),
  ]);

  if (settings?.tier === "founder") return true;

  const others = (integrations ?? []).filter((i) => i.provider !== provider);
  return others.length < FREE_CONNECTOR_LIMIT;
}

/**
 * The 402 every JSON connector route returns when the limit is reached.
 *
 * Payment Required rather than Forbidden: the client needs to tell "you are at
 * your plan limit" apart from "your session expired", and 403 is already what
 * an expired session looks like from the outside.
 */
export const CONNECTOR_LIMIT_MESSAGE =
  "Free covers two connected tools. Upgrade to Founder to connect more.";
