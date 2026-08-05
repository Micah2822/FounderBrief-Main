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
  const token = (await tokenRes.json()).access_token;
  if (!token) return NextResponse.redirect(`${origin}/onboarding?error=github_token`);

  const admin = createAdminClient();
  await admin.from("integrations").upsert(
    {
      user_id: user.id,
      provider: "github",
      access_token: encrypt(token),
      config: {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  const res = NextResponse.redirect(`${origin}/onboarding?step=repos`);
  res.cookies.delete("gh_oauth_state");
  return res;
}
