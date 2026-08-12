import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstallationToken } from "@/lib/github/app-auth";

// Where GitHub returns after the user installs the app. Unlike the OAuth App
// this replaced, there is no code-for-token exchange and nothing secret to
// store: GitHub hands back an installation_id, and tokens are minted from it on
// demand. `access_token` is deliberately left null.
//
// GitHub reaches this route via the app's **Setup URL**, not its Callback URL —
// the Callback URL only governs the user-authorization flow, which this app does
// not use. If Setup URL is unset, installs finish on github.com and this handler
// never runs: the symptom is a Connect button that never changes, with nothing
// in the logs because no request was ever made.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const installationId = searchParams.get("installation_id");
  const state = searchParams.get("state");
  const savedState = cookies().get("gh_oauth_state")?.value;

  // The state check is not a formality here. Without it, anyone could point a
  // logged-in user's account at an installation_id they don't own — and because
  // tokens are minted from *our* app key, that would hand the other party's
  // repositories to whoever's account holds the row.
  if (!state) {
    console.error("github callback: GitHub returned no state", {
      hasSavedState: !!savedState,
      setupAction: searchParams.get("setup_action"),
      hint: "Setup URL may be missing ?state passthrough, or this was a direct install from github.com",
    });
    return NextResponse.redirect(`${origin}/onboarding?error=github_no_state`);
  }

  if (state !== savedState) {
    console.error("github callback: state check failed", {
      hasSavedState: !!savedState,
      hint: savedState ? "mismatch" : "cookie expired or the flow began in another browser",
    });
    return NextResponse.redirect(`${origin}/onboarding?error=github_state`);
  }

  if (!installationId) {
    // Reachable if the user backs out of GitHub's install screen.
    console.error("github callback: no installation_id", {
      setupAction: searchParams.get("setup_action"),
    });
    return NextResponse.redirect(`${origin}/onboarding?error=github_install`);
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // Mint once before saving. A bad app id, a mangled private key or a
  // half-completed install all surface here rather than as a silently empty
  // brief days later.
  try {
    await getInstallationToken(installationId);
  } catch (e) {
    console.error("github callback: installation token failed", e);
    return NextResponse.redirect(`${origin}/onboarding?error=github_token`);
  }

  const admin = createAdminClient();

  // Re-running the install (setup_action=update, e.g. the user changed which
  // repos GitHub can see) must not wipe the repositories they chose to track.
  const { data: existing } = await admin
    .from("integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "github")
    .maybeSingle();
  const keptRepos =
    existing?.config?.installation_id === Number(installationId) ||
    existing?.config?.installation_id === installationId
      ? (existing?.config?.repos ?? [])
      : [];

  const { error: saveError } = await admin.from("integrations").upsert(
    {
      user_id: user.id,
      provider: "github",
      access_token: null,
      config: { installation_id: installationId, repos: keptRepos },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );
  if (saveError) {
    // Without this the page redirects to ?step=repos as though it worked, and
    // the only symptom is a Connect button that never changes.
    console.error("github callback: failed to save integration", saveError);
    return NextResponse.redirect(`${origin}/onboarding?error=github_save`);
  }

  const res = NextResponse.redirect(`${origin}/onboarding?step=repos`);
  res.cookies.delete("gh_oauth_state");
  return res;
}
