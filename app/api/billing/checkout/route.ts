import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { getTier } from "@/lib/billing";

/**
 * Starts a Checkout Session for the Founder plan.
 *
 * The Stripe customer is created (or reused) and **persisted before the session
 * is created**, deliberately. It means every webhook event can resolve its user
 * by `stripe_customer_id` alone: one lookup path, no metadata parsing, and no
 * "event for a customer we've never seen" branch to get wrong.
 *
 * The user id comes from the session, never from the request body — a body that
 * could name a user id would let anyone buy a subscription for someone else, or
 * more usefully to an attacker, attach their own payment to another account.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const price = process.env.STRIPE_PRICE_FOUNDER;
  if (!appUrl || !price) {
    console.error("billing/checkout: missing NEXT_PUBLIC_APP_URL or STRIPE_PRICE_FOUNDER");
    return NextResponse.json({ error: "Billing isn't configured." }, { status: 500 });
  }

  // Already paying: send them to manage the subscription rather than sell them
  // a second one. Stripe would happily create it.
  if ((await getTier(user.id)) === "founder") {
    return NextResponse.json({ error: "already_subscribed" }, { status: 409 });
  }

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("user_settings")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = settings?.stripe_customer_id ?? null;

  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        // For finding the account from the Stripe dashboard. The app never
        // reads this back — the lookup goes the other way, by customer id.
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
    } catch (e) {
      console.error("billing/checkout: customer create failed", e);
      return NextResponse.json({ error: "Couldn't start checkout." }, { status: 502 });
    }

    const { error } = await admin
      .from("user_settings")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", user.id);
    // Stop here rather than proceeding: a session against a customer we failed
    // to record produces a payment whose webhook can never find its user.
    if (error) {
      console.error("billing/checkout: failed to store customer id", error);
      return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      // Returns through /api/billing/return, which verifies the session with
      // Stripe and grants the tier there and then. That is what stops a failed
      // webhook delivery from leaving a paying customer on the free plan —
      // access is granted by asking Stripe, not by waiting to be told.
      // {CHECKOUT_SESSION_ID} is substituted by Stripe, not by us.
      success_url: `${appUrl}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/settings`,
    });
    if (!session.url) throw new Error("no session url");
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("billing/checkout: session create failed", e);
    return NextResponse.json({ error: "Couldn't start checkout." }, { status: 502 });
  }
}
