import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GITHUB_CLIENT_ID not configured" }, { status: 500 });
  }

  const state = randomBytes(16).toString("hex");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${appUrl}/api/integrations/github/callback`);
  url.searchParams.set("scope", "repo read:user");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: appUrl.startsWith("https"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
