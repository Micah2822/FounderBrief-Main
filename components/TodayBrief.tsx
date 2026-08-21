"use client";

import { useState } from "react";
import { useGoToBrief } from "@/lib/use-go-to-brief";
import { trackBriefGenerated } from "@/lib/analytics";

/**
 * Asks for the day in progress rather than yesterday.
 *
 * The brief is a morning artefact about a finished day, and that stays the
 * default — but someone opening it at 6pm is looking at a greeting that says
 * "Good evening" above a ledger of yesterday, and the day they actually
 * remember is today. This makes that an explicit choice rather than changing
 * what the daily brief means.
 */
export function TodayBrief({ partial = false }: { partial?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goToBrief = useGoToBrief();

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/brief/generate?today=1", { method: "POST" });
    setBusy(false);

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Previously this branch did nothing at all, so a 429 from the shared
      // 30s throttle — which firing Refresh first makes near-certain — looked
      // exactly like a dead button.
      setError(body?.error ?? "Couldn't read today.");
      return;
    }
    trackBriefGenerated("today_so_far", body?.brief);
    goToBrief(body?.brief?.brief_date ? `/?date=${body.brief.brief_date}` : null);
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <button
        onClick={generate}
        disabled={busy}
        className="font-mono text-[12px] text-muted hover:text-ink transition-colors disabled:opacity-50"
      >
        {/* The arrow belongs to the masthead variant, where it has to read as
            something you press rather than more dateline text. The footer
            variant sits among plain-text actions, where an arrow would read as
            navigation instead. */}
        {busy ? "Reading today…" : partial ? "Refresh today" : "Today so far →"}
      </button>
      {error && (
        <span className="font-mono text-[11px] text-oxide normal-case tracking-normal">
          {error}
        </span>
      )}
    </span>
  );
}
