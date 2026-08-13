import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefForUser } from "@/lib/brief/generate";
import type { Brief } from "@/lib/types";

export const maxDuration = 60;

// Standing state, not activity: an open PR count is the same number whether or
// not the founder did anything that day, so it must not make a quiet day look
// busy and suppress the fallback below.
const STANDING_ROWS = new Set(["Open pull requests"]);

/** No row carries a non-zero figure — the day recorded nothing at all. */
function isEmptyLedger(brief: Brief): boolean {
  const activity = brief.yesterday.filter((row) => !STANDING_ROWS.has(row.label));
  if (!activity.length) return true;
  return activity.every((row) => {
    const n = parseFloat(row.value.replace(/[^0-9.-]/g, ""));
    return !Number.isFinite(n) || n === 0;
  });
}

export async function POST(request: Request) {
  // ?today=1 asks for the day in progress instead of yesterday. The founder
  // reading at 6pm knows what they did today; the daily rhythm still belongs
  // to yesterday, so this is an explicit choice rather than a new default.
  const wantsToday = new URL(request.url).searchParams.get("today") === "1";
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
    let brief = await generateBriefForUser(user.id, undefined, { partial: wantsToday });
    if (!brief) {
      return NextResponse.json(
        { error: "Connect at least one tool first — GitHub, Supabase, or Plausible." },
        { status: 400 }
      );
    }

    // A brief generated on demand can land at any hour, and it reports on
    // yesterday — so a founder who connects at 3pm after a quiet Thursday gets
    // a page of zeroes and reasonably concludes the product is broken rather
    // than that the day was quiet.
    //
    // Only ever forward to today, never back to an older day. Silently serving
    // a three-week-old brief reads as the product losing track of what day it
    // is — and the founder already learns how long it has been from the
    // "last activity was N days ago" line, which is the useful form of that
    // information. A quiet day should look quiet, not be hidden.
    //
    // Skipped when today was asked for explicitly: an empty "today so far" at
    // 9am is the honest answer to the question that was asked.
    if (!wantsToday && isEmptyLedger(brief)) {
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
