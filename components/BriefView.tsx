import type { Brief } from "@/lib/types";
import { formatBriefDate } from "@/lib/dates";

export function BriefView({ brief, greeting }: { brief: Brief; greeting: string }) {
  return (
    <article>
      {/* Wire-dispatch header */}
      <header className="rise border-t-2 border-ink">
        <p className="eyebrow flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-[10px]">
          <span>Founder Brief</span>
          <span>
            No. {brief.day_number} · {formatBriefDate(brief.brief_date)}
          </span>
        </p>
      </header>

      <h1 className="rise rise-1 font-serif text-[32px] sm:text-[38px] leading-tight mt-10">
        {greeting}
      </h1>

      {/* Yesterday — the ledger */}
      <section className="rise rise-2 mt-10" aria-label="Yesterday">
        <p className="eyebrow mb-2">Yesterday</p>
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

      {/* Today */}
      <section className="rise rise-4 mt-10" aria-label="Today's priorities">
        <p className="eyebrow mb-2">Today</p>
        <ol className="space-y-2">
          {brief.priorities.map((p, i) => (
            <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
              <span className="font-mono text-[12px] text-muted pt-[3px]">{i + 1}.</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Honest gaps */}
      {brief.gaps.length > 0 && (
        <footer className="rise rise-5 mt-12 border-t border-line pt-4">
          {brief.gaps.map((g, i) => (
            <p key={i} className="text-[13px] text-muted leading-relaxed">
              {g}
            </p>
          ))}
        </footer>
      )}
    </article>
  );
}
