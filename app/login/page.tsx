"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import { identifyUser, track } from "@/lib/analytics";

// Supabase's OTP length is a project setting, not a constant — it can be any
// value from 6 to 10 digits, and this project currently issues 8. Do not
// hardcode a length: truncating the code produces a token that Supabase
// rejects as "expired or invalid", which looks like a server problem and is
// almost impossible to diagnose from the error alone.
const MIN_CODE = 6;
const MAX_CODE = 10;

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
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

    if (error) {
      setBusy(false);
      setCode("");
      // Supabase returns one message, "Token has expired or is invalid", for
      // both cases — so don't claim it expired, which sends people off to
      // request a new code when the real cause was a typo.
      setError(`${error.message}. Check the code, or send a new one.`);
      return;
    }

    // One OTP flow serves both first-ever and returning sign-in — Supabase
    // gives no "this is a new user" flag, so the two are told apart by the
    // clock: on a first sign-in the row was created moments ago, on a
    // returning one `created_at` is days or months old. The window is
    // deliberately wide (a minute) because these are two separate server
    // writes, and deliberately not wider, because a user who signs in exactly
    // once a minute does not exist.
    const u = data?.user;
    if (u) {
      identifyUser(u.id, u.email);
      const ageMs = Date.now() - new Date(u.created_at).getTime();
      if (ageMs < 60_000) {
        track("sign_up_completed", { sign_up_method: "email_otp" });
      }
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
          <p className="eyebrow border-t-2 border-ink pt-3">
            <Wordmark />
          </p>
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
                We sent a sign-in code to{" "}
                <span className="text-ink">{email}</span>.
              </p>
              <input
                type="text"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={MAX_CODE}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, MAX_CODE))}
                className="field font-mono tracking-[0.4em] text-center"
                aria-label="Sign-in code"
              />
              <button
                type="submit"
                disabled={busy || code.length < MIN_CODE}
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
