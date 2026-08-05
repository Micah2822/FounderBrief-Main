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

  const priorities = brief.priorities
    .map(
      (p, i) =>
        `<tr><td style="padding:7px 0;font-size:15px;color:${ink};line-height:1.5;">
          <span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:${muted};">${i + 1}.</span>&nbsp; ${esc(p)}
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
      Founder Brief &nbsp;·&nbsp; No. ${brief.day_number} &nbsp;·&nbsp; ${esc(formatBriefDate(brief.brief_date))}
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
