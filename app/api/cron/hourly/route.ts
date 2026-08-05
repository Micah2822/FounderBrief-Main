import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefForUser } from "@/lib/brief/generate";
import { sendBriefEmail } from "@/lib/email/send";
import { addDays, localDateString, localHour } from "@/lib/dates";

// 60s is the Vercel Hobby-plan cap and handles ~30 users per tz-hour.
// On Pro, raise to 300; past that, see POST_MVP.md → Stage 3 (queue).
export const maxDuration = 60;

// Runs hourly (vercel.json). For every user whose local time matches their
// send hour: collect → generate → email. Idempotent per (user, day).
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const authorized =
    !!process.env.CRON_SECRET && // fail closed if the secret isn't configured
    auth.length === expected.length &&
    timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: users } = await db
    .from("user_settings")
    .select("user_id, timezone, send_hour, email_enabled")
    .not("onboarded_at", "is", null);

  const results: Record<string, string> = {};

  for (const u of users ?? []) {
    try {
      if (localHour(u.timezone) !== u.send_hour) continue;

      const briefDate = addDays(localDateString(u.timezone), -1);
      const { data: existing } = await db
        .from("briefs")
        .select("id, emailed_at, content")
        .eq("user_id", u.user_id)
        .eq("brief_date", briefDate)
        .maybeSingle();

      const brief = existing?.content ?? (await generateBriefForUser(u.user_id, briefDate));
      if (!brief) {
        results[u.user_id] = "no-integrations";
        continue;
      }

      if (u.email_enabled && !existing?.emailed_at) {
        const { data: userRow } = await db.auth.admin.getUserById(u.user_id);
        const email = userRow?.user?.email;
        if (email && (await sendBriefEmail(email, brief))) {
          await db
            .from("briefs")
            .update({ emailed_at: new Date().toISOString() })
            .eq("user_id", u.user_id)
            .eq("brief_date", briefDate);
          results[u.user_id] = "generated+emailed";
          continue;
        }
      }
      results[u.user_id] = "generated";
    } catch (e) {
      console.error(`cron failed for ${u.user_id}`, e);
      results[u.user_id] = "error";
    }
  }

  return NextResponse.json({ ok: true, processed: results });
}
