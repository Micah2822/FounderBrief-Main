"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshBrief() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function refresh() {
    setBusy(true);
    await fetch("/api/brief/generate", { method: "POST" });
    setBusy(false);
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
