// ── Collected facts ────────────────────────────────────────────────────

export type GitHubDayData = {
  prs_merged: number;
  merged_titles: string[];
  commits: number;
  deployments: number;
  open_prs: { number: number; title: string; repo: string; age_days: number }[];
  repos: string[];
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
