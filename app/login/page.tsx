"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    setStep("code");
    return true;
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const token = code.replace(/\D/g, "");

    // type "email" covers both a first-ever sign-in and a returning one. Do
    // not retry with another type on failure: a failed attempt can invalidate
    // the token, so a speculative second call turns a recoverable typo into a
    // dead code.
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

    if (error) {
      setBusy(false);
      setCode("");
      // Supabase returns one message, "Token has expired or is invalid", for
      // both cases — so don't claim it expired, which sends people off to
      // request a new code when the real cause was a typo.
      setError(`${error.message}. Check the code, or send a new one.`);
      return;
    }

    // Where to land is decided by the server: /  redirects to /onboarding
    // when no tools are connected yet.
    router.replace("/");
    router.refresh();
  }

  function startOver() {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
  }

  async function resend() {
    if (await sendCode()) setNotice("Sent a new code.");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="rise">
          <p className="eyebrow border-t-2 border-ink pt-3">Founder Brief</p>
          <h1 className="font-serif text-[30px] sm:text-[34px] leading-tight mt-8">
            Your startup, every{" "}
            <br className="hidden sm:block" />
            morning, in 30 seconds.
          </h1>
          <p className="text-muted text-[14px] leading-relaxed mt-4">
            What happened yesterday, and what to focus on today. No dashboards
            — a brief.
          </p>
        </div>

        <div className="mt-10 space-y-3 rise rise-2">
          {step === "email" ? (
            <form onSubmit={sendCode} className="space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourstartup.com"
                className="field"
                aria-label="Email address"
              />
              <button type="submit" disabled={busy || !email} className="btn-primary w-full">
                {busy ? "Sending…" : "Email me a sign-in code"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-3">
              <p className="text-[14px] text-muted">
                We sent a 6-digit code to{" "}
                <span className="text-ink">{email}</span>.
              </p>
              <input
                type="text"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="field font-mono tracking-[0.4em] text-center"
                aria-label="Six-digit sign-in code"
              />
              <button
                type="submit"
                disabled={busy || code.length < 6}
                className="btn-primary w-full"
              >
                {busy ? "Verifying…" : "Sign in"}
              </button>
              <div className="flex items-center justify-between font-mono text-[11px] text-muted pt-1">
                <button type="button" onClick={startOver} className="hover:text-ink transition-colors">
                  ← Use a different email
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={busy}
                  className="hover:text-ink transition-colors disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}
          {notice && <p className="text-[13px] text-muted">{notice}</p>}
          {error && <p className="text-[13px] text-oxide">{error}</p>}
        </div>
      </div>
    </main>
  );
}
