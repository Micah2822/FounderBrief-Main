import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BriefView } from "@/components/BriefView";
import { Landing } from "@/components/Landing";
import { Chat } from "@/components/Chat";
import { GenerateButton } from "@/components/GenerateButton";
import { RefreshBrief } from "@/components/RefreshBrief";
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

  const admin = createAdminClient();
  const [{ data: settings }, { data: integrations }] = await Promise.all([
    admin.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("integrations").select("provider").eq("user_id", user.id),
  ]);

  if (!integrations?.length) redirect("/onboarding");

  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? "")
    ? searchParams.date
    : undefined;

  let query = admin
    .from("briefs")
    .select("content, brief_date")
    .eq("user_id", user.id)
    .order("brief_date", { ascending: false })
    .limit(1);
  if (requestedDate) query = query.eq("brief_date", requestedDate);
  const { data: briefRows } = await query;
  const brief = (briefRows?.[0]?.content as Brief) ?? null;

  // Adjacent brief dates for the archive nav
  let prevDate: string | null = null;
  let nextDate: string | null = null;
  if (brief) {
    const [{ data: prev }, { data: next }] = await Promise.all([
      admin
        .from("briefs")
        .select("brief_date")
        .eq("user_id", user.id)
        .lt("brief_date", brief.brief_date)
        .order("brief_date", { ascending: false })
        .limit(1),
      admin
        .from("briefs")
        .select("brief_date")
        .eq("user_id", user.id)
        .gt("brief_date", brief.brief_date)
        .order("brief_date", { ascending: true })
        .limit(1),
    ]);
    prevDate = prev?.[0]?.brief_date ?? null;
    nextDate = next?.[0]?.brief_date ?? null;
  }

  const tz = settings?.timezone ?? "UTC";

  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      {brief ? (
        <BriefView brief={brief} greeting={greetingFor(tz)} />
      ) : (
        <div className="rise">
          <p className="eyebrow border-t-2 border-ink pt-3">Founder Brief</p>
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
