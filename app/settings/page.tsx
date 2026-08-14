import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "@/components/SettingsForm";
import { Wordmark } from "@/components/Wordmark";
import { FREE_CONNECTOR_LIMIT } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { billing?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: settings }, { data: integrations }] = await Promise.all([
    admin.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("integrations").select("provider, config").eq("user_id", user.id),
  ]);

  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <p className="eyebrow border-t-2 border-ink pt-3 flex justify-between">
        <Wordmark suffix="Settings" />
        <Link href="/" className="hover:text-ink transition-colors normal-case tracking-normal">
          ← Back to brief
        </Link>
      </p>
      {/* Set by /api/billing/return when it could not confirm the payment with
          Stripe. Without it the founder lands back here still showing Free
          having just paid, with nothing to explain why. */}
      {searchParams.billing === "pending" && (
        <p className="text-[13px] text-muted leading-relaxed border border-line rounded-md px-4 py-3 mt-6">
          Your payment is going through. This page updates on its own once
          Stripe confirms it — usually within a minute. Nothing to do.
        </p>
      )}
      <SettingsForm
        email={user.email ?? ""}
        timezone={settings?.timezone ?? "UTC"}
        sendHour={settings?.send_hour ?? 7}
        emailEnabled={settings?.email_enabled ?? true}
        goal={settings?.goal ?? ""}
        tier={settings?.tier === "founder" ? "founder" : "free"}
        connectorLimit={FREE_CONNECTOR_LIMIT}
        integrations={(integrations ?? []).map((i) => ({
          provider: i.provider,
          detail:
            i.provider === "github"
              ? (i.config?.repos ?? []).join(", ")
              : i.provider === "plausible"
                ? (i.config?.domain ?? "")
                : i.provider === "stripe"
                  ? // An explicit false means a secret key stored before rk_ was
                    // required — say so, since only the user can rotate it.
                    `${i.config?.mode ?? "live"} mode${
                      i.config?.restricted === false
                        ? " — full secret key, please rotate and reconnect"
                        : ", read-only"
                    }`
                  : i.config?.table
                    ? `table "${i.config.table}"`
                    : "",
        }))}
      />
    </main>
  );
}
