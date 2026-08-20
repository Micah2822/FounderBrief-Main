import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefForUser } from "@/lib/brief/generate";
import { sendBriefEmail, sendCronAlertEmail } from "@/lib/email/send";
import { addDays, localDateString, localHour } from "@/lib/dates";
import type { Brief } from "@/lib/types";

// Vercel Pro's ceiling. The three constants below are derived from it and only
// make sense together — see the budget arithmetic on START_DEADLINE_MS before
// changing any of them. On Hobby this must come back to 60.
export const maxDuration = 300;

/**
 * How many users are generated at once.
 *
 * The work is almost entirely waiting on other people's APIs — GitHub,
 * Stripe, Plausible, OpenAI — so running one user at a time left the function
 * idle for nearly all of its budget.
 *
 * Most rate limits here are per-user, not shared: GitHub's 5,000/hour is per
 * installation, and the Stripe and Plausible keys belong to individual
 * founders, so widening this does not push any one customer closer to a limit.
 * **OpenAI is the exception** — that quota is shared across every user in a
 * run, and it is the reason this is ten rather than "all of them". Each user
 * also fans out to a dozen or more upstream calls of their own, so the real
 * concurrency against those APIs is this number multiplied by that fan-out.
 *
 * Raise it via CRON_CONCURRENCY if the drain loop starts needing several
 * passes; watch for OpenAI 429s in the logs, which is what too high looks
 * like.
 */
const CONCURRENCY = Number(process.env.CRON_CONCURRENCY) || 10;

/**
 * The longest one user may take before the run gives up on them.
 *
 * None of the collectors set a fetch timeout, so a hung upstream — a GitHub
 * or OpenAI request that never returns — would otherwise hold a worker slot
 * until the platform killed the whole function. That was survivable at a 60s
 * ceiling. At 300s a single hung request could silently swallow most of the
 * run, which is a far worse trade: one stuck user costs everybody behind them.
 *
 * 60s is deliberately far above the ~8–20s a real user takes, so this fires
 * only on a genuine hang and never on a merely slow day. The timed-out user is
 * recorded as a failure, alerted on, and retried next pass.
 *
 * `Promise.race` frees the *slot*, it does not cancel the work — the orphaned
 * request runs on until the invocation ends. That is harmless here because
 * every write is an idempotent upsert keyed by (user, day), so a late arrival
 * cannot corrupt anything.
 */
const USER_TIMEOUT_MS = 60_000;

/**
 * Stop *starting* new users after this long, and return normally.
 *
 * The original loop ran until Vercel killed it mid-user. Everything after that
 * point was lost: no alert email (the send happens after the loop), no
 * response body, and no record of who had been skipped — briefs silently
 * failed to arrive and nothing anywhere said so.
 *
 * The budget has to hold even in the worst case, which is a user started one
 * millisecond before the deadline who then hits USER_TIMEOUT_MS:
 *
 *     225s (deadline) + 60s (timeout) + ~5s (alert email) = 290s < 300s
 *
 * Those three numbers must keep summing to less than `maxDuration`. Raising
 * the deadline without lowering the timeout is how this starts being killed
 * again, and the symptom is the one it was written to prevent: silence.
 *
 * Users not reached are reported as `deferred`, and the workflow's drain loop
 * calls straight back to collect them — see ARCHITECTURE › Scheduling.
 */
const START_DEADLINE_MS = 225_000;

/** Reject if `p` has not settled in `ms`, without leaving a timer behind. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    // Without this the pending timer keeps the event loop alive after the work
    // is done, and every fast user adds a minute to the invocation's tail.
    clearTimeout(timer);
  }
}

type DueUser = {
  user_id: string;
  timezone: string;
  send_hour: number;
  email_enabled: boolean;
  briefDate: string;
  overdueHours: number;
};

// Runs hourly (vercel.json + .github/workflows/hourly-brief.yml).
// For every user whose local time has reached their send hour and who has not
// had yesterday's brief yet: collect → generate → email. Idempotent per
// (user, day).
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

  const startedAt = Date.now();
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

  const fail = (userId: string, stage: string) => {
    results[userId] = "error";
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
    failedUserIds.push(userId);
  };

  // ── Who is due ────────────────────────────────────────────────────────
  //
  // The rule is `local hour >= send_hour`, NOT `=== send_hour`. Exact
  // equality meant a single missed tick lost that user their brief for the
  // day, permanently and silently: the next hour no longer matched them, and
  // nothing ever looked back. GitHub Actions schedules are best-effort and are
  // routinely delayed past the hour under load, so this was not a rare case —
  // a late run skipped an entire timezone's cohort.
  //
  // A window costs nothing to be generous with, because "already done" is
  // decided by the stored brief rather than by the clock: a user who has been
  // sent yesterday's brief is filtered out below and stays filtered out for
  // the rest of the day. The window closes on its own at local midnight, when
  // the hour resets below send_hour and the target date moves on.
  const due: DueUser[] = [];
  for (const u of users ?? []) {
    try {
      const hour = localHour(u.timezone);
      if (hour < u.send_hour) continue;
      due.push({
        ...u,
        briefDate: addDays(localDateString(u.timezone), -1),
        overdueHours: hour - u.send_hour,
      });
    } catch (e) {
      // An unparseable timezone would throw once per hour forever. Settings
      // validates it, so reaching here means a row written another way.
      console.error(`cron: bad timezone for ${u.user_id}`, e);
      fail(u.user_id, "timezone");
    }
  }

  // ── Drop the ones already finished ────────────────────────────────────
  //
  // Purely an optimisation, and deliberately so: `processUser` re-reads the
  // row it needs anyway, so if this query fails the run is slower and still
  // correct. Never let it become load-bearing.
  //
  // It matters because the window above keeps users eligible all day. Without
  // it, every user who had already been sent their brief would still cost a
  // point-read every hour until local midnight — O(users) reads per tick
  // forever, growing through the day. Keying on brief_date rather than user id
  // keeps the filter to one query with at most three distinct dates in it, no
  // matter how many users there are.
  const pending = await dropCompleted(db, due);

  // Most overdue first. Anyone skipped by a deadline last tick rises to the
  // front of the next one, so a short run degrades into "late" rather than
  // "never" and no user can be systematically starved by their position in
  // the table — which is what arbitrary database order used to mean.
  pending.sort((a, b) => b.overdueHours - a.overdueHours);

  // ── Generate, bounded and deadline-aware ──────────────────────────────
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      if (Date.now() - startedAt > START_DEADLINE_MS) return;
      const u = pending[cursor++];
      try {
        results[u.user_id] = await withTimeout(
          processUser(db, u),
          USER_TIMEOUT_MS,
          `user ${u.user_id}`
        );
      } catch (e) {
        console.error(`cron failed for ${u.user_id}`, e);
        // Coarse stage, derived from the message, so the alert can say *what*
        // broke without carrying the message itself — see sendCronAlertEmail.
        fail(u.user_id, stageOf(e));
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
  );

  const deferred = pending.filter((u) => !results[u.user_id]).map((u) => u.user_id);
  if (deferred.length) {
    console.warn(
      `cron hit the ${START_DEADLINE_MS}ms start deadline with ${deferred.length} user(s) left; the next tick takes them first`
    );
  }

  // Fires when a user failed, or when capacity ran out. Silence is the normal
  // state. Off entirely unless ALERT_EMAIL is set. Wrapped because a broken
  // alert must never become a broken brief.
  if (failedUserIds.length || deferred.length) {
    try {
      await sendCronAlertEmail(
        stageCounts,
        failedUserIds,
        Object.keys(results).length,
        deferred.length
      );
    } catch (e) {
      console.error("cron alert failed to send", e);
    }
  }

  // The response body lists user ids and this repo's Actions logs are public,
  // so the workflow must never echo it — see ARCHITECTURE › Scheduling.
  return NextResponse.json({
    ok: true,
    due: due.length,
    attempted: pending.length,
    deferred: deferred.length,
    processed: results,
  });
}

/**
 * Remove users whose brief for their target date is already finished.
 *
 * "Finished" is the same question the per-user path asks, hoisted: a stored
 * brief that is not partial, and — for anyone who wants the email — already
 * emailed. A partial brief is never finished; it froze a day mid-evening, so
 * it must be regenerated once the day is over.
 *
 * A failed email leaves `emailed_at` null, so the user stays pending and the
 * next tick retries. That is a feature and it is why this reads the stamp
 * rather than tracking attempts.
 */
async function dropCompleted(
  db: ReturnType<typeof createAdminClient>,
  due: DueUser[]
): Promise<DueUser[]> {
  if (!due.length) return due;

  const dates = [...new Set(due.map((u) => u.briefDate))];
  // Metadata only. Selecting `content` here would pull every user's whole
  // brief across the wire to read one boolean off it.
  const { data, error } = await db
    .from("briefs")
    .select("user_id, brief_date, emailed_at, partial:content->>partial")
    .in("brief_date", dates);

  if (error) {
    console.error("cron: could not pre-filter finished briefs, processing all", error);
    return due;
  }

  const done = new Map<string, { emailed: boolean; partial: boolean }>();
  for (const row of data ?? []) {
    done.set(`${row.user_id}|${row.brief_date}`, {
      emailed: !!row.emailed_at,
      // Absent on a finished brief, so null reads as false. Compared as a
      // string because `->>` returns text, not a JSON boolean.
      partial: String((row as { partial?: unknown }).partial) === "true",
    });
  }

  return due.filter((u) => {
    const row = done.get(`${u.user_id}|${u.briefDate}`);
    if (!row) return true; // nothing stored yet
    if (row.partial) return true; // stale slice of a day, regenerate
    return u.email_enabled && !row.emailed; // still owed the email
  });
}

/** Collect, generate and email one user. Throws; the caller records the stage. */
async function processUser(
  db: ReturnType<typeof createAdminClient>,
  u: DueUser
): Promise<string> {
  const { briefDate } = u;
  const { data: existing } = await db
    .from("briefs")
    .select("id, emailed_at, content")
    .eq("user_id", u.user_id)
    .eq("brief_date", briefDate)
    .maybeSingle();

  // A stored brief is reused so a tick that fires twice in the same hour
  // doesn't regenerate and re-bill the LLM. A *partial* row is the one
  // exception: it froze a day mid-evening, so reusing it means the finished
  // day is never collected. That is how a day with commits in it got emailed
  // as a zero. Partial briefs are still stored (the UI reads them back from
  // here), so this is what makes them self-heal.
  const stale = (existing?.content as Brief | undefined)?.partial === true;
  const brief =
    existing?.content && !stale
      ? (existing.content as Brief)
      : await generateBriefForUser(u.user_id, briefDate);
  if (!brief) return "no-integrations";

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
      return "generated+emailed";
    }
  }
  return "generated";
}

/** Coarse failure stage, derived from the message and never carrying it. */
function stageOf(e: unknown): string {
  const msg = String(e);
  // First, deliberately. The wrapper spans every collector, so a hang cannot be
  // attributed to one of them — and "this user hung" is the more useful signal
  // than a guess at which upstream did it.
  if (/timed out/i.test(msg)) return "timeout";
  if (/github/i.test(msg)) return "collect:github";
  if (/supabase|postgrest/i.test(msg)) return "collect:supabase";
  if (/plausible/i.test(msg)) return "collect:plausible";
  if (/stripe/i.test(msg)) return "collect:stripe";
  if (/openai|llm/i.test(msg)) return "llm";
  if (/resend|email/i.test(msg)) return "email";
  return "unknown";
}
