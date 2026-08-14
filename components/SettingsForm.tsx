"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Every connector the product has, in onboarding order. Used to show a free
// account which tools it is not currently able to add.
const ALL_PROVIDERS = [
  { provider: "github", label: "GitHub" },
  { provider: "supabase", label: "Supabase" },
  { provider: "stripe", label: "Stripe" },
  { provider: "plausible", label: "Plausible" },
];

// Where Team / Growth enquiries go. A mailto rather than a form: it needs no
// route, no table and no spam handling, and the tradeoff — enquiries live in an
// inbox rather than the database — is the right one at this volume.
const CONTACT_EMAIL = "info@fndrbrief.com";

export function SettingsForm({
  email,
  timezone,
  sendHour,
  emailEnabled,
  goal: initialGoal,
  integrations,
  tier,
  connectorLimit,
}: {
  email: string;
  timezone: string;
  sendHour: number;
  emailEnabled: boolean;
  goal: string;
  integrations: { provider: string; detail: string }[];
  tier: "free" | "founder";
  /**
   * Passed in rather than imported from `lib/billing`: this is a client
   * component, and that module reaches the service-role client. Nothing would
   * leak today — the key is read inside a function body, so a client bundle
   * would only ever see `undefined` — but importing a server-only module into
   * the browser is how that stops being true later.
   */
  connectorLimit: number;
}) {
  const router = useRouter();
  const [tz, setTz] = useState(timezone);
  const [hour, setHour] = useState(sendHour);
  const [enabled, setEnabled] = useState(emailEnabled);
  const [goal, setGoal] = useState(initialGoal);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  const connected = new Set(integrations.map((i) => i.provider));
  const atLimit = tier === "free" && integrations.length >= connectorLimit;

  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  /**
   * Both billing buttons hand off to a Stripe-hosted page. Nothing about a card
   * is ever typed into this app, which is why there is no billing UI here
   * beyond these two buttons.
   *
   * `busy` is never cleared on success: the browser is navigating away, and
   * resetting it would flash the button back to its idle label mid-redirect.
   */
  async function openBilling(path: string, fallback: string) {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json();
      if (res.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      // 409 means the webhook already promoted them and this tab is stale.
      if (res.status === 409) {
        router.refresh();
        setBillingError("You're already on Founder — reloading.");
      } else {
        setBillingError(fallback);
      }
    } catch {
      setBillingError(fallback);
    }
    setBillingBusy(false);
  }

  const upgrade = () =>
    openBilling("/api/billing/checkout", "Couldn't open checkout. Try again.");
  const openPortal = () =>
    openBilling("/api/billing/portal", "Couldn't open billing. Try again.");

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
          {/* The tools a free account at its limit cannot add. Shown rather
              than hidden so the limit is visible before it is hit, and marked
              with `faint` plus a mono tag rather than a badge or a lock icon —
              BRANDING reserves colour for deltas, so the demotion in weight is
              what carries the locked state. */}
          {atLimit &&
            ALL_PROVIDERS.filter((p) => !connected.has(p.provider)).map((p) => (
              <div
                key={p.provider}
                className="flex items-center justify-between text-[14px] text-faint"
              >
                <span>{p.label}</span>
                <span className="font-mono text-[12px]">Founder</span>
              </div>
            ))}
          {atLimit ? (
            <p className="border-t border-line mt-3 pt-3 text-[13px] text-muted leading-relaxed">
              {integrations.length} of {connectorLimit} used. Founder connects
              the rest.
            </p>
          ) : (
            <a
              href="/onboarding"
              className="inline-block font-mono text-[12px] text-muted hover:text-ink pt-2"
            >
              + Connect a tool
            </a>
          )}
        </div>
      </section>

      <section className="border-t border-line pt-8">
        <p className="eyebrow mb-4">Plan</p>
        <div className="max-w-md">
          <div className="ledger-row">
            <span className="text-[15px]">Current plan</span>
            <span className="ledger-leader" aria-hidden />
            <span className="ledger-value">
              {tier === "founder" ? "Founder" : "Free"}
            </span>
          </div>
          <div className="ledger-row">
            <span className="text-[15px]">Connected tools</span>
            <span className="ledger-leader" aria-hidden />
            <span className="ledger-value">
              {tier === "founder"
                ? integrations.length
                : `${integrations.length} of ${connectorLimit}`}
            </span>
          </div>
          {tier === "free" ? (
            <>
              <p className="text-[14px] text-muted leading-relaxed mt-4">
                Free covers two connected tools. Founder removes the limit — $19
                a month, cancel any time.
              </p>
              <button
                onClick={upgrade}
                disabled={billingBusy}
                className="btn-primary mt-4"
              >
                {billingBusy ? "Opening…" : "Upgrade to Founder"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={openPortal}
                disabled={billingBusy}
                className="btn-ghost mt-4"
              >
                {billingBusy ? "Opening…" : "Manage billing"}
              </button>
              <p className="text-[13px] text-muted leading-relaxed mt-3">
                Invoices, card details and cancellation open in Stripe.
              </p>
            </>
          )}
          {billingError && (
            <p className="text-[13px] text-oxide mt-3">{billingError}</p>
          )}
          <p className="font-mono text-[12px] text-muted mt-4">
            Team or growth company?{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="hover:text-ink transition-colors"
            >
              Get in touch
            </a>
          </p>
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
