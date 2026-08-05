"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateButton({ label = "Generate today's brief" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/brief/generate", { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Generation failed.");
  }

  return (
    <div>
      <button onClick={generate} disabled={busy} className="btn-primary">
        {busy ? "Reading your data…" : label}
      </button>
      {error && <p className="text-[13px] text-oxide mt-2">{error}</p>}
    </div>
  );
}
