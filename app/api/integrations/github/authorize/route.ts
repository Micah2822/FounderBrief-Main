import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { installUrl, newState } from "@/lib/github/app-auth";
import { SECURE_COOKIES } from "@/lib/cookies";
import { canAddConnector } from "@/lib/billing";

// Sends the user to GitHub to install the app. GitHub's own screen is where
// they choose which repositories the app can see; the picker in onboarding is a
// separate, narrower choice about which of those the brief actually tracks.
export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  // Checked before the redirect so a free user at their limit never installs a
  // GitHub App on their repositories for a connection that will then be
  // refused. The callback checks again — that one is the enforcement, since it
  // is reachable directly.
  if (!(await canAddConnector(user.id, "github"))) {
    return NextResponse.redirect(new URL("/onboarding?error=limit", request.url));
  }

  // Computed before the URL is built: `redirect_uri` is sent to GitHub
  // explicitly so the same app serves localhost and production without
  // reordering callbacks in its settings. It must match a registered callback
  // exactly — apex and `www` count as different hosts.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  let url: string;
  const state = newState();
  try {
    url = installUrl(state, `${appUrl}/api/integrations/github/callback`);
  } catch {
    return NextResponse.json(
      { error: "GITHUB_APP_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    // Choosing repositories on GitHub's screen is not a ten-second job for
    // someone with a long repo list, and an expired cookie here reads as a
    // failed install rather than a timeout.
    maxAge: 1800,
    path: "/",
    sameSite: "lax", // must survive the top-level GET redirect back from github.com
  });
  return res;
}
