"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGitHub() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
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
          <button onClick={signInWithGitHub} disabled={busy} className="btn-primary w-full">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Continue with GitHub
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 border-t border-line" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-faint">or</span>
            <div className="flex-1 border-t border-line" />
          </div>

          {sent ? (
            <p className="text-[14px] text-muted border border-line rounded-md px-4 py-3">
              Check your inbox — the sign-in link is on its way to{" "}
              <span className="text-ink">{email}</span>.
            </p>
          ) : (
            <form onSubmit={sendMagicLink} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourstartup.com"
                className="field"
                aria-label="Email address"
              />
              <button type="submit" disabled={busy || !email} className="btn-ghost w-full">
                Email me a sign-in link
              </button>
            </form>
          )}
          {error && <p className="text-[13px] text-oxide">{error}</p>}
        </div>
      </div>
    </main>
  );
}
