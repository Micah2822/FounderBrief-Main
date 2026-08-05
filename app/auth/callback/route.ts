import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Ensure settings row exists on first sign-in
      const admin = createAdminClient();
      await admin
        .from("user_settings")
        .upsert({ user_id: data.user.id }, { onConflict: "user_id", ignoreDuplicates: true });

      const { data: settings } = await admin
        .from("user_settings")
        .select("onboarded_at")
        .eq("user_id", data.user.id)
        .maybeSingle();

      return NextResponse.redirect(
        `${origin}${settings?.onboarded_at ? "/" : "/onboarding"}`
      );
    }
  }
  return NextResponse.redirect(`${origin}/login`);
}
