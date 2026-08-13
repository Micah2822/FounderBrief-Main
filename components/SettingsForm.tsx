"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function SettingsForm({
  email,
  timezone,
  sendHour,
  emailEnabled,
  goal: initialGoal,
  integrations,
}: {
  email: string;
  timezone: string;
  sendHour: number;
  emailEnabled: boolean;
  goal: string;
  integrations: { provider: string; detail: string }[];
}) {
  const router = useRouter();
  const [tz, setTz] = useState(timezone);
  const [hour, setHour] = useState(sendHour);
  const [enabled, setEnabled] = useState(emailEnabled);
  const [goal, setGoal] = useState(initialGoal);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  async function save() {
    setBusy(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: tz,
        send_hour: hour,
        email_enabled: enabled,
        goal: goal.trim() || null,
      }),
    });
    setBusy(false);
    setSaved(true);
  }

  async function disconnect(provider: string) {
    await fetch("/api/integrations/supabase", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    router.refresh();
  }

  return (
    <div className="mt-10 space-y-12">
      <section>
        <p className="eyebrow mb-4">Current focus</p>
        <div className="max-w-md space-y-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={200}
            placeholder='e.g. "get to 100 users" or "launch by August"'
            className="field"
            aria-label="Current focus"
          />
          <p className="text-[12px] text-faint">
            Your daily priorities lean toward this. Change it whenever your
            focus changes.
          </p>
        </div>
      </section>

      <section className="border-t border-line pt-8">
        <p className="eyebrow mb-4">Daily email</p>
        <div className="space-y-4 max-w-md">
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Send my brief to <span className="font-mono text-[13px]">{email}</span>
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={hour}
              onChange={(e) => setHour(parseInt(e.target.value, 10))}
              className="field"
              aria-label="Send hour"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <input
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              className="field"
              aria-label="Timezone"
              placeholder="e.g. America/New_York"
            />
          </div>
          {tz !== browserTz && (
            <button
              type="button"
              onClick={() => setTz(browserTz)}
              className="font-mono text-[12px] text-muted hover:text-ink"
            >
              Use my current timezone ({browserTz})
            </button>
          )}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy} className="btn-primary">
              {busy ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-[13px] text-ledger">Saved</span>}
          </div>
        </div>
      </section>

      <section className="border-t border-line pt-8">
        <p className="eyebrow mb-4">Connected tools</p>
        <div className="space-y-3 max-w-md">
          {integrations.length === 0 && (
            <p className="text-[14px] text-muted">Nothing connected yet.</p>
          )}
          {integrations.map((i) => (
            <div key={i.provider} className="flex items-center justify-between text-[14px]">
              <span>
                <span className="capitalize">{i.provider}</span>
                {i.detail && <span className="text-muted"> — {i.detail}</span>}
              </span>
              <button
                onClick={() => disconnect(i.provider)}
                className="font-mono text-[12px] text-oxide hover:opacity-80"
              >
                Disconnect
              </button>
            </div>
          ))}
          <a href="/onboarding" className="inline-block font-mono text-[12px] text-muted hover:text-ink pt-2">
            + Connect a tool
          </a>
        </div>
      </section>

      <DeleteAccount email={email} />
    </div>
  );
}

/**
 * Permanent deletion, self-serve.
 *
 * Confirmation is the user's own email address rather than a word like
 * "delete": it cannot be typed by muscle memory, and it makes deleting the
 * wrong account while signed into two of them essentially impossible. There is
 * no grace period — a soft delete means a `deleted_at` column threaded through
 * every query and a restore path, which is real complexity for a case that
 * should be rare. Say it is permanent and mean it.
 *
 * No red button: BRANDING has no destructive variant, and colour is reserved
 * for deltas. The copy carries the weight.
 */
function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account", { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setBusy(false);
      setError((await res.json()).error ?? "Couldn't delete your account.");
    }
  }

  return (
    <section className="border-t border-line pt-8">
      <p className="eyebrow mb-4">Delete account</p>
      {!open ? (
        <>
          <p className="text-[14px] text-muted leading-relaxed max-w-md mb-4">
            Removes your briefs, collected metrics, chat history and every
            stored integration credential. Immediate, and there is no way back.
          </p>
          <button onClick={() => setOpen(true)} className="btn-ghost">
            Delete my account
          </button>
        </>
      ) : (
        <div className="max-w-md space-y-3">
          <p className="text-[14px] leading-relaxed">
            This deletes everything immediately and cannot be undone. Type{" "}
            <span className="font-mono text-[13px]">{email}</span> to confirm.
          </p>
          <p className="text-[13px] text-muted leading-relaxed">
            Two things we can&apos;t remove for you: the Founder Brief GitHub
            App stays installed on your repositories until you uninstall it in
            GitHub, and Supabase keeps its record of the authorisation. Neither
            can reach anything once your account is gone.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={email}
            className="field"
            aria-label="Type your email address to confirm deletion"
            autoComplete="off"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={remove}
              disabled={busy || typed.trim().toLowerCase() !== email.toLowerCase()}
              className="btn-ghost"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              className="font-mono text-[12px] text-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-[13px] text-oxide">{error}</p>}
        </div>
      )}
    </section>
  );
}
