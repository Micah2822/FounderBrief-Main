import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { exchangeCode, MAX_COOKIE_BYTES, TOKEN_COOKIE } from "@/lib/supabase-oauth";
import { SECURE_COOKIES } from "@/lib/cookies";

// Completes the Management API handshake. The token is put in an encrypted,
// httpOnly, 10-minute cookie and never written to the database — see the note
// at the top of lib/supabase-oauth.ts for why.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const jar = cookies();
  const savedState = jar.get("sb_oauth_state")?.value;
  const verifier = jar.get("sb_oauth_verifier")?.value;

  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/onboarding?error=${reason}`);
    res.cookies.delete("sb_oauth_state");
    res.cookies.delete("sb_oauth_verifier");
    return res;
  };

  if (!code || !state || state !== savedState || !verifier) {
    console.error("supabase callback: state check failed", {
      hasCode: !!code,
      hasState: !!state,
      stateMatches: state === savedState,
      hasVerifier: !!verifier,
    });
    return fail("supabase_state");
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
  let token: string;
  try {
    token = await exchangeCode({ code, verifier, appUrl });
  } catch (e) {
    console.error("supabase callback: token exchange failed", e);
    return fail("supabase_token");
  }

  const sealed = encrypt(token);
  if (sealed.length > MAX_COOKIE_BYTES) {
    // Browsers truncate rather than reject an oversized cookie, which would
    // surface later as an undecryptable blob. Fail loudly here instead.
    console.error("supabase callback: encrypted token exceeds cookie limit", {
      bytes: sealed.length,
    });
    return fail("supabase_token");
  }

  const res = NextResponse.redirect(`${origin}/onboarding?step=supabase-project`);
  res.cookies.set(TOKEN_COOKIE, sealed, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
  });
  res.cookies.delete("sb_oauth_state");
  res.cookies.delete("sb_oauth_verifier");
  return res;
}
