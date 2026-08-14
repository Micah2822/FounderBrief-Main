import Stripe from "stripe";

/**
 * Billing client — **your** Stripe account, the one that charges for Founder
 * Brief. Not to be confused with `lib/collectors/stripe.ts`, which reads a
 * *user's* revenue using a key they pasted. Two different accounts; nothing
 * should ever make it easy to reach for the wrong one, which is what the
 * BILLING infix in the env var is for.
 *
 * `STRIPE_BILLING_SECRET_KEY` is a restricted key (`rk_`) with write on four
 * resources: Customers, Checkout Sessions, Customer portal, Subscriptions. A
 * secret key would additionally be able to create charges and issue refunds —
 * authority this product never exercises, and holding it would break the
 * invariant that we ask each tool for the least it will grant.
 *
 * No `apiVersion` is pinned: the SDK defaults to the version it was built
 * against, which moves only when the dependency is deliberately upgraded.
 *
 * **Constructed on first use, not at module scope.** Stripe's constructor
 * throws when the key is missing, and `app/api/account/route.ts` imports this
 * module — so building the client at import time meant one unset environment
 * variable took down *account deletion*, a route that has nothing to do with
 * billing. Deferring it means a missing key fails only when something actually
 * tries to talk to Stripe, and a user with no `stripe_customer_id` never does.
 */
let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) client = new Stripe(process.env.STRIPE_BILLING_SECRET_KEY!);
  return client;
}

/**
 * Subscription statuses that count as paid.
 *
 * `past_due` is deliberately included. Stripe retries a failed card for roughly
 * two weeks, and demoting someone on the first decline creates support work for
 * a customer who is about to pay anyway. The cost of being wrong is small:
 * connectors are grandfathered on downgrade, so a demotion never destroys
 * anything — it only blocks new connections.
 */
export const PAID_STATUSES = ["active", "trialing", "past_due"];
