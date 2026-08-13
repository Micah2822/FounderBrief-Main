"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshBrief() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function refresh() {
    setBusy(true);
    const res = await fetch("/api/brief/generate", { method: "POST" });
    setBusy(false);

    // Navigate to the brief that was actually produced. When yesterday was
    // empty the route falls back to an older active day, and the home page
    // shows the *newest* brief_date — so without this the founder would land
    // back on the empty one they were trying to get away from.
    const date = res.ok ? (await res.json())?.brief?.brief_date : null;
    if (date) router.push(`/?date=${date}`);
    router.refresh();
  }

  return (
    <button
      onClick={refresh}
      disabled={busy}
      className="font-mono text-[12px] text-muted hover:text-ink transition-colors disabled:opacity-50"
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}
