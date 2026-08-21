"use client";

import { useState } from "react";
import { useGoToBrief } from "@/lib/use-go-to-brief";
import { trackBriefGenerated } from "@/lib/analytics";

export function RefreshBrief() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goToBrief = useGoToBrief();

  async function refresh() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/brief/generate", { method: "POST" });
    setBusy(false);

    const body = await res.json().catch(() => null);
    // Silence on failure made a throttled click indistinguishable from a
    // broken button — the 30s window is shared with "Today so far".
    if (!res.ok) {
      setError(body?.error ?? "Couldn't refresh.");
      return;
    }
    trackBriefGenerated("refresh", body?.brief);
    // Navigate to the brief that was actually produced. When yesterday was
    // empty the route falls forward to today, and the home page shows the
    // *newest* brief_date — so without this the founder could land back on the
    // empty one they were trying to get away from.
    goToBrief(body?.brief?.brief_date ? `/?date=${body.brief.brief_date}` : null);
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        className="font-mono text-[12px] text-muted hover:text-ink transition-colors disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {error && <span className="font-mono text-[11px] text-oxide">{error}</span>}
    </span>
  );
}
