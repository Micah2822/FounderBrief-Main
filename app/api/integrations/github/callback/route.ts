import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = cookies().get("gh_oauth_state")?.value;

  if (!code || !state || state !== savedState) {
    console.error("github callback: state check failed", {
      hasCode: !!code,
      hasState: !!state,
      hasSavedState: !!savedState,
      stateMatches: state === savedState,
    });
    return NextResponse.redirect(`${origin}/onboarding?error=github_state`);
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  // GitHub answers 200 with an error body rather than a non-2xx status, so the
  // status code alone tells you nothing.
  const tokenBody = await tokenRes.json();
  const token = tokenBody.access_token;
  if (!token) {
    console.error("github callback: no access token", {
      status: tokenRes.status,
      error: tokenBody.error,
      description: tokenBody.error_description,
    });
    return NextResponse.redirect(`${origin}/onboarding?error=github_token`);
  }

  const admin = createAdminClient();
  const { error: saveError } = await admin.from("integrations").upsert(
    {
      user_id: user.id,
      provider: "github",
      access_token: encrypt(token),
      config: {},
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
