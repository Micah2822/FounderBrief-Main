import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefForUser } from "@/lib/brief/generate";
import type { Brief } from "@/lib/types";

export const maxDuration = 60;

/** No row carries a non-zero figure — the day recorded nothing at all. */
function isEmptyLedger(brief: Brief): boolean {
  if (!brief.yesterday.length) return true;
  return brief.yesterday.every((row) => {
    const n = parseFloat(row.value.replace(/[^0-9.-]/g, ""));
    return !Number.isFinite(n) || n === 0;
  });
}

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
    let brief = await generateBriefForUser(user.id);
    if (!brief) {
      return NextResponse.json(
        { error: "Connect at least one tool first — GitHub, Supabase, or Plausible." },
        { status: 400 }
      );
    }

    // A brief generated on demand can land at any hour, and it reports on
    // yesterday — so a founder who connected their tools this afternoon after
    // a quiet Thursday gets a page of zeroes and reasonably concludes the
    // product is broken rather than that the day was quiet. When yesterday
    // holds nothing at all, fall forward to today so far, which is the
    // activity they actually recognise. The scheduled 7am email never takes
    // this path: at 7am "today" is three hours old and genuinely empty.
    if (isEmptyLedger(brief)) {
      const soFar = await generateBriefForUser(user.id, undefined, { partial: true });
      if (soFar && !isEmptyLedger(soFar)) brief = soFar;
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
