import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { sendOrphanedCustomerAlert } from "@/lib/email/send";

/**
 * Permanent account deletion.
 *
 * Deleting the `auth.users` row is the whole operation *inside this database*:
 * every table in migration `0001` carries `references auth.users(id) on delete
 * cascade`, so briefs, daily_metrics, integrations, chat_messages,
 * tool_requests and user_settings all go with it. Do not add manual cleanup for
 * a table here — a hand-written delete list silently falls out of date when a
 * table is added, and the cascade cannot.
 *
 * Anything added later that stores user data must cascade from `auth.users`
 * too, or this route quietly stops being complete and the privacy policy stops
 * being true.
 *
 * **Stripe is the one exception, and it is not a violation of the rule above.**
 * The cascade reaches this database and nothing else. A subscription lives in
 * Stripe and outlives the row that pointed at it, so deleting the account
 * without cancelling would leave a person with no account, no way to cancel
 * from the app, and a $19 charge every month — and no record left to identify
 * them by, because `stripe_customer_id` went with the cascade.
 */
export async function DELETE() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Read before deleting: the cascade destroys the only link to Stripe.
  const { data: settings } = await admin
    .from("user_settings")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Stripe first, and the ordering is the design. Deleting the customer cancels
  // every subscription it holds — one call, no listing, no status filtering.
  // Done after the cascade it would be impossible. So the order chooses which
  // failure we get when something breaks halfway: "cancelled but not deleted",
  // which the user sees and can retry, over "deleted but still billed", which
  // nobody sees and which keeps taking their money.
  if (settings?.stripe_customer_id) {
    try {
      await stripe.customers.del(settings.stripe_customer_id);
    } catch (e: any) {
      // Already gone is the success case, not something to wake anyone for.
      if (e?.code !== "resource_missing") {
        // Never block deletion on Stripe being reachable: the UI promises this
        // is immediate and permanent, and a Stripe outage must not mean nobody
        // can delete their account. Alert with the ids needed to finish by hand.
        console.error("account deletion: stripe customer delete failed", e);
        await sendOrphanedCustomerAlert(user.id, settings.stripe_customer_id).catch(
          () => {}
        );
      }
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("account deletion failed", error);
    return NextResponse.json({ error: "Couldn't delete your account." }, { status: 500 });
  }

  // The user row is gone, so the session's refresh token is already dead. This
  // clears the cookies so the browser isn't left holding a token for an account
  // that no longer exists.
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
