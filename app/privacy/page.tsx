import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <p className="eyebrow border-t-2 border-ink pt-3 flex justify-between">
        <Wordmark suffix="Privacy" />
        <Link href="/" className="hover:text-ink transition-colors">
          ← Home
        </Link>
      </p>

      <h1 className="font-serif text-[32px] leading-tight mt-10">Privacy policy</h1>
      <p className="font-mono text-[12px] text-faint mt-2">Last updated July 11, 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed">
        <section>
          <p className="eyebrow mb-2">What we collect</p>
          <p className="text-muted">
            Your email address (to sign you in and send your brief), and daily
            aggregate activity from the tools you connect: counts of merged
            pull requests, commits, deployments, open pull request titles, and
            counts of new rows in the one database table you choose.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">What we never collect</p>
          <p className="text-muted">
            The contents of your database rows. Your connected Supabase project
            is only ever queried with counts — we cannot see, and never store,
            your users&apos; names, emails, or any row data. We do not read
            your source code; only PR titles and activity counts.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">How your credentials are stored</p>
          <p className="text-muted">
            Integration tokens and keys are encrypted at rest with AES-256-GCM
            and are never sent to your browser. You can disconnect any
            integration at any time in Settings, which deletes the credential.
            We recommend connecting a read-only key where possible.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Third parties</p>
          <p className="text-muted">
            We use Supabase (authentication and storage), Vercel (hosting),
            Resend (email delivery), and OpenAI (to phrase your brief and
            answer questions). Only aggregate counts and PR titles are sent to
            OpenAI — never your credentials, never your users&apos; data. We
            do not sell data or use it for advertising. Your data is used to
            generate your brief, and for nothing else.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Deletion</p>
          <p className="text-muted">
            Delete your account by emailing us — all briefs, metrics,
            credentials, and chat history are removed. Disconnecting an
            integration immediately deletes its stored credential.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Contact</p>
          <p className="text-muted">
            Questions: reply to any brief email, or write to
            privacy@founderbrief.app.
          </p>
        </section>
      </div>
    </main>
  );
}
