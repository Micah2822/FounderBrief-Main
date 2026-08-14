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
      <p className="font-mono text-[12px] text-faint mt-2">Last updated August 13, 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed">
        <section>
          <p className="eyebrow mb-2">What we collect</p>
          <p className="text-muted">
            Your email address (to sign you in and send your brief), and daily
            aggregate activity from the tools you connect: counts of merged
            pull requests, commits, deployments, the subject lines of your
            commits and open pull request titles, and counts of new rows in the
            one database table you choose.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">What we never collect</p>
          <p className="text-muted">
            The contents of your database rows. Your connected Supabase project
            is queried with counts, and with one exception: we read the
            timestamp of your most recent row in the single date column you
            map, so the brief can say how long it has been rather than only
            &ldquo;no signups today&rdquo;. That timestamp is used to work out a
            number of days and is not stored. No other column is ever read — we
            cannot see your users&apos; names, emails, or any other row data.
            We do not read your source code. We do read the subject line of
            each commit — the one-line description you write, not the change
            itself — so the brief can say what you shipped rather than only how
            much.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">How your credentials are stored</p>
          <p className="text-muted">
            We ask for the least access each tool allows. GitHub is read-only
            and stores no credential at all — access is granted per-repository
            when you install our GitHub App, and short-lived tokens are issued
            as needed. Stripe accepts only restricted, read-only keys. When you
            connect Supabase we use the sign-in to fetch one project&apos;s key
            and then discard the account access itself, so we never hold
            standing access to your Supabase organisation.
          </p>
          <p className="text-muted mt-3">
            The keys we do store are encrypted at rest with AES-256-GCM and are
            never sent to your browser. You can disconnect any integration at
            any time in Settings, which deletes the credential.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Diagnostics</p>
          <p className="text-muted">
            When a brief fails to generate, our server logs record which
            account it was for, which step failed, and the technical error, so
            that it can be fixed. Those logs are held by our hosting provider
            for a short retention period and are used for nothing else. The
            failure alert we send ourselves is narrower still — a step name, a
            count, and an account identifier, never the error text and never
            anything drawn from your brief or your database.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Cookies</p>
          <p className="text-muted">
            Only the ones the site cannot work without, and no consent banner,
            because there is nothing here to consent to. We set a session cookie
            to keep you signed in, short-lived cookies during a connection flow
            to verify the request came from you, and nothing else. There are no
            advertising cookies, no analytics cookies, and no third-party
            trackers on any page. All of them are marked{" "}
            <span className="font-mono text-[13px]">HttpOnly</span> and{" "}
            <span className="font-mono text-[13px]">Secure</span>, so they are
            unreadable to scripts and never sent over an unencrypted
            connection. Signing out clears them.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Third parties</p>
          <p className="text-muted">
            We use Supabase (authentication and storage), Vercel (hosting),
            Resend (email delivery), and OpenAI (to phrase your brief and
            answer questions). Only aggregate counts, commit subject lines and
            PR titles are sent to OpenAI — never your credentials, never your
            source code, never your users&apos; data. We
            do not sell data or use it for advertising. Your data is used to
            generate your brief, and for nothing else.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Deletion</p>
          <p className="text-muted">
            Delete your account yourself in Settings. It is immediate and
            permanent: all briefs, metrics, credentials, and chat history are
            removed, with no grace period and no way back. Disconnecting a
            single integration immediately deletes its stored credential.
            Two things sit outside our reach — the Founder Brief GitHub App
            stays installed on your repositories until you uninstall it in
            GitHub, and Supabase keeps its own record of the authorisation.
            Neither can reach anything once your account is gone.
          </p>
        </section>

        <section>
          <p className="eyebrow mb-2">Contact</p>
          <p className="text-muted">
            Questions: write to info@fndrbrief.com.
          </p>
        </section>
      </div>
    </main>
  );
}
