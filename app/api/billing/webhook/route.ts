import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, PAID_STATUSES } from "@/lib/stripe";

// Node, not Edge: signature verification needs Node's crypto.
export const runtime = "nodejs";

/**
 * Stripe → app, for everything that happens when nobody is present: a renewal
 * failing, a cancellation reaching period end, a card expiring.
 *
 * It is deliberately **not** the only way the paid tier is granted. Webhooks are
 * pushes and pushes fail, so `/api/billing/return` grants it by asking Stripe
 * directly the moment the customer comes back from checkout. This route still
 * handles the upgrade events too — they usually arrive first and it is
 * idempotent — but nothing depends on them arriving.
 *
 * ── The signature is the authorisation boundary ──────────────────────────────
 * Stripe sends no session cookie, so this path is public in `middleware.ts` and
 * anyone on the internet can POST to it. `constructEvent` is the only thing
 * standing between a stranger and a free `tier = 'founder'`. It must be given
 * the **raw body** — `request.text()`, never `.json()`, because re-serialising
 * changes the bytes that were signed — and a failure here must return, never
 * fall through to the handlers below.
 *
 * ── Tenant lookup ────────────────────────────────────────────────────────────
 * Users are resolved by `stripe_customer_id`, because Stripe events carry no
 * user id. That is a real tenant filter rather than a cross-tenant read only
 * because migration `0004` puts a unique index on that column, so one customer
 * maps to at most one user. This route is listed in check-tenant-scoping's
 * ALLOWED for exactly that reason; if the index is ever dropped, the exemption
 * stops being true.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) {
    console.error("billing/webhook: STRIPE_BILLING_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "no signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch (e) {
    // Deliberately terse. An unsigned POST is either a misconfiguration or
    // somebody probing; neither deserves detail in the response.
    console.error("billing/webhook: signature verification failed");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const customerId = customerIdFrom(event);
  if (!customerId) return NextResponse.json({ received: true });

  const tier = tierFrom(event);
  if (tier === null) return NextResponse.json({ received: true });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .update({ tier })
    .eq("stripe_customer_id", customerId)
    .select("user_id");

  if (error) {
    // 500 so Stripe retries: the alternative is a paid customer stuck on free.
    console.error("billing/webhook: tier update failed", { type: event.type, error });
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  // No row is not an error — a deleted account, or a customer created in a
  // different environment. 200 so Stripe stops retrying something that will
  // never succeed.
  if (!data?.length) {
    console.warn("billing/webhook: no user for customer", { type: event.type, customerId });
  }

  return NextResponse.json({ received: true });
}

function customerIdFrom(event: Stripe.Event): string | null {
  const object = event.data.object as { customer?: string | { id: string } | null };
  const customer = object.customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * The tier this event implies, or null for events we take no action on.
 *
 * `checkout.session.completed` is handled as well as the subscription events so
 * Settings is already correct when the user lands back on it — the subscription
 * event usually arrives in the same second, but "usually" is not a guarantee
 * and the alternative is a page that still says Free after paying.
 *
 * Cancellation needs no special case: `cancel_at_period_end` leaves the status
 * `active` until the period actually ends, and `deleted` fires then.
 */
function tierFrom(event: Stripe.Event): "free" | "founder" | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return session.mode === "subscription" ? "founder" : null;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      return PAID_STATUSES.includes(subscription.status) ? "founder" : "free";
    }
    case "customer.subscription.deleted":
      return "free";
    default:
      return null;
  }
}
