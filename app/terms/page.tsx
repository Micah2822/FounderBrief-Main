import Link from "next/link";

export const metadata = { title: "Terms — Founder Brief" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <p className="eyebrow border-t-2 border-ink pt-3 flex justify-between">
        <span>Founder Brief · Terms</span>
        <Link href="/" className="hover:text-ink transition-colors">
          ← Home
        </Link>
      </p>

      <h1 className="font-serif text-[32px] leading-tight mt-10">Terms of service</h1>
      <p className="font-mono text-[12px] text-faint mt-2">Last updated July 11, 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed">
        <section>
          <p className="eyebrow mb-2">The service</p>
          <p className="text-muted">
            Founder Brief generates a daily summary of your startup&apos;s
            activity from tools you choose to connect. It is currently in beta
            and free to use. We may introduce paid plans later; you&apos;ll be
            told before anything changes.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Your responsibilities</p>
          <p className="text-muted">
            Connect only accounts and databases you are authorized to connect.
            Keep your sign-in email secure. Don&apos;t use the service to
            process data you don&apos;t have the right to process.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">No advice</p>
          <p className="text-muted">
            Briefs and chat answers are generated summaries of your own data.
            They are not financial, legal, or investment advice. You make the
            decisions; we make the mornings shorter.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Availability and liability</p>
          <p className="text-muted">
            The service is provided as-is during beta, without warranties. We
            aim for every brief to be accurate and on time, but we are not
            liable for missed briefs, third-party API outages, or decisions
            made from your data. Our total liability is limited to the amount
            you paid us in the last 12 months.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Termination</p>
          <p className="text-muted">
            You can stop using the service and delete your data at any time.
            We may suspend accounts that abuse the service or the APIs it
            connects to.
          </p>
        </section>
      </div>
    </main>
  );
}
