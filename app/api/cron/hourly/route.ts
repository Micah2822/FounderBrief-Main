import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefForUser } from "@/lib/brief/generate";
import { sendBriefEmail, sendCronAlertEmail } from "@/lib/email/send";
import { addDays, localDateString, localHour } from "@/lib/dates";
import type { Brief } from "@/lib/types";

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
  const { data: users, error: usersError } = await db
    .from("user_settings")
    .select("user_id, timezone, send_hour, email_enabled")
    .not("onboarded_at", "is", null);

  // Not a feature — the route reporting what happened. This used to return 200,
  // claiming success while nobody got a brief. A 500 fails the Action, and
  // GitHub emails about a failed workflow.
  //
  // The ALERT_EMAIL alert below cannot cover this case: if we cannot list users
  // the loop never runs, so nothing is ever marked failed and no alert is sent.
  // That is why both exist. See ARCHITECTURE › Knowing when a brief fails.
  if (usersError) {
    console.error("cron could not list users", usersError);
    return NextResponse.json({ error: "could not list users" }, { status: 500 });
  }

  const results: Record<string, string> = {};
  const stageCounts: Record<string, number> = {};
  const failedUserIds: string[] = [];

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

      // A stored brief is reused so a tick that fires twice in the same hour
      // doesn't regenerate and re-bill the LLM. A *partial* row is the one
      // exception: it froze a day mid-evening, so reusing it means the
      // finished day is never collected. That is how a day with commits in it
      // got emailed as a zero. Partial briefs are still stored (the UI reads
      // them back from here), so this is what makes them self-heal.
      const stale = (existing?.content as Brief | undefined)?.partial === true;
      const brief =
        existing?.content && !stale
          ? (existing.content as Brief)
          : await generateBriefForUser(u.user_id, briefDate);
      if (!brief) {
        results[u.user_id] = "no-integrations";
        continue;
      }

      // A partial that was already emailed sent the wrong numbers, so the
      // corrected brief should go out rather than being suppressed by the
      // emailed_at stamp the bad one left behind.
      const alreadyEmailed = !stale && !!existing?.emailed_at;
      if (u.email_enabled && !alreadyEmailed) {
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
      // Coarse stage, derived from the message, so the alert can say *what*
      // broke without carrying the message itself — see sendCronAlertEmail.
      const msg = String(e);
      const stage = /github/i.test(msg)
        ? "collect:github"
        : /supabase|postgrest/i.test(msg)
          ? "collect:supabase"
          : /plausible/i.test(msg)
            ? "collect:plausible"
            : /stripe/i.test(msg)
              ? "collect:stripe"
              : /openai|llm/i.test(msg)
                ? "llm"
                : /resend|email/i.test(msg)
                  ? "email"
                  : "unknown";
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
      failedUserIds.push(u.user_id);
    }
  }

  // Fires only when a user actually failed, so silence is the normal state.
  // Off entirely unless ALERT_EMAIL is set. Wrapped because a broken alert must
  // never become a broken brief.
  if (failedUserIds.length) {
    try {
      await sendCronAlertEmail(stageCounts, failedUserIds, Object.keys(results).length);
    } catch (e) {
      console.error("cron alert failed to send", e);
    }
  }

  // The response body lists user ids and this repo's Actions logs are public,
  // so the workflow must never echo it — see ARCHITECTURE › Scheduling.
  return NextResponse.json({ ok: true, processed: results });
}
