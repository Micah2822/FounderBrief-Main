import type { Brief } from "@/lib/types";

// The sample brief shown on the landing page and /preview. Fake data,
// honest shape — exactly what a real morning looks like.
export const SAMPLE_BRIEF: Brief = {
  brief_date: "2026-07-10",
  day_number: 12,
  yesterday: [
    {
      label: "Website visitors",
      value: "412",
      delta: { text: "+96 vs prior day", direction: "up" },
    },
    {
      label: "New signups",
      value: "31",
      delta: { text: "+9 vs prior day", direction: "up" },
    },
    // Revenue sits between signups and shipping, and "New customers" carries
    // no delta — both match buildLedger's real output for a connected Stripe.
    {
      label: "Revenue",
      value: "$348",
      delta: { text: "+$108 vs prior day", direction: "up" },
    },
    { label: "New customers", value: "4" },
    // Shipping rows in buildLedger's exact order: commits, then deployments,
    // then the two PR rows — which appear only because this founder uses pull
    // requests (`uses_prs`), evidenced by the open PR in the priorities below.
    // Deployments renders even at zero, so it is never absent when GitHub is
    // connected. A specimen the engine could not reproduce would be a false
    // claim about the product, so this list has to track buildLedger exactly.
    { label: "Commits pushed", value: "14" },
    { label: "Deployments", value: "1" },
    { label: "Pull requests merged", value: "2" },
    { label: "Open pull requests", value: "1" },
  ],
  insight:
    "Signups are up 38% week over week (117 vs 85), and four of yesterday's 31 converted to paid — $348, up $108 on the day. Most of the traffic came from Twitter (241 of 412 visitors), so the launch thread is still working. The onboarding branch has been open for 3 days while growth compounds.",
  // Ordered the way baselinePriorities ranks them: the channel that caused
  // yesterday (70) leads, then the paying customers (65). The Twitter spike
  // outranks the revenue rise because it explains it — a $108 day-on-day
  // increase on an already-earning account isn't the first-money case that
  // scores 90.
  priorities: [
    "Post again where yesterday's spike came from — Twitter drove 241 visitors.",
    "Talk to one of yesterday's 4 new paying customers — ask what tipped them over.",
    'Review and merge PR #47 — "Onboarding improvements" has been open 3 days.',
  ],
  // Empty on purpose. Every gap findGaps() can emit is either a missing
  // integration or a stall, and this founder has all four connected and a
  // healthy day — so a real brief would render no gaps footer at all.
  gaps: [],
  generated_with: "ai",
};
