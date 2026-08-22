import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeUserCode,
  getInstallationToken,
  userOwnsInstallation,
} from "@/lib/github/app-auth";
import { canAddConnector } from "@/lib/billing";

// Where GitHub returns after the user installs the app. Nothing secret is
// stored: GitHub hands back an installation_id, tokens are minted from it on
// demand, and `access_token` is deliberately left null.
//
// The app uses "Request user authorization (OAuth) during installation", so
// GitHub reaches this route via the **Callback URL** (Redirect URI) carrying a
// `code` alongside the installation_id. Keep the Setup URL pointed here too —
// it costs nothing and covers the paths OAuth does not take.
//
// ── Why the code exchange is not optional ────────────────────────────────────
//
// An installation_id on its own is an unauthenticated claim. Tokens are minted
// from *our* app key, which works for every installation of this app — so a
// callback that trusts the id it is handed will give any signed-in account
// someone else's repositories.
//
// A state cookie cannot close that. It proves a browser started a flow, not
// that the installation belongs to the person finishing it, and an attacker
// starts a real flow in their own browser to get a valid one. So `state` is
// kept here as CSRF defence and nothing more; the actual gate is
// userOwnsInstallation(), which asks GitHub — with the user's own token —
// whether this installation is theirs to connect.
//
// That swap is also what fixes the dead-end for people who already had the app
// installed. GitHub drops `state` when it forwards an existing installation to
// its configure page, which used to be an unrecoverable rejection. It is now
// merely a missing bonus check, because identity arrives by `code` instead.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const installationId = searchParams.get("installation_id");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = cookies().get("gh_oauth_state")?.value;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // Only a positive mismatch is fatal. A *missing* state is the ordinary
  // already-installed path (see the note above) and is covered by the ownership
  // check below — rejecting it was the bug that stranded those users on GitHub.
  if (state && savedState && state !== savedState) {
    console.error("github callback: state mismatch", {
      hint: "flow began in another tab or another browser",
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

  if (!code) {
    console.error("github callback: no code", {
      setupAction: searchParams.get("setup_action"),
      hint: "'Request user authorization (OAuth) during installation' is off on the GitHub App, or the Redirect URI does not point here",
    });
    return NextResponse.redirect(`${origin}/onboarding?error=github_no_code`);
  }

  // The gate. Everything below this point trusts that the installation is
  // genuinely this user's, so nothing may be minted or written above it.
  try {
    const userToken = await exchangeUserCode(code);
    const owns = await userOwnsInstallation(userToken, installationId);
    if (!owns) {
      // Not necessarily an attack — someone can land here by finishing an
      // install while signed into a different GitHub account than the one that
      // owns it. Logged either way, because the malicious case looks identical.
      console.error("github callback: installation does not belong to this user", {
        installationId,
        userId: user.id,
      });
      return NextResponse.redirect(`${origin}/onboarding?error=github_not_yours`);
    }
  } catch (e) {
    console.error("github callback: ownership check failed", e);
    return NextResponse.redirect(`${origin}/onboarding?error=github_verify`);
  }

  // Before minting, so a refused connection never issues a token it cannot use.
  //
  // This must stay tolerant of the re-install case: setup_action=update sends a
  // user who already has a github row back through here, and canAddConnector
  // excludes the provider being written, so someone at the limit can still
  // change which repositories GitHub can see.
  if (!(await canAddConnector(user.id, "github"))) {
    return NextResponse.redirect(`${origin}/onboarding?error=limit`);
  }

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
