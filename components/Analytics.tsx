"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  analyticsEnabled,
  denyConsent,
  grantConsent,
  identifyUser,
  initAnalytics,
  readConsent,
  resetUser,
} from "@/lib/analytics";

/**
 * Mounted once, in the root layout. Two jobs: initialise Mixpanel opted-out,
 * and keep its identity in step with the Supabase session.
 *
 * Identity is driven by `onAuthStateChange` rather than by the sign-in and
 * sign-out handlers, because those are not the only ways in. Sign-in also
 * happens through /auth/callback (a server redirect, where no client code of
 * ours runs), and sign-out is a plain form POST to /auth/signout that ends in
 * a redirect — neither has a place to hang an identify() or reset() call.
 * The auth listener sees all of them, plus token refreshes and the returning
 * visitor whose session is restored from storage with no event of its own.
 */
export function Analytics() {
  const [consent, setConsent] = useState<"granted" | "denied" | null | "pending">(
    "pending"
  );

  useEffect(() => {
    if (!analyticsEnabled()) return;
    initAnalytics();
    setConsent(readConsent());

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        resetUser();
        return;
      }
      // INITIAL_SESSION fires on every load, with a session or null. Calling
      // identify() repeatedly with the same id is free; missing it means a
      // returning founder's events land on a fresh anonymous profile.
      if (session?.user) identifyUser(session.user.id, session.user.email);
    });

    return () => subscription.unsubscribe();
  }, []);

  // "pending" is the pre-effect render, and it matters: reading localStorage
  // during render would make the server and client markup disagree.
  if (consent !== null) return null;

  return <ConsentBanner onChoice={(c) => setConsent(c)} />;
}

function ConsentBanner({ onChoice }: { onChoice: (c: "granted" | "denied") => void }) {
  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/95 backdrop-blur"
    >
      <div className="mx-auto max-w-3xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <p className="text-[13px] leading-relaxed text-muted flex-1">
          We&apos;d like to count a few product actions — sign-ups and briefs
          generated — to see what&apos;s working. No advertising, no third-party
          trackers, and nothing from inside your brief.{" "}
          <Link href="/privacy" className="underline hover:text-ink">
            How this works
          </Link>
          .
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn-ghost"
            onClick={() => {
              denyConsent();
              onChoice("denied");
            }}
          >
            No thanks
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              grantConsent();
              onChoice("granted");
            }}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
