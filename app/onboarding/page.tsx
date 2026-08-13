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
  github_install:
    "The install didn't finish — GitHub didn't tell us which installation to use. Try again and complete the install on GitHub's screen.",
  github_no_state:
    "GitHub sent you back without the security token we issued. If you started this from GitHub's own site, start from the Connect button here instead. If you're the operator: the GitHub App's Setup URL needs to be set (see README section 2).",
  github_token:
    "GitHub wouldn't issue a token for that installation. Try connecting again — if it keeps happening, the GitHub App's ID or private key is likely wrong.",
  github_save:
    "GitHub connected, but saving the connection failed. Try again — if it persists, this is a server-side problem, not something you can fix here.",
  supabase_state:
    "Supabase sent you back, but the security check didn't match. This usually means the attempt was started in another tab or took too long. Try connecting again.",
  supabase_token:
    "Supabase didn't complete the handshake. Try connecting again — or use the manual option to paste a key instead.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string; step?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: integrations } = await admin
    .from("integrations")
    .select("provider, config")
    .eq("user_id", user.id);

  // A github row without an installation_id was written by the old OAuth App and
  // can no longer mint a token. Treat it as disconnected so the user is offered
  // Connect again rather than a step that silently never produces data.
  const github = integrations?.find(
    (i) => i.provider === "github" && i.config?.installation_id
  );
  const product = integrations?.find((i) => i.provider === "supabase");
  const traffic = integrations?.find((i) => i.provider === "plausible");
  const stripe = integrations?.find((i) => i.provider === "stripe");
  const connectError = searchParams.error
    ? (CONNECT_ERRORS[searchParams.error] ?? "That connection didn't complete. Try again.")
    : null;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      {/* A <div>, where the other mastheads use a <p>: sign-out is a POST form,
          and a <form> is flow content that a <p> cannot legally contain — the
          browser closes the paragraph early and the row falls apart. */}
      <div className="eyebrow border-t-2 border-ink pt-3 flex items-baseline justify-between">
        <Wordmark suffix="Setup" />
        {/* Onboarding is otherwise a dead end. It has no footer, and a "back to
            brief" link would bounce: app/page.tsx redirects any user with no
            integrations straight back here. Signing out is the only exit. */}
        <form action="/auth/signout" method="post">
          {/* uppercase + tracking are re-applied by hand. The browser's UA
              stylesheet sets text-transform:none and letter-spacing:normal on
              form controls, so a <button> does NOT inherit them from .eyebrow
              the way the landing page's <a href="/login">Sign in</a> does. */}
          <button
            type="submit"
            className="uppercase tracking-[0.14em] hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
      {connectError && (
        <p className="text-[13px] text-oxide leading-relaxed border border-line rounded-md px-4 py-3 mt-6">
          {connectError}
        </p>
      )}
      <OnboardingFlow
        githubConnected={!!github}
        githubRepos={github?.config?.repos ?? []}
        supabaseConnected={!!product}
        supabasePickingProject={searchParams.step === "supabase-project"}
        plausibleConnected={!!traffic}
        stripeConnected={!!stripe}
      />
    </main>
  );
}
