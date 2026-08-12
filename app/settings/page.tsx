import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "@/components/SettingsForm";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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
      <SettingsForm
        email={user.email ?? ""}
        timezone={settings?.timezone ?? "UTC"}
        sendHour={settings?.send_hour ?? 7}
        emailEnabled={settings?.email_enabled ?? true}
        goal={settings?.goal ?? ""}
        integrations={(integrations ?? []).map((i) => ({
          provider: i.provider,
          detail:
            i.provider === "github"
              ? (i.config?.repos ?? []).join(", ")
              : i.provider === "plausible"
                ? (i.config?.domain ?? "")
                : i.provider === "stripe"
                  ? `${i.config?.mode ?? "live"} mode${i.config?.restricted ? ", restricted key" : ""}`
                  : i.config?.table
                    ? `table "${i.config.table}"`
                    : "",
        }))}
      />
    </main>
  );
}
