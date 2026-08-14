import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

/**
 * Opens the Stripe Customer Portal.
 *
 * This is why the app has no billing UI of its own: cancellation, card updates,
 * invoices and renewal dates all live in Stripe's hosted portal, which is also
 * why no subscription status is mirrored into our database.
 *
 * The portal must be **activated** in the Stripe dashboard (Settings → Billing
 * → Customer portal), separately per environment. Without that, the call below
 * fails with a configuration error that reads exactly like an application bug —
 * see README section 5.3.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error("billing/portal: missing NEXT_PUBLIC_APP_URL");
    return NextResponse.json({ error: "Billing isn't configured." }, { status: 500 });
  }

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("user_settings")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!settings?.stripe_customer_id) {
    return NextResponse.json({ error: "no_customer" }, { status: 400 });
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: settings.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("billing/portal: session create failed", e);
    return NextResponse.json({ error: "Couldn't open billing." }, { status: 502 });
  }
}
