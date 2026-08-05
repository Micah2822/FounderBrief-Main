"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Repo = { full_name: string; private: boolean; pushed_at: string };
type Table = { table: string; timestamp_columns: string[] };

export function OnboardingFlow({
  githubConnected,
  githubRepos,
  supabaseConnected,
  plausibleConnected,
  stripeConnected,
}: {
  githubConnected: boolean;
  githubRepos: string[];
  supabaseConnected: boolean;
  plausibleConnected: boolean;
  stripeConnected: boolean;
}) {
  const router = useRouter();
  const [reposSaved, setReposSaved] = useState(githubRepos.length > 0);
  const [sbSaved, setSbSaved] = useState(supabaseConnected);
  const [plSaved, setPlSaved] = useState(plausibleConnected);
  const [stSaved, setStSaved] = useState(stripeConnected);
  const [goal, setGoal] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const canGenerate = (githubConnected && reposSaved) || sbSaved || plSaved || stSaved;

  async function generateFirst() {
    setGenerating(true);
    setGenError(null);
    // Save the browser's timezone (so "yesterday" and the 7am email are
    // local) and the founder's stated focus, if given
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        goal: goal.trim() || null,
      }),
    });
    const res = await fetch("/api/brief/generate", { method: "POST" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setGenerating(false);
      setGenError((await res.json()).error ?? "Something went wrong.");
    }
  }

  return (
    <div className="mt-10 space-y-12">
      <div className="rise">
        <h1 className="font-serif text-[32px] leading-tight">
          Connect your startup.
        </h1>
        <p className="text-muted text-[14px] leading-relaxed mt-3 max-w-md">
          Two connections, two minutes. Your brief is built only from what you
          connect — nothing is guessed.
        </p>
      </div>

      <GitHubStep connected={githubConnected} initialRepos={githubRepos} onSaved={() => setReposSaved(true)} />
      <SupabaseStep connected={supabaseConnected} onSaved={() => setSbSaved(true)} />
      <PlausibleStep connected={plausibleConnected} onSaved={() => setPlSaved(true)} />
      <StripeStep connected={stripeConnected} onSaved={() => setStSaved(true)} />

      <section className="rise rise-5 border-t border-line pt-8">
        <p className="eyebrow mb-3">Step 5 — Your first brief</p>
        <label className="block text-[14px] text-muted leading-relaxed mb-2 max-w-md">
          What are you focused on right now?{" "}
          <span className="text-faint">(optional — your priorities will lean toward it)</span>
        </label>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={200}
          placeholder='e.g. "get to 100 users" or "launch by August"'
          className="field max-w-md mb-5"
          aria-label="Current focus"
        />
        <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
          {canGenerate
            ? "Ready. From tomorrow, your brief lands by email every morning at 7am."
            : "Connect at least one tool above to generate your first brief."}
        </p>
        <button onClick={generateFirst} disabled={!canGenerate || generating} className="btn-primary">
          {generating ? "Reading your data…" : "Generate my first brief"}
        </button>
        {genError && <p className="text-[13px] text-oxide mt-2">{genError}</p>}
      </section>

      <ToolRequest />
    </div>
  );
}

// ── Demand capture: turn "you don't support my stack" into roadmap data ─

function ToolRequest() {
  const [tool, setTool] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tool.trim()) return;
    setSent(true);
    await fetch("/api/tool-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: tool.trim() }),
    });
  }

  return (
    <section className="border-t border-line pt-6">
      {sent ? (
        <p className="text-[13px] text-muted">
          Noted — integrations get built by request. You&apos;ll hear from us
          when it lands.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <label htmlFor="tool-request" className="text-[13px] text-muted">
            Using a different database or analytics tool?
          </label>
          <input
            id="tool-request"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            maxLength={100}
            placeholder="e.g. Firebase, PostHog, Neon…"
            className="field !w-56"
          />
          <button type="submit" disabled={!tool.trim()} className="btn-ghost">
            Request it
          </button>
        </form>
      )}
    </section>
  );
}

// ── Step 1: GitHub ──────────────────────────────────────────────────────

function GitHubStep({
  connected,
  initialRepos,
  onSaved,
}: {
  connected: boolean;
  initialRepos: string[];
  onSaved: () => void;
}) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<string[]>(initialRepos);
  const [saved, setSaved] = useState(initialRepos.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connected && !saved) {
      fetch("/api/integrations/github/repos")
        .then((r) => r.json())
        .then((d) => setRepos(d.repos ?? []))
        .catch(() => setError("Couldn't load your repositories."));
    }
  }, [connected, saved]);

  function toggle(name: string) {
    setSelected((s) =>
      s.includes(name) ? s.filter((x) => x !== name) : s.length < 5 ? [...s, name] : s
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/github/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: selected }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      onSaved();
    } else setError((await res.json()).error ?? "Couldn't save.");
  }

  return (
    <section className="rise rise-1 border-t border-line pt-8">
      <p className="eyebrow mb-3">Step 1 — GitHub</p>
      {!connected ? (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Merged PRs, commits, deployments — the shipping half of your brief.
          </p>
          <a href="/api/integrations/github/authorize" className="btn-primary">
            Connect GitHub
          </a>
        </>
      ) : saved ? (
        <Done text={`Watching ${initialRepos.length > 0 ? initialRepos.join(", ") : selected.join(", ")}`} />
      ) : (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Connected. Pick the repositories that are your startup (up to 5).
          </p>
          <div className="max-h-60 overflow-y-auto border border-line rounded-md divide-y divide-line">
            {repos.length === 0 && (
              <p className="text-[13px] text-faint p-3">Loading repositories…</p>
            )}
            {repos.map((r) => (
              <label
                key={r.full_name}
                className="flex items-center gap-3 px-3 py-2.5 text-[14px] cursor-pointer hover:bg-line/30"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(r.full_name)}
                  onChange={() => toggle(r.full_name)}
                  className="accent-current"
                />
                <span className="font-mono text-[13px]">{r.full_name}</span>
                {r.private && <span className="text-[11px] text-faint">private</span>}
              </label>
            ))}
          </div>
          <button onClick={save} disabled={!selected.length || busy} className="btn-primary mt-4">
            {busy ? "Saving…" : `Watch ${selected.length || ""} ${selected.length === 1 ? "repository" : "repositories"}`}
          </button>
        </>
      )}
      {error && <p className="text-[13px] text-oxide mt-2">{error}</p>}
    </section>
  );
}

// ── Step 2: Supabase (the founder's product database) ──────────────────

function SupabaseStep({ connected, onSaved }: { connected: boolean; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [tables, setTables] = useState<Table[] | null>(null);
  const [table, setTable] = useState("");
  const [tsColumn, setTsColumn] = useState("");
  const [saved, setSaved] = useState(connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "discover", url: url.trim(), key: key.trim() }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setTables(data.tables);
      if (data.tables.length === 1) pickTable(data.tables[0].table, data.tables);
    } else setError(data.error ?? "Couldn't connect.");
  }

  function pickTable(t: string, list?: Table[]) {
    setTable(t);
    const cols = (list ?? tables)?.find((x) => x.table === t)?.timestamp_columns ?? [];
    setTsColumn(cols.includes("created_at") ? "created_at" : cols[0] ?? "");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", url: url.trim(), key: key.trim(), table, ts_column: tsColumn }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      onSaved();
    } else setError(data.error ?? "Couldn't save.");
  }

  return (
    <section className="rise rise-2 border-t border-line pt-8">
      <p className="eyebrow mb-3">Step 2 — Supabase</p>
      {saved ? (
        <Done text={table ? `Counting new rows in "${table}"` : "Signups connected"} />
      ) : !tables ? (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Point at your product&apos;s database and we&apos;ll count new
            signups. We only ever run counts — never read row contents.
          </p>
          <form onSubmit={discover} className="space-y-3 max-w-md">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourproject.supabase.co"
              className="field"
              aria-label="Supabase project URL"
            />
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type="password"
              placeholder="service_role key (stored encrypted)"
              className="field"
              aria-label="Supabase service role key"
            />
            <button type="submit" disabled={!url || !key || busy} className="btn-ghost">
              {busy ? "Connecting…" : "Connect Supabase"}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Which table means <em>a new user signed up</em>?
          </p>
          <div className="space-y-3 max-w-md">
            <select value={table} onChange={(e) => pickTable(e.target.value)} className="field">
              <option value="" disabled>
                Choose your signups table…
              </option>
              {tables.map((t) => (
                <option key={t.table} value={t.table}>
                  {t.table}
                </option>
              ))}
            </select>
            {table && (
              <select value={tsColumn} onChange={(e) => setTsColumn(e.target.value)} className="field">
                {(tables.find((t) => t.table === table)?.timestamp_columns ?? []).map((c) => (
                  <option key={c} value={c}>
                    timestamp column: {c}
                  </option>
                ))}
              </select>
            )}
            <button onClick={save} disabled={!table || !tsColumn || busy} className="btn-primary">
              {busy ? "Verifying…" : "Save mapping"}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-[13px] text-oxide mt-2">{error}</p>}
      {!saved && (
        <p className="text-[12px] text-faint mt-3">
          Optional — skip if you don&apos;t have users in a database yet.
        </p>
      )}
    </section>
  );
}

// ── Step 3: Plausible (website traffic, optional) ───────────────────────

function PlausibleStep({ connected, onSaved }: { connected: boolean; onSaved: () => void }) {
  const [domain, setDomain] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/plausible", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domain.trim().toLowerCase(), key: key.trim() }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      onSaved();
    } else setError(data.error ?? "Couldn't connect.");
  }

  return (
    <section className="rise rise-3 border-t border-line pt-8">
      <p className="eyebrow mb-3">Step 3 — Website traffic</p>
      {saved ? (
        <Done text={domain ? `Tracking visitors on ${domain}` : "Analytics connected"} />
      ) : (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            If your site uses{" "}
            <a
              href="https://plausible.io"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              Plausible Analytics
            </a>
            , connect it to see visitors alongside signups. Create an API key
            under Settings → API keys in Plausible.
          </p>
          <form onSubmit={save} className="space-y-3 max-w-md">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="yourstartup.com"
              className="field"
              aria-label="Website domain as registered in Plausible"
            />
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type="password"
              placeholder="Plausible API key (stored encrypted)"
              className="field"
              aria-label="Plausible API key"
            />
            <button type="submit" disabled={!domain || !key || busy} className="btn-ghost">
              {busy ? "Verifying…" : "Connect Plausible"}
            </button>
          </form>
          <p className="text-[12px] text-faint mt-3">
            Optional — skip if you don&apos;t track your site yet. More
            analytics providers are coming.
          </p>
        </>
      )}
      {error && <p className="text-[13px] text-oxide mt-2">{error}</p>}
    </section>
  );
}

// ── Step 4: Stripe (revenue, optional — never required) ────────────────

function StripeStep({ connected, onSaved }: { connected: boolean; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.trim() }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      onSaved();
    } else setError(data.error ?? "Couldn't connect.");
  }

  return (
    <section className="rise rise-4 border-t border-line pt-8">
      <p className="eyebrow mb-3">Step 4 — Revenue</p>
      {saved ? (
        <Done text="Tracking revenue and new customers" />
      ) : (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            If you have paying customers, connect Stripe to see revenue in your
            brief. Create a <em>restricted</em> key with read-only access to
            Charges and Customers (Developers → API keys → Create restricted
            key).
          </p>
          <form onSubmit={save} className="space-y-3 max-w-md">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type="password"
              placeholder="rk_live_… (stored encrypted)"
              className="field"
              aria-label="Stripe restricted API key"
            />
            <button type="submit" disabled={!key || busy} className="btn-ghost">
              {busy ? "Verifying…" : "Connect Stripe"}
            </button>
          </form>
          <p className="text-[12px] text-faint mt-3">
            Optional — most founders here are pre-revenue. Your brief works
            fully without it.
          </p>
        </>
      )}
      {error && <p className="text-[13px] text-oxide mt-2">{error}</p>}
    </section>
  );
}

function Done({ text }: { text: string }) {
  return (
    <p className="text-[14px] flex items-center gap-2">
      <span className="text-ledger font-mono">✓</span>
      <span>{text}</span>
    </p>
  );
}
