import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BriefView } from "@/components/BriefView";
import { Landing } from "@/components/Landing";
import { Chat } from "@/components/Chat";
import { GenerateButton } from "@/components/GenerateButton";
import { RefreshBrief } from "@/components/RefreshBrief";
import { TodayBrief } from "@/components/TodayBrief";
import { Wordmark } from "@/components/Wordmark";
import { localHour } from "@/lib/dates";
import type { Brief } from "@/lib/types";

export const dynamic = "force-dynamic";

function greetingFor(tz: string): string {
  const h = localHour(tz);
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}

export default async function Home({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <Landing />;

  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? "")
    ? searchParams.date
    : undefined;

  const admin = createAdminClient();

  // One round trip, not three.
  //
  // These four reads used to run as three sequential awaits: settings +
  // integrations, then the brief, then the two adjacent dates for the archive
  // nav. Nothing forced that order except how it was written — the brief does
  // not depend on the settings, and the neighbouring dates only needed the
  // *date*, which the dates list below already carries.
  //
  // Sequential awaits are not free even now that the database is in the same
  // region as the function: each one is a fresh HTTP request whose cost lands
  // in full on a cold instance. Issuing them together makes the page wait for
  // the slowest, rather than the sum.
  const briefQuery = admin
    .from("briefs")
    .select("content")
    .eq("user_id", user.id)
    .order("brief_date", { ascending: false })
    .limit(1);

  const [{ data: settings }, { data: integrations }, { data: briefRows }, { data: dateRows }] =
    await Promise.all([
      // Only `timezone` is read below. `select("*")` also pulled the Stripe
      // customer id and the tier into a page that has no use for either.
      admin.from("user_settings").select("timezone").eq("user_id", user.id).maybeSingle(),
      admin.from("integrations").select("provider").eq("user_id", user.id),
      requestedDate ? briefQuery.eq("brief_date", requestedDate) : briefQuery,
      // Every brief date this user has, newest first — one narrow indexed row
      // per day, which is what makes replacing two queries with this a saving
      // rather than a trade. The explicit limit is a guard against PostgREST's
      // configurable row cap silently truncating the archive instead: ten
      // years of daily briefs, well past anything reachable.
      admin
        .from("briefs")
        .select("brief_date")
        .eq("user_id", user.id)
        .order("brief_date", { ascending: false })
        .limit(3650),
    ]);

  // Deliberately after the fetch, not before. The redirect discards three
  // queries when it fires, which costs nothing — they ran in parallel with the
  // one that decides it, and this branch is only ever taken once per account.
  if (!integrations?.length) redirect("/onboarding");

  const brief = (briefRows?.[0]?.content as Brief) ?? null;

  // Adjacent brief dates for the archive nav, read off the list rather than
  // fetched. Newest-first ordering means the older neighbour is the *next*
  // entry and the newer one is the previous — the same rows the old `.lt()`
  // and `.gt()` queries returned.
  let prevDate: string | null = null;
  let nextDate: string | null = null;
  if (brief) {
    const dates = (dateRows ?? []).map((d) => d.brief_date as string);
    const i = dates.indexOf(brief.brief_date);
    if (i !== -1) {
      prevDate = dates[i + 1] ?? null;
      nextDate = dates[i - 1] ?? null;
    }
  }

  const tz = settings?.timezone ?? "UTC";

  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      {brief ? (
        <BriefView brief={brief} greeting={greetingFor(tz)} />
      ) : (
        <div className="rise">
          <p className="eyebrow border-t-2 border-ink pt-3">
            <Wordmark />
          </p>
          <h1 className="font-serif text-[34px] leading-tight mt-10">
            Your first brief is one click away.
          </h1>
          <p className="text-muted text-[15px] leading-relaxed mt-3 mb-8 max-w-md">
            Your tools are connected. Generate today&apos;s brief now — from
            tomorrow it will be waiting here every morning.
          </p>
          <GenerateButton label="Generate my first brief" />
        </div>
      )}

      {brief && <Chat />}

      {/* Quiet footer: archive nav + actions */}
      <footer className="mt-16 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-5">
        <div className="flex items-center gap-4 font-mono text-[12px] text-muted">
          {prevDate && (
            <Link href={`/?date=${prevDate}`} className="hover:text-ink transition-colors">
              ← {prevDate}
            </Link>
          )}
          {nextDate && (
            <Link href={`/?date=${nextDate}`} className="hover:text-ink transition-colors">
              {nextDate} →
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4 font-mono text-[12px] text-muted">
          {/* Only on a partial brief, where the masthead's "Today so far"
              switch is gone because you are already there — this re-reads it,
              so it belongs beside Refresh. */}
          {brief?.partial && <TodayBrief partial />}
          {brief && <RefreshBrief />}
          <Link href="/settings" className="hover:text-ink transition-colors">
            Settings
          </Link>
          <form action="/auth/signout" method="post" className="inline">
            <button type="submit" className="hover:text-ink transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </footer>
    </main>
  );
}
