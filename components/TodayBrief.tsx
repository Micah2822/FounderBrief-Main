"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Asks for the day in progress rather than yesterday.
 *
 * The brief is a morning artefact about a finished day, and that stays the
 * default — but someone opening it at 6pm is looking at a greeting that says
 * "Good evening" above a ledger of yesterday, and the day they actually
 * remember is today. This makes that an explicit choice rather than changing
 * what the daily brief means.
 */
export function TodayBrief() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function generate() {
    setBusy(true);
    const res = await fetch("/api/brief/generate?today=1", { method: "POST" });
    setBusy(false);

    const date = res.ok ? (await res.json())?.brief?.brief_date : null;
    if (date) router.push(`/?date=${date}`);
    router.refresh();
  }

  return (
    <button
      onClick={generate}
      disabled={busy}
      className="font-mono text-[12px] text-muted hover:text-ink transition-colors disabled:opacity-50"
    >
      {/* The arrow is the same affordance the footer links use — it reads as
          something you press rather than more masthead text. */}
      {busy ? "Reading today…" : "Today so far →"}
    </button>
  );
}
