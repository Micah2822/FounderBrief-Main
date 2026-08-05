import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OnboardingFlow } from "@/components/OnboardingFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: integrations } = await admin
    .from("integrations")
    .select("provider, config")
    .eq("user_id", user.id);

  const github = integrations?.find((i) => i.provider === "github");
  const product = integrations?.find((i) => i.provider === "supabase");
  const traffic = integrations?.find((i) => i.provider === "plausible");
  const stripe = integrations?.find((i) => i.provider === "stripe");

  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <p className="eyebrow border-t-2 border-ink pt-3">Founder Brief · Setup</p>
      <OnboardingFlow
        githubConnected={!!github}
        githubRepos={github?.config?.repos ?? []}
        supabaseConnected={!!product}
        plausibleConnected={!!traffic}
        stripeConnected={!!stripe}
      />
    </main>
  );
}
