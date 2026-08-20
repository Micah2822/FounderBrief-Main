import type { Brief } from "@/lib/types";
import { formatBriefDate } from "@/lib/dates";

// One brief object → one HTML email, same voice as the page.
// Inline styles only (email clients), same palette as the app.

export function renderBriefEmail(brief: Brief, appUrl: string): string {
  const ink = "#191C1F";
  const muted = "#6E7378";
  const line = "#E6E4DF";
  const ledger = "#1E6E50";
  const oxide = "#A8432C";

  const rows = brief.yesterday
    .map((r) => {
      const deltaColor =
        r.delta?.direction === "up" ? ledger : r.delta?.direction === "down" ? oxide : muted;
      const delta = r.delta
        ? `<span style="color:${deltaColor};font-size:12px;"> &nbsp;${esc(r.delta.text)}</span>`
        : "";
      return `<tr>
        <td style="padding:9px 0;border-bottom:1px dotted ${line};font-size:15px;color:${ink};">${esc(r.label)}${delta}</td>
        <td style="padding:9px 0;border-bottom:1px dotted ${line};font-size:15px;color:${ink};text-align:right;font-family:ui-monospace,Menlo,monospace;font-weight:600;">${esc(r.value)}</td>
      </tr>`;
    })
    .join("");

  // Priorities are ranked, so the first is pulled out — mirroring BriefView.
  // The rule is a border-left on the cell itself: a pseudo-element or a
  // separate spacer column would not survive Outlook.
  const lead = brief.priorities[0]
    ? `<tr><td style="padding:2px 0 2px 14px;border-left:2px solid ${ink};">
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;color:${muted};text-transform:uppercase;padding-bottom:5px;">The main todo</div>
        <div style="font-size:17px;color:${ink};line-height:1.4;font-weight:600;">${esc(brief.priorities[0])}</div>
      </td></tr>
      <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>`
    : "";

  const priorities =
    lead +
    brief.priorities
      .slice(1)
      .map(
        (p, i) =>
          `<tr><td style="padding:7px 0;font-size:15px;color:${ink};line-height:1.5;">
          <span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:${muted};">${i + 2}.</span>&nbsp; ${esc(p)}
        </td></tr>`
      )
      .join("");

  const gaps = brief.gaps.length
    ? `<p style="font-size:13px;color:${muted};line-height:1.6;margin:28px 0 0;border-top:1px solid ${line};padding-top:16px;">${brief.gaps.map(esc).join("<br/>")}</p>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#FAFAF8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr><td style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;color:${muted};text-transform:uppercase;border-top:2px solid ${ink};border-bottom:1px solid ${line};padding:10px 0;">
      Founder Brief &nbsp;·&nbsp; No. ${brief.day_number} &nbsp;·&nbsp; Covering ${esc(formatBriefDate(brief.brief_date))}
    </td></tr>
    <tr><td style="padding:36px 0 8px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;color:${ink};">Good morning.</div>
    </td></tr>
    <tr><td style="padding:24px 0 6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;color:${muted};text-transform:uppercase;">Yesterday</td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    <tr><td style="padding:28px 0 6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;color:${muted};text-transform:uppercase;">Main insight</td></tr>
    <tr><td style="font-size:16px;color:${ink};line-height:1.6;font-family:Georgia,serif;">${esc(brief.insight)}</td></tr>
    <tr><td style="padding:28px 0 6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;color:${muted};text-transform:uppercase;">Today</td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${priorities}</table></td></tr>
    <tr><td>${gaps}</td></tr>
    <tr><td style="padding:36px 0 0;">
      <a href="${appUrl}" style="font-size:13px;color:${muted};">Open Founder Brief →</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Emails the operator when an account was deleted but its Stripe customer could
 * not be, so the subscription is still billing someone who no longer has an
 * account. Same rule as `sendCronAlertEmail` below: ids only, never the error
 * text — a Stripe error can quote a request URL.
 *
 * Best-effort by nature: silent if `ALERT_EMAIL` is unset, and Resend can be
 * down. `scripts/audit-billing.mjs` is the backstop that does not depend on an
 * email arriving.
 */
export async function sendOrphanedCustomerAlert(
  userId: string,
  stripeCustomerId: string
): Promise<boolean> {
  const to = process.env.ALERT_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) return false;

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Founder Brief <onboarding@resend.dev>",
    to,
    subject: `Founder Brief — orphaned Stripe customer ${stripeCustomerId}`,
    text:
      `An account was deleted but its Stripe customer was not.\n` +
      `Until it is, that customer is still being billed.\n\n` +
      `user id      ${userId}\n` +
      `customer id  ${stripeCustomerId}\n\n` +
      `Stripe dashboard -> Customers -> ${stripeCustomerId} -> Delete.\n\n` +
      `Detail is in the Vercel logs.`,
  });
  if (error) {
    console.error("resend alert error", error);
    return false;
  }
  return true;
}

/**
 * Emails the operator when a cron run failed some users.
 *
 * Configuration is one variable: `ALERT_EMAIL` is both the on/off switch and
 * the recipient. Unset means no alerts.
 *
 * **Never include the error text here.** A fetch error can contain a URL with a
 * key in it, a PostgREST error can contain the query, and an OpenAI error can
 * contain the prompt — which holds PR titles and the founder's goal. Sending
 * stage names, counts and user ids means this email creates no new store of
 * personal data; the detail stays in the Vercel logs, which are
 * access-controlled. Adding "just the message, it's easier to debug" would
 * quietly turn an operational alert into a copy of customer data in an inbox.
 *
 * Separate from the 500 the cron returns when a whole run fails — see
 * ARCHITECTURE › Knowing when a brief fails for why both exist.
 */
export async function sendCronAlertEmail(
  stageCounts: Record<string, number>,
  affectedUserIds: string[],
  totalProcessed: number,
  /**
   * Users who were due but never started, because the run hit its start
   * deadline. Not a failure — the next tick takes them first — but it is the
   * signal that one hour no longer fits the load, and it arrives before
   * anyone notices a late brief. A count only: the ids are in the response
   * body and the logs, and this email deliberately stays a summary.
   */
  deferred = 0
): Promise<boolean> {
  const to = process.env.ALERT_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) return false;

  const failed = affectedUserIds.length;
  const stages = Object.entries(stageCounts)
    .map(([stage, n]) => `${stage.padEnd(16)} ${n}`)
    .join("\n");

  // A run can defer without failing anything, so the subject has to be able
  // to say so rather than reading "0 of N briefs failed" and looking like a
  // false alarm.
  const subject = failed
    ? `Founder Brief — ${failed} of ${totalProcessed} briefs failed`
    : `Founder Brief — ${deferred} briefs deferred, out of capacity`;

  const deferredNote = deferred
    ? `\n\n${deferred} user(s) were due but not started before the run's ` +
      `deadline. They are first in line next hour. If this is not zero every ` +
      `hour, one tick no longer fits the load — raise CRON_CONCURRENCY, or ` +
      `maxDuration on a paid plan.`
    : "";

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Founder Brief <onboarding@resend.dev>",
    to,
    subject,
    text:
      `${stages || "(no failures)"}\n\nAffected user ids:\n` +
      `${affectedUserIds.join("\n") || "(none)"}` +
      `${deferredNote}\n\nDetail is in the Vercel logs for this run.`,
  });
  if (error) {
    console.error("resend alert error", error);
    return false;
  }
  return true;
}

export async function sendBriefEmail(
  to: string,
  brief: Brief
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Founder Brief <onboarding@resend.dev>",
    to,
    subject: `Your Founder Brief — ${formatBriefDate(brief.brief_date)}`,
    html: renderBriefEmail(brief, appUrl),
  });
  if (error) {
    console.error("resend error", error);
    return false;
  }
  return true;
}
