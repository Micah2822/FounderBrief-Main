import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

// The GitHub callback reports failure by redirecting back here with ?error=.
// These were previously dropped on the floor, so a failed connect and a
// successful one looked identical: the Connect button simply never changed.
const CONNECT_ERRORS: Record<string, string> = {
  github_state:
    "GitHub sent you back, but the security check didn't match. This usually means the attempt was started in another tab or took too long. Try connecting again.",
  github_token:
    "GitHub didn't issue an access token. Try connecting again — if it keeps happening, the OAuth app's client secret is likely wrong.",
  github_save:
    "GitHub connected, but saving the connection failed. Try again — if it persists, this is a server-side problem, not something you can fix here.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
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
  const connectError = searchParams.error
    ? (CONNECT_ERRORS[searchParams.error] ?? "That connection didn't complete. Try again.")
    : null;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <p className="eyebrow border-t-2 border-ink pt-3">
        <Wordmark suffix="Setup" />
      </p>
      {connectError && (
        <p className="text-[13px] text-oxide leading-relaxed border border-line rounded-md px-4 py-3 mt-6">
          {connectError}
        </p>
      )}
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
