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
    { label: "Pull requests merged", value: "2" },
    { label: "Deployments", value: "1" },
  ],
  insight:
    "Signups are up 38% week over week (117 vs 85), and most of yesterday's traffic came from Twitter (241 of 412 visitors) — your launch thread is still working. The onboarding branch has been open for 3 days while growth is compounding.",
  priorities: [
    "Post again where yesterday's spike came from — Twitter drove 241 visitors.",
    'Review and merge PR #47 — "Onboarding improvements" has been open 3 days.',
    "Talk to one of yesterday's 31 new signups — ask what brought them.",
  ],
  gaps: ["Stripe isn't connected — revenue isn't being tracked."],
  generated_with: "ai",
};
