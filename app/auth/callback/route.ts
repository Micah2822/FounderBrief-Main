import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Not the primary sign-in path any more — sign-in is an emailed code verified
// in the browser (app/login/page.tsx), which never redirects here. This stays
// as a safety net: if an auth email template is ever left holding
// {{ .ConfirmationURL }} instead of {{ .Token }}, the link it sends still
// lands somewhere that signs the user in rather than dropping them on a page
// that ignores the code.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // The user_settings row is created by an auth.users trigger (migration
      // 0002), so it already exists by the time we get here.
      const admin = createAdminClient();
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
