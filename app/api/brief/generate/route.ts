import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefForUser } from "@/lib/brief/generate";

export const maxDuration = 60;

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Rate limit: one generation per 30s per user. Each run fans out to
  // GitHub/Plausible/OpenAI — don't let a stuck button hammer them.
  const admin = createAdminClient();
  const { data: throttle } = await admin
    .from("user_settings")
    .select("last_generate_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (
    throttle?.last_generate_at &&
    Date.now() - new Date(throttle.last_generate_at).getTime() < 30000
  ) {
    return NextResponse.json(
      { error: "Your brief was just generated — try again in a moment." },
      { status: 429 }
    );
  }
  await admin
    .from("user_settings")
    .upsert(
      { user_id: user.id, last_generate_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  try {
    const brief = await generateBriefForUser(user.id);
    if (!brief) {
      return NextResponse.json(
        { error: "Connect at least one tool first — GitHub, Supabase, or Plausible." },
        { status: 400 }
      );
    }
    // First successful brief completes onboarding
    await admin
      .from("user_settings")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("onboarded_at", null);

    return NextResponse.json({ brief });
  } catch (e: any) {
    console.error("brief generate failed", e);
    return NextResponse.json({ error: "Brief generation failed." }, { status: 500 });
  }
}
