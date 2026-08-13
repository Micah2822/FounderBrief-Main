// ── Collected facts ────────────────────────────────────────────────────

export type GitHubDayData = {
  // False when the tracked repos show no PR activity at all (none open, none
  // merged in 30 days) — i.e. the founder pushes straight to the default
  // branch. Optional so briefs stored before this existed still deserialize.
  uses_prs?: boolean;
  prs_merged: number;
  merged_titles: string[];
  commits: number;
  deployments: number;
  open_prs: { number: number; title: string; repo: string; age_days: number }[];
  repos: string[];
  // Repos whose commits could not be read (permissions, or removed from the
  // installation). Present so `commits` is never silently understated — an
  // unread repo is a gap, not a zero.
  unreadable_repos?: string[];
};

export type ProductDayData = {
  new_signups: number;
  total_signups: number;
  table: string;
};

export type RevenueDayData = {
  gross_revenue: number; // major units (dollars, not cents)
  currency: string; // ISO code, lowercase ("usd")
  charges: number;
  new_customers: number;
};

export type TrafficDayData = {
  visitors: number;
  pageviews: number;
  domain: string;
  top_sources?: { source: string; visitors: number }[];
};

// ── Diff engine output: everything the LLM is allowed to know ─────────

export type Facts = {
  date: string; // ISO date the brief covers ("yesterday" in user tz)
  weekday: string;
  github?: GitHubDayData & {
    commits_prev_day: number;
    days_since_last_ship: number | null; // days since a merge or deploy
  };
  product?: ProductDayData & {
    // Days between the brief's date and the most recent signup. Null when the
    // table is empty or couldn't be read — never treat null as zero.
    days_since_last_signup: number | null;
    prev_day: number;
    week_total: number;
    prev_week_total: number;
    week_change_pct: number | null;
  };
  traffic?: TrafficDayData & {
    prev_day_visitors: number;
    week_visitors: number;
    prev_week_visitors: number;
    week_change_pct: number | null;
  };
  revenue?: RevenueDayData & {
    prev_day_revenue: number;
    week_revenue: number;
    prev_week_revenue: number;
    week_change_pct: number | null;
  };
  founder_goal?: string; // the founder's stated focus, verbatim
  partial?: boolean; // covers midnight → now, not a finished day
  gaps: string[]; // honest holes: "Stripe not connected", "No deploys in 3 days"
};

// ── The brief itself ───────────────────────────────────────────────────

export type LedgerRow = {
  label: string;
  value: string; // display value, e.g. "31" or "—"
  delta?: { text: string; direction: "up" | "down" | "flat" };
};

export type Brief = {
  brief_date: string; // the day it covers
  day_number: number; // "NO. 12" — days since first brief
  yesterday: LedgerRow[];
  insight: string;
  priorities: string[];
  gaps: string[];
  generated_with: "ai" | "deterministic";
  // True when the brief covers a day still in progress (midnight → now) rather
  // than a closed one. Optional so briefs stored before this existed still
  // deserialize. Its comparisons are measured against the same hours of the
  // previous day, never against a whole day the period hasn't finished.
  partial?: boolean;
};

export type IntegrationRow = {
  id: string;
  user_id: string;
  provider: "github" | "supabase" | "plausible" | "stripe";
  access_token: string | null;
  config: Record<string, any>;
};

export type UserSettings = {
  user_id: string;
  timezone: string;
  send_hour: number;
  email_enabled: boolean;
  goal: string | null;
  onboarded_at: string | null;
};
