import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { installUrl, newState } from "@/lib/github/app-auth";

// Sends the user to GitHub to install the app. GitHub's own screen is where
// they choose which repositories the app can see; the picker in onboarding is a
// separate, narrower choice about which of those the brief actually tracks.
export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  let url: string;
  const state = newState();
  try {
    url = installUrl(state);
  } catch {
    return NextResponse.json({ error: "GITHUB_APP_SLUG not configured" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const res = NextResponse.redirect(url);
  res.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: appUrl.startsWith("https"),
    // Choosing repositories on GitHub's screen is not a ten-second job for
    // someone with a long repo list, and an expired cookie here reads as a
    // failed install rather than a timeout.
    maxAge: 1800,
    path: "/",
    sameSite: "lax", // must survive the top-level GET redirect back from github.com
  });
  return res;
}
