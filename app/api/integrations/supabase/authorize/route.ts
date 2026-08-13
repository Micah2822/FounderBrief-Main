import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, newVerifier } from "@/lib/supabase-oauth";
import { SECURE_COOKIES } from "@/lib/cookies";

// Starts the Supabase Management API handshake so the user picks a project from
// a list instead of hunting for a service_role key. PKCE is required by
// Supabase, so the verifier rides along in its own httpOnly cookie.
export async function GET(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const state = randomBytes(16).toString("hex");
  const verifier = newVerifier();

  let url: string;
  try {
    url = authorizeUrl({ appUrl, state, verifier });
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_OAUTH_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const secure = SECURE_COOKIES;
  const res = NextResponse.redirect(url);
  res.cookies.set("sb_oauth_state", state, { httpOnly: true, secure, maxAge: 600, path: "/" });
  res.cookies.set("sb_oauth_verifier", verifier, { httpOnly: true, secure, maxAge: 600, path: "/" });
  return res;
}
