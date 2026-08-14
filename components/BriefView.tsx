import Link from "next/link";
import type { Brief } from "@/lib/types";
import { formatBriefDate } from "@/lib/dates";
import { Wordmark } from "@/components/Wordmark";
import { TodayBrief } from "@/components/TodayBrief";

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  supabase: "Supabase",
  plausible: "Analytics",
  stripe: "Stripe",
};

export function BriefView({
  brief,
  greeting,
  // Set when the brief is rendered as a specimen inside another page. The
  // masthead then stays inert: the surrounding page owns navigation, and a
  // second link home would be both a duplicate and a promise this box can't
  // keep — it is an illustration, not the reader's own brief.
  sample = false,
}: {
  brief: Brief;
  greeting: string;
  sample?: boolean;
}) {
  return (
    <article>
      {/* Wire-dispatch header */}
      <header className="rise border-t-2 border-ink">
        <p className="eyebrow flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-[10px]">
          <Wordmark linked={!sample} />
          {/* The date is the period the brief covers, not the day it was
              issued — a masthead reads as an issue date unless it says
              otherwise, which is exactly how it gets misread. */}
          <span className="flex items-baseline gap-x-2">
            <span>
              No. {brief.day_number} ·{" "}
              {brief.partial ? "Today so far" : "Covering"}{" "}
              {formatBriefDate(brief.brief_date)}
            </span>
            {/* Switching to today sits against the date, because that is where
                the ambiguity about which day you are reading lives. Only on a
                finished brief: once you are already on today there is nothing
                to switch to, and re-reading it belongs with the other actions
                in the footer. */}
            {!sample && !brief.partial && (
              <>
                <span aria-hidden>·</span>
                <TodayBrief />
              </>
            )}
          </span>
        </p>
      </header>

      <h1 className="rise rise-1 font-serif text-[32px] sm:text-[38px] leading-tight mt-10">
        {greeting}
      </h1>

      {/* Yesterday — the ledger */}
      <section
        className="rise rise-2 mt-10"
        aria-label={brief.partial ? "Today so far" : "Yesterday"}
      >
        <p className="eyebrow mb-2">{brief.partial ? "Today so far" : "Yesterday"}</p>
        <div>
          {brief.yesterday.map((row) => (
            <div key={row.label} className="ledger-row">
              <span className="text-[15px]">
                {row.label}
                {row.delta && (
                  <span
                    className={`ml-2 text-[12px] whitespace-nowrap ${
                      row.delta.direction === "up"
                        ? "text-ledger"
                        : row.delta.direction === "down"
                          ? "text-oxide"
                          : "text-muted"
                    }`}
                  >
                    {row.delta.text}
                  </span>
                )}
              </span>
              <span className="ledger-leader" aria-hidden />
              <span className="ledger-value">{row.value}</span>
            </div>
          ))}
          {brief.yesterday.length === 0 && (
            <p className="text-[15px] text-muted py-2">No activity was recorded.</p>
          )}
        </div>
      </section>

      {/* Main insight */}
      <section className="rise rise-3 mt-10" aria-label="Main insight">
        <p className="eyebrow mb-2">Main insight</p>
        <p className="font-serif text-[19px] leading-relaxed">{brief.insight}</p>
      </section>

      {/* Today — priorities are ranked, so the first one is pulled out. A
          numbered list of three reads as three equal chores; the whole point
          is that one of them matters more than the others. */}
      <section className="rise rise-4 mt-10" aria-label="Today's priorities">
        <p className="eyebrow mb-2">Today</p>
        {brief.priorities.length > 0 && (
          <div className="border-l-2 border-ink pl-[14px] py-[2px] mb-4">
            <p className="eyebrow mb-[5px]">The main todo</p>
            <p className="text-[17px] leading-snug font-medium">{brief.priorities[0]}</p>
          </div>
        )}
        {brief.priorities.length > 1 && (
          <ol className="space-y-2">
            {brief.priorities.slice(1).map((p, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                {/* +2: this list continues the lead, which was number 1. */}
                <span className="font-mono text-[12px] text-muted pt-[3px]">{i + 2}.</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Honest gaps, and the way out of them.
          The footer renders even with no gaps: the connect link used to be
          conditional on a gap containing "isn't connected", which meant it
          silently vanished the moment a brief happened to have nothing to
          report — the one affordance for adding a tool disappearing for
          reasons a founder could not see or predict. Gaps are still driven by
          the data; the link is now simply always there. */}
      <footer className="rise rise-5 mt-12 border-t border-line pt-4">
        {brief.gaps.map((g, i) => (
          <p key={i} className="text-[13px] text-muted leading-relaxed">
            {g}
          </p>
        ))}
        {/* A broken integration gets a named link, because "GitHub is
            connected but couldn't be read" is useless without somewhere to
            go — a stale installation_id produced exactly that dead end.
            Driven by `reconnect`, not by matching the sentence: prose is not
            an API, and rewording a gap should not remove the fix for it. */}
        {brief.reconnect?.length ? (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {brief.reconnect.map((provider) => (
              <Link
                key={provider}
                href="/onboarding"
                className="font-mono text-[12px] text-ink underline hover:no-underline"
              >
                Reconnect {PROVIDER_LABEL[provider] ?? provider} →
              </Link>
            ))}
          </p>
        ) : (
          /* Nothing is broken. A quiet, permanent offer — muted, mono, below
             the brief itself, never a priority. "Connect another tool" is our
             interest, not the founder's work today, which is why it stays this
             small rather than becoming a card or a button.

             Suppressed on `sample`, which is the specimen brief on the public
             landing page: a signed-out visitor clicking it lands on /login,
             and the marketing page should not carry an app affordance. */
          !sample && (
            <Link
              href="/onboarding"
              className="inline-block mt-3 font-mono text-[12px] text-muted hover:text-ink transition-colors"
            >
              Connect a tool →
            </Link>
          )
        )}
      </footer>
    </article>
  );
}
