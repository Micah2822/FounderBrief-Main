import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

/**
 * Where Stripe Checkout returns the customer after paying.
 *
 * This exists because a webhook is a *push*, and pushes fail: the relay is
 * down, a deploy lands mid-delivery, the endpoint is briefly unreachable. If
 * the webhook is the only thing that grants access then every one of those
 * failures means somebody paid and the app never found out — the worst failure
 * this product can have, and one that is invisible to us and infuriating to
 * them.
 *
 * So access is not granted by being told. It is granted by asking. The customer
 * is standing in front of us with a session id; we retrieve that session from
 * Stripe and read the answer directly. Nothing has to arrive for this to work.
 *
 * The webhook is still needed, and is not redundant — it carries the events
 * that happen when nobody is here: a renewal failing, a cancellation at period
 * end, a card expiring. This route covers the one moment a person is present,
 * which happens to be the moment money changes hands.
 *
 * ── Why the ownership check is not optional ─────────────────────────────────
 * `session_id` arrives in a query string, so it is attacker-controlled. Without
 * verifying that the session's customer is *this* user's stored customer, any
 * signed-in person could paste somebody else's session id and be upgraded on
 * the strength of a stranger's payment.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${appUrl}/login`);

  // No session id: nothing to verify. Not an error — the webhook will catch up.
  if (!sessionId) return NextResponse.redirect(`${appUrl}/settings`);

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("user_settings")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;

    // The session must belong to this account, and it must be paid.
    const ownedByCaller =
      !!customerId && !!settings?.stripe_customer_id &&
      customerId === settings.stripe_customer_id;

    if (!ownedByCaller) {
      console.error("billing/return: session does not belong to caller", {
        userId: user.id,
        sessionCustomer: customerId,
      });
      return NextResponse.redirect(`${appUrl}/settings`);
    }

    if (session.payment_status === "paid" || session.status === "complete") {
      // Idempotent: the webhook may have already done this, and re-running a
      // successful upgrade costs nothing.
      const { error } = await admin
        .from("user_settings")
        .update({ tier: "founder" })
        .eq("user_id", user.id);
      if (error) {
        console.error("billing/return: tier update failed", error);
        return NextResponse.redirect(`${appUrl}/settings?billing=pending`);
      }
      return NextResponse.redirect(`${appUrl}/settings?upgraded=1`);
    }

    // Paid asynchronously (some payment methods settle later). The webhook is
    // the right mechanism for that case, so say so rather than claiming failure.
    return NextResponse.redirect(`${appUrl}/settings?billing=pending`);
  } catch (e) {
    // Stripe unreachable, or a session id that does not exist. The webhook and
    // scripts/audit-billing.mjs are the remaining safety nets.
    console.error("billing/return: could not verify session", e);
    return NextResponse.redirect(`${appUrl}/settings?billing=pending`);
  }
}
