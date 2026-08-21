import Link from "next/link";
import { BriefView } from "@/components/BriefView";
import { SAMPLE_BRIEF } from "@/lib/sample";
import { Wordmark } from "@/components/Wordmark";

// The logged-out homepage. One column, same dispatch voice as the product —
// the landing page IS a demo of the product.

export function Landing() {
  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      {/* Hero */}
      <header className="rise border-t-2 border-ink">
        <p className="eyebrow flex items-baseline justify-between border-b border-line py-[10px]">
          <Wordmark />
          <Link href="/login" className="hover:text-ink transition-colors">
            Sign in
          </Link>
        </p>
      </header>

      <section className="rise rise-1 mt-12">
        <h1 className="font-serif text-[34px] sm:text-[42px] leading-[1.15]">
          Your startup, every morning,{" "}
          <br className="hidden sm:block" />
          in 30 seconds.
        </h1>
        <p className="text-muted text-[16px] leading-relaxed mt-5 max-w-[30rem]">
          Everything you need to know for your startup is already in your
          tools — just scattered across five of them.
          <br />
          Founder Brief reads your tools while you sleep, then tells you:{" "}
          <em className="text-ink not-italic font-medium">
            what happened yesterday, and what should I focus on today?
          </em>
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/login" className="btn-primary">
            Get your morning brief
          </Link>
          <span className="font-mono text-[12px] text-faint">
            2-minute setup
          </span>
        </div>
      </section>

      {/* The sample brief IS the pitch */}
      <section className="rise rise-2 mt-20" aria-label="A sample brief">
        <p className="eyebrow mb-5">This lands in your inbox at 7am —</p>
        <div className="border border-line rounded-lg p-5 sm:p-9">
          <BriefView brief={SAMPLE_BRIEF} greeting="Good morning." sample />
        </div>
      </section>

      {/* How it works */}
      <section className="rise rise-3 mt-20" aria-label="How it works">
        <p className="eyebrow mb-4">How it works</p>
        <div className="space-y-5">
          {[
            {
              t: "Connect what you have",
              d: "GitHub for shipping, Supabase for signups, Plausible for traffic, Stripe when revenue arrives — any one is enough to start.",
            },
            {
              t: "We collect and compare, every night",
              d: "Visitors, new signups, merged PRs, deploys — diffed against yesterday and last week. Deltas, streaks, gaps.",
            },
            {
              t: "You read one brief, then build",
              d: "One page, one email. What moved, the one insight that matters, and the things that actually deserve today.",
            },
          ].map((s, i) => (
            <div key={i} className="flex gap-4">
              <span className="font-mono text-[12px] text-muted pt-[3px]">{i + 1}.</span>
              <div>
                <p className="text-[15px] font-medium">{s.t}</p>
                <p className="text-[14px] text-muted leading-relaxed mt-1">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Principles — the honest part is the moat */}
      <section className="rise rise-4 mt-20 border-t border-line pt-8" aria-label="Principles">
        <p className="eyebrow mb-4">What it will never do</p>
        <div className="space-y-3 text-[14px] leading-relaxed">
          <p>
            <span className="font-medium">Invent a number.</span>{" "}
            <span className="text-muted">
              Every figure is computed from your connected data. The AI writes
              the prose; it never originates a fact.
            </span>
          </p>
          <p>
            <span className="font-medium">Guess a cause.</span>{" "}
            <span className="text-muted">
              If your data can&apos;t explain a change, your brief says
              &ldquo;cause unknown&rdquo; — not a plausible story.
            </span>
          </p>
          <p>
            <span className="font-medium">Read your users&apos; data.</span>{" "}
            <span className="text-muted">
              Your database is counted, not read — plus one timestamp, so we can
              say how long it has been. Names, emails and everything else stay
              in your project.
            </span>
          </p>
          <p>
            <span className="font-medium">Become a dashboard.</span>{" "}
            <span className="text-muted">
              No charts, no filters, no tabs. A brief you finish.
            </span>
          </p>
        </div>
      </section>

      {/* Final CTA + footer */}
      <section className="rise rise-5 mt-20">
        <div className="border-t-2 border-ink pt-6">
          <p className="font-serif text-[22px] leading-snug">
            Tomorrow morning, know exactly where your startup stands.
          </p>
          <Link href="/login" className="btn-primary mt-5">
            Get your morning brief
          </Link>
        </div>
        <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 font-mono text-[12px] text-muted">
          <span>© {new Date().getFullYear()} Founder Brief</span>
          <span className="flex gap-5">
            <Link href="/preview" className="hover:text-ink transition-colors">
              Sample brief
            </Link>
            <Link href="/privacy" className="hover:text-ink transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ink transition-colors">
              Terms
            </Link>
          </span>
        </footer>
      </section>
    </main>
  );
}
