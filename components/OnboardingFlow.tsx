"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Repo = { full_name: string; private: boolean; pushed_at: string };
type Table = { table: string; timestamp_columns: string[] };
type Project = { ref: string; name: string };

// The Supabase management token lives in a 10-minute cookie, so "expired" is a
// normal outcome rather than a fault, and the fix is always the same.
function reconnectMessage(error: string | undefined, fallback: string): string {
  if (error === "supabase_reconnect") {
    return "That took a little too long — connect Supabase again to pick up where you left off.";
  }
  return error ?? fallback;
}

export function OnboardingFlow({
  githubConnected,
  githubRepos,
  supabaseConnected,
  supabasePickingProject,
  plausibleConnected,
  stripeConnected,
  locked,
}: {
  githubConnected: boolean;
  githubRepos: string[];
  supabaseConnected: boolean;
  supabasePickingProject: boolean;
  plausibleConnected: boolean;
  stripeConnected: boolean;
  /** Per provider: connecting this one would exceed the free plan's limit. */
  locked: Record<"github" | "supabase" | "stripe" | "plausible", boolean>;
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

  // Disconnecting re-renders the server component with connected=false, but
  // React keeps client state across router.refresh() — useState only reads its
  // initial value on mount. Without this the step kept showing "✓ connected"
  // until a hard reload, and the flags below still counted a tool that was
  // gone, so "Generate my first brief" stayed enabled with nothing connected.
  // (The steps themselves are keyed on the same flags, which remounts them
  // with fresh internal state.)
  useEffect(() => {
    if (!githubConnected) setReposSaved(false);
    if (!supabaseConnected) setSbSaved(false);
    if (!plausibleConnected) setPlSaved(false);
    if (!stripeConnected) setStSaved(false);
  }, [githubConnected, supabaseConnected, plausibleConnected, stripeConnected]);

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
      // Land on the brief that was produced, not on whatever has the newest
      // date — when yesterday was empty this will be an older active day.
      const date = (await res.json())?.brief?.brief_date;
      router.push(date ? `/?date=${date}` : "/");
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

      {/* Order is the onboarding order: the two one-click connections first, then
          the optional pasted keys. Step numbers are derived from position so
          reordering can't leave a stale label behind. */}
      {/* Keyed on the connected flag so a disconnect remounts the step with
          fresh state instead of leaving its stale "saved" value on screen.
          Deliberately not keyed on `pickingProject`, which changes mid-flow and
          would throw away the project list the user is choosing from. */}
      {/* A locked step replaces the connector entirely rather than disabling
          its form: there is nothing useful to do inside it, and a dead form is
          a worse answer than a sentence explaining why. A step that is already
          connected is never locked — the limit only refuses *new* tools.

          `locked` is computed on the server at page load, so every onSaved
          below calls router.refresh(): connecting a tool changes how many
          remain available, and without the refresh the server component never
          re-runs. The steps after the one you just connected would keep
          offering a form that the wall then rejects with a 402. */}
      {locked.github && !githubConnected ? (
        <LockedStep step={1} label="GitHub" />
      ) : (
        <GitHubStep
          key={`github-${githubConnected}`}
          step={1}
          connected={githubConnected}
          initialRepos={githubRepos}
          onSaved={() => { setReposSaved(true); router.refresh(); }}
        />
      )}
      {locked.supabase && !supabaseConnected ? (
        <LockedStep step={2} label="Supabase" />
      ) : (
        <SupabaseStep
          key={`supabase-${supabaseConnected}`}
          step={2}
          connected={supabaseConnected}
          pickingProject={supabasePickingProject}
          onSaved={() => { setSbSaved(true); router.refresh(); }}
        />
      )}
      {locked.stripe && !stripeConnected ? (
        <LockedStep step={3} label="Revenue" />
      ) : (
        <StripeStep
          key={`stripe-${stripeConnected}`}
          step={3}
          connected={stripeConnected}
          onSaved={() => { setStSaved(true); router.refresh(); }}
        />
      )}
      {locked.plausible && !plausibleConnected ? (
        <LockedStep step={4} label="Website traffic" />
      ) : (
        <PlausibleStep
          key={`plausible-${plausibleConnected}`}
          step={4}
          connected={plausibleConnected}
          onSaved={() => { setPlSaved(true); router.refresh(); }}
        />
      )}

      <section id="step-5" className="rise rise-5 border-t border-line pt-8">
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

/**
 * A connector step the free plan cannot reach.
 *
 * Deliberately not a dead end. The founder still has two tools connected, step
 * 5 below still works, and the copy says so — someone who has never seen a
 * brief should not be asked for money before they have. Leading with what still
 * happens ("your brief starts tomorrow") rather than with what is missing is
 * also what stops this reading as a sales interstitial.
 *
 * The upgrade button posts to the same checkout route Settings uses. It is a
 * primary button here and the "continue" beside it is a plain link, because the
 * founder should be able to finish onboarding without paying — but the offer
 * should not be hidden either, since this is the moment they actually want the
 * third tool.
 */
function LockedStep({ step, label }: { step: number; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const body = await res.json();
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setError("Couldn't open checkout. Try again.");
    } catch {
      setError("Couldn't open checkout. Try again.");
    }
    setBusy(false);
  }

  return (
    <section className={`rise rise-${step} border-t border-line pt-8`}>
      <p className="eyebrow mb-3">
        Step {step} — {label}
      </p>
      <p className="font-serif text-[19px] leading-relaxed text-muted max-w-md">
        Free covers two connected tools, and you&apos;ve connected two.
      </p>
      <p className="text-[14px] text-muted leading-relaxed mt-3 max-w-md">
        Your brief starts tomorrow morning on what you have. Founder connects{" "}
        {label} and everything else — $19 a month, cancel any time.
      </p>
      <div className="flex items-center gap-4 mt-5">
        <button onClick={upgrade} disabled={busy} className="btn-primary">
          {busy ? "Opening…" : "Upgrade — $19/month"}
        </button>
        <a
          href="#step-5"
          className="font-mono text-[12px] text-muted hover:text-ink transition-colors"
        >
          Continue with two tools
        </a>
      </div>
      {error && <p className="text-[13px] text-oxide mt-3">{error}</p>}
    </section>
  );
}

function GitHubStep({
  step,
  connected,
  initialRepos,
  onSaved,
}: {
  step: number;
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
    <section className={`rise rise-${step} border-t border-line pt-8`}>
      <p className="eyebrow mb-3">Step {step} — GitHub</p>
      {!connected ? (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Merged PRs, commits, deployments — the shipping half of your brief.
            GitHub will ask you to pick which repositories we can see, and the
            access is <em>read-only</em>: nothing here can push code or change
            your repos.
          </p>
          <a href="/api/integrations/github/authorize" className="btn-primary">
            Connect GitHub
          </a>
        </>
      ) : saved ? (
        <Done
          provider="github"
          text={`Watching ${initialRepos.length > 0 ? initialRepos.join(", ") : selected.join(", ")}`}
        />
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

function SupabaseStep({
  step,
  connected,
  pickingProject,
  onSaved,
}: {
  step: number;
  connected: boolean;
  pickingProject: boolean;
  onSaved: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(pickingProject && !connected);
  const [projectRef, setProjectRef] = useState("");
  const [tables, setTables] = useState<Table[] | null>(null);
  const [table, setTable] = useState("");
  const [tsColumn, setTsColumn] = useState("");
  const [saved, setSaved] = useState(connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returning from the OAuth callback: the management token is sitting in an
  // httpOnly cookie, so the project list is one request away.
  useEffect(() => {
    if (!pickingProject || saved) {
      setLoadingProjects(false);
      return;
    }
    post({ action: "list-projects" })
      .then(({ ok, data }) => {
        if (ok) setProjects(data.projects ?? []);
        else setError(reconnectMessage(data.error, "Couldn't load your projects."));
      })
      .finally(() => setLoadingProjects(false));
  }, [pickingProject, saved]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/integrations/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  }

  function applyTables(data: any) {
    setTables(data.tables);
    if (data.suggested) {
      setTable(data.suggested.table);
      setTsColumn(data.suggested.ts_column);
    } else if (data.tables.length === 1) {
      pickTable(data.tables[0].table, data.tables);
    }
  }

  async function chooseProject(ref: string) {
    setProjectRef(ref);
    if (!ref) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await post({ action: "select-project", project_ref: ref });
    setBusy(false);
    if (ok) applyTables(data);
    else setError(reconnectMessage(data.error, "Couldn't read that project."));
  }

  function pickTable(t: string, list?: Table[]) {
    setTable(t);
    const cols = (list ?? tables)?.find((x) => x.table === t)?.timestamp_columns ?? [];
    setTsColumn(cols.includes("created_at") ? "created_at" : cols[0] ?? "");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const { ok, data } = await post({
      action: "save-oauth",
      project_ref: projectRef,
      table,
      ts_column: tsColumn,
    });
    setBusy(false);
    if (ok) {
      setSaved(true);
      onSaved();
    } else setError(reconnectMessage(data.error, "Couldn't save."));
  }

  return (
    <section className={`rise rise-${step} border-t border-line pt-8`}>
      <p className="eyebrow mb-3">Step {step} — Supabase</p>
      {saved ? (
        <Done provider="supabase" text={table ? `Counting new rows in "${table}"` : "Signups connected"} />
      ) : !tables && loadingProjects ? (
        // Without this the connect button flashes back up while the project
        // list is still in flight, which reads as though the connect failed.
        <p className="text-[14px] text-faint">Loading your Supabase projects…</p>
      ) : !tables && projects?.length ? (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Which project is your product?
          </p>
          <select
            value={projectRef}
            onChange={(e) => chooseProject(e.target.value)}
            disabled={busy}
            className="field max-w-md"
            aria-label="Supabase project"
          >
            <option value="" disabled>
              {busy ? "Reading project…" : "Choose a project…"}
            </option>
            {projects.map((p) => (
              <option key={p.ref} value={p.ref}>
                {p.name}
              </option>
            ))}
          </select>
          {/* Choosing a project mints a key and reads its schema, which takes a
              few seconds. The placeholder option carries a busy label, but the
              select shows the *chosen* project once one is picked — so without
              this the wait looks like nothing happening, and people click past
              it before the table list arrives. */}
          {busy && (
            <p className="text-[13px] text-faint mt-2" role="status" aria-live="polite">
              Reading your project&rsquo;s tables
              <span className="dots font-mono" aria-hidden>
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>{" "}
              this takes a few seconds.
            </p>
          )}
        </>
      ) : !tables && projects ? (
        <p className="text-[14px] text-muted leading-relaxed max-w-md">
          That Supabase account has no projects yet. Create one, then connect
          again — or skip this step; your brief works without it.
        </p>
      ) : !tables ? (
        <>
          <p className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            Point at your product&apos;s database and we&apos;ll count new
            signups. We only ever run counts — never read row contents.
          </p>
          {/* OAuth only. The pasted-key alternative was removed: it was the one
              place a founder was asked to hand over a service_role key through
              a form, it doubled the connect surface, and its only real audience
              was self-hosted Supabase. A self-hosted founder now lands in
              ToolRequest instead of being quietly served the least safe path. */}
          <a href="/api/integrations/supabase/authorize" className="btn-primary">
            Connect Supabase
          </a>
          <p className="text-[12px] text-faint mt-3">
            You&apos;ll pick a project from a list — no keys to hunt for. We
            don&apos;t keep access to your Supabase account afterwards.
          </p>
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

// ── Plausible (website traffic, optional) ──────────────────────────────
// Last of the connectors: Plausible has no OAuth, so this is the only step that
// still asks for a pasted key and it shouldn't be what a new user meets first.

function PlausibleStep({
  step,
  connected,
  onSaved,
}: {
  step: number;
  connected: boolean;
  onSaved: () => void;
}) {
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
    <section className={`rise rise-${step} border-t border-line pt-8`}>
      <p className="eyebrow mb-3">Step {step} — Website traffic</p>
      {saved ? (
        <Done provider="plausible" text={domain ? `Tracking visitors on ${domain}` : "Analytics connected"} />
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
            , connect it to see visitors alongside signups. Plausible keys are{" "}
            <em>read-only</em> — we can only read stats, never change anything in
            your account. Create one under{" "}
            <a
              href="https://plausible.io/settings/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              Settings → API keys
            </a>
            .
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

function StripeStep({
  step,
  connected,
  onSaved,
}: {
  step: number;
  connected: boolean;
  onSaved: () => void;
}) {
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
    <section className={`rise rise-${step} border-t border-line pt-8`}>
      <p className="eyebrow mb-3">Step {step} — Revenue</p>
      {saved ? (
        <Done provider="stripe" text="Tracking revenue and new customers" />
      ) : (
        <>
          {/* Two paths, because the right one depends on the founder. Stripe's
              permission list runs to dozens of collapsed categories, so
              "set these two and check the rest" is a real chore — but it is
              also the only way to guarantee least access. Recommend the fast
              path and let the connect step catch a missing permission, which
              it now can: verifyStripe() tests both resources and passes
              Stripe's own message back, naming exactly what to add. */}
          <p className="text-[14px] text-muted leading-relaxed mb-3 max-w-md">
            Connect Stripe to see revenue and new customers in your brief.
          </p>
          <div className="text-[14px] text-muted leading-relaxed mb-4 max-w-md">
            <p className="mb-2">
              In Stripe, go to{" "}
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noreferrer"
                className="text-ink underline hover:no-underline"
              >
                Developers → API keys
              </a>
              , choose <span className="text-ink">Create restricted key</span>, then{" "}
              <span className="text-ink">Providing this key to a third-party application</span>.
              From there, either:
            </p>
            <ul className="space-y-1.5">
              <li className="flex gap-2">
                <span className="font-mono text-[12px] text-faint pt-[3px]">→</span>
                <span>
                  <span className="text-ink">Quickest</span> — create the key as
                  it is. If a permission is missing we&rsquo;ll tell you which one.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-[12px] text-faint pt-[3px]">→</span>
                <span>
                  <span className="text-ink">Least access</span> — tick{" "}
                  <span className="text-ink">Customise</span> and set only{" "}
                  <span className="text-ink">Charges</span> and{" "}
                  <span className="text-ink">Customers</span> to{" "}
                  <span className="text-ink">Read</span>.
                </span>
              </li>
            </ul>
          </div>
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
            Secret keys are rejected, so nothing we store can move your money.
            Optional — most founders here are pre-revenue, and your brief works
            fully without it.
          </p>
        </>
      )}
      {error && <p className="text-[13px] text-oxide mt-2">{error}</p>}
    </section>
  );
}

function Done({ text, provider }: { text: string; provider?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Undoing a connection used to mean leaving onboarding for Settings, which
  // is a long way to go to correct a mis-picked table two seconds after
  // picking it. The endpoint already exists; only the affordance was missing.
  async function disconnect() {
    if (!provider) return;
    setBusy(true);
    const res = await fetch("/api/integrations/supabase", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    // On success the refresh remounts this step, so `busy` goes with it. On
    // failure nothing remounts, and leaving it set would disable the button
    // permanently with no explanation.
    if (!res.ok) setBusy(false);
    router.refresh();
  }

  return (
    <p className="text-[14px] flex items-center gap-2 flex-wrap">
      <span className="text-ledger font-mono">✓</span>
      <span>{text}</span>
      {provider && (
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="font-mono text-[12px] text-faint hover:text-ink transition-colors disabled:opacity-50"
        >
          {busy ? "Disconnecting…" : "Disconnect"}
        </button>
      )}
    </p>
  );
}
