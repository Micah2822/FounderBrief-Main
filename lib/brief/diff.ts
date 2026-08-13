import type { Facts, LedgerRow } from "@/lib/types";

// The deterministic engine. Every number a founder sees is computed here,
// from collected data. The LLM only rephrases — it never originates a fact.

export function buildLedger(facts: Facts): LedgerRow[] {
  const rows: LedgerRow[] = [];

  // Users and market first; shipping second.
  if (facts.traffic) {
    const t = facts.traffic;
    const diff = t.visitors - t.prev_day_visitors;
    rows.push({
      label: "Website visitors",
      value: String(t.visitors),
      delta:
        diff === 0
          ? { text: "same as prior day", direction: "flat" }
          : {
              text: `${diff > 0 ? "+" : ""}${diff} vs prior day`,
              direction: diff > 0 ? "up" : "down",
            },
    });
  }

  if (facts.product) {
    const p = facts.product;
    const diff = p.new_signups - p.prev_day;
    rows.push({
      label: "New signups",
      value: String(p.new_signups),
      delta:
        diff === 0
          ? { text: "same as prior day", direction: "flat" }
          : {
              text: `${diff > 0 ? "+" : ""}${diff} vs prior day`,
              direction: diff > 0 ? "up" : "down",
            },
    });
  }

  if (facts.revenue) {
    const r = facts.revenue;
    const diff = round2(r.gross_revenue - r.prev_day_revenue);
    rows.push({
      label: "Revenue",
      value: money(r.gross_revenue, r.currency),
      delta:
        diff === 0
          ? { text: "same as prior day", direction: "flat" }
          : {
              text: `${diff > 0 ? "+" : "−"}${money(Math.abs(diff), r.currency)} vs prior day`,
              direction: diff > 0 ? "up" : "down",
            },
    });
    rows.push({ label: "New customers", value: String(r.new_customers) });
  }

  if (facts.github) {
    const g = facts.github;
    // Commits first: it is the one shipping figure that means the same thing
    // in every workflow. A merged PR's commits land on the default branch too,
    // so this already counts PR work — it is not an alternative to the PR row,
    // it is the superset.
    rows.push({ label: "Commits pushed", value: String(g.commits) });

    // Always shown, including at zero. Hiding it on quiet days meant "nothing
    // deployed" — the thing a founder most needs to notice — was the only
    // state that rendered as absence rather than as a number.
    rows.push({ label: "Deployments", value: String(g.deployments) });

    // Only for founders who actually work through PRs. `uses_prs` is absent on
    // briefs generated before it existed; treat that as "yes" so old briefs
    // re-render unchanged.
    if (g.uses_prs !== false) {
      rows.push({ label: "Pull requests merged", value: String(g.prs_merged) });
      rows.push({ label: "Open pull requests", value: String(g.open_prs.length) });
    }
  }

  return rows;
}

export function findGaps(facts: Facts): string[] {
  const gaps: string[] = [];
  const g = facts.github;
  if (g && g.days_since_last_ship !== null) {
    const quiet = g.commits === 0 && g.deployments === 0 && g.prs_merged === 0;
    const n = g.days_since_last_ship;
    if (quiet && n > 0) {
      // The daily email keeps an honest date, so on a quiet day its ledger is
      // all zeroes. This line is what stops that being a dead end: it says
      // when the founder last did something, which is real information and is
      // never itself a zero. Costs nothing extra — days_since_last_ship is
      // already collected.
      gaps.push(
        `Nothing was pushed or deployed — the last activity was ${n} day${n === 1 ? "" : "s"} ago.`
      );
    } else if (n >= 3) {
      gaps.push(`Nothing has shipped in ${n} days.`);
    }
  }
  const p = facts.product;
  if (p && p.new_signups === 0 && p.prev_day === 0) {
    // "No new signups for two days" was true whenever both days were empty —
    // including when the last signup was months ago, which it implied was
    // Monday. Say how long it has actually been.
    const n = p.days_since_last_signup;
    if (p.total_signups === 0) {
      gaps.push("No signups yet.");
    } else if (n !== null && n >= 2) {
      gaps.push(`No new signups in ${n} days.`);
    } else {
      gaps.push("No new signups yesterday or the day before.");
    }
  }
  if (!facts.product && !facts.traffic) {
    gaps.push("No user data is connected — signups and traffic aren't being tracked.");
  } else if (!facts.product) {
    gaps.push("Supabase isn't connected — signups aren't being tracked.");
  } else if (!facts.traffic) {
    gaps.push("Analytics isn't connected — website traffic isn't being tracked.");
  }
  if (!facts.github) {
    gaps.push("GitHub isn't connected — shipping activity isn't being tracked.");
  }
  return gaps;
}

/** Baseline insight: honest, cause-free, always available. */
export function baselineInsight(facts: Facts): string {
  const parts: string[] = [];
  const p = facts.product;
  const g = facts.github;
  const t = facts.traffic;

  // The decision-grade pattern: traffic moving but signups not converting.
  let funnelCase = false;
  if (
    t && p &&
    t.week_change_pct !== null && t.week_change_pct > 20 &&
    p.week_change_pct !== null && p.week_change_pct <= 0
  ) {
    funnelCase = true;
    parts.push(
      `Traffic is up ${t.week_change_pct}% week over week (${t.week_visitors} vs ${t.prev_week_visitors} visitors) but signups aren't following (${p.week_total} vs ${p.prev_week_total}) — the funnel, not the top, is the constraint.`
    );
  }
  if (!funnelCase && t && t.week_change_pct !== null && Math.abs(t.week_change_pct) >= 15) {
    const dir = t.week_change_pct > 0 ? "up" : "down";
    parts.push(
      `Traffic is ${dir} ${Math.abs(t.week_change_pct)}% week over week (${t.week_visitors} vs ${t.prev_week_visitors} visitors).${dir === "down" ? " Cause unknown from connected data." : ""}`
    );
  }

  // Attribute a real traffic day to its dominant source — "did my post work?"
  const top = t?.top_sources?.[0];
  if (t && top && t.visitors >= 10 && top.visitors / t.visitors >= 0.4) {
    parts.push(`Most of yesterday's traffic came from ${top.source} (${top.visitors} of ${t.visitors} visitors).`);
  }

  // Revenue: first money, and meaningful weekly moves
  const r = facts.revenue;
  if (r) {
    if (r.gross_revenue > 0 && r.prev_day_revenue === 0 && r.prev_week_revenue === 0 && r.week_revenue === r.gross_revenue) {
      parts.push(`You made money yesterday — ${money(r.gross_revenue, r.currency)} from ${r.charges} charge${r.charges === 1 ? "" : "s"}, the first this week.`);
    } else if (r.week_change_pct !== null && Math.abs(r.week_change_pct) >= 15) {
      const dir = r.week_change_pct > 0 ? "up" : "down";
      parts.push(
        `Revenue is ${dir} ${Math.abs(r.week_change_pct)}% week over week (${money(r.week_revenue, r.currency)} vs ${money(r.prev_week_revenue, r.currency)}).${dir === "down" ? " Cause unknown from connected data." : ""}`
      );
    }
  }

  if (p && !funnelCase) {
    if (p.week_change_pct !== null && p.prev_week_total > 0) {
      const pct = Math.abs(p.week_change_pct);
      if (p.week_change_pct > 5) {
        parts.push(`Signups are up ${pct}% week over week (${p.week_total} vs ${p.prev_week_total}).`);
      } else if (p.week_change_pct < -5) {
        parts.push(`Signups are down ${pct}% week over week (${p.week_total} vs ${p.prev_week_total}). Cause unknown from connected data.`);
      } else {
        parts.push(`Signups are steady week over week (${p.week_total} this week).`);
      }
    } else if (p.new_signups > 0) {
      parts.push(`${p.new_signups} people signed up yesterday — total is now ${p.total_signups}.`);
    }
  }

  if (g) {
    if (g.days_since_last_ship !== null && g.days_since_last_ship >= 3) {
      parts.push(`No code has shipped in ${g.days_since_last_ship} days.`);
    } else if (g.prs_merged > 0) {
      parts.push(`${g.prs_merged} PR${g.prs_merged === 1 ? "" : "s"} merged yesterday.`);
    }
  }

  if (!parts.length) {
    if (t && t.visitors > 0) {
      parts.push(
        `${t.visitors} ${t.visitors === 1 ? "person" : "people"} visited yesterday — steady, no sharp moves in the data.`
      );
    } else {
      parts.push("A quiet day — nothing shipped and no signup movement. That's data too.");
    }
  }
  return parts.join(" ");
}

// ── Priorities: ranked, never padded ──────────────────────────────────

/** What a priority is *about* — used to match it against the founder's goal. */
type PriorityKind = "growth" | "shipping" | "none";

type Candidate = { text: string; score: number; kind: PriorityKind };

/**
 * Below this, a candidate isn't worth one of a founder's three morning slots.
 * Set just under the weakest real signal (a fresh open PR, 30) so that generic
 * advice never rides along beside something concrete.
 */
const PRIORITY_FLOOR = 25;

/** How much a goal match moves a priority up the list. */
const GOAL_BONUS = 15;

/**
 * Goal text → the kinds of priority that goal favours. Deliberately coarse:
 * it reorders candidates the facts already justify, and can never introduce one.
 */
const GOAL_THEMES: { pattern: RegExp; kinds: PriorityKind[] }[] = [
  { pattern: /user|signup|sign-up|customer|subscriber|audience|waitlist|growth|grow|traffic|launch/i, kinds: ["growth"] },
  { pattern: /ship|build|release|mvp|beta|rebuild|rewrite|migrat/i, kinds: ["shipping"] },
  { pattern: /revenue|paying|money|mrr|monet|sales|charge|pricing/i, kinds: ["growth"] },
];

/**
 * The only place the founder's goal reaches the *deterministic* path. Without
 * it the goal tints the LLM's prose and does nothing whatsoever when the model
 * is unavailable — which is exactly when the baseline is what ships.
 */
function goalBonus(kind: PriorityKind, goal?: string): number {
  if (!goal || kind === "none") return 0;
  const favoured = GOAL_THEMES.filter((t) => t.pattern.test(goal)).flatMap((t) => t.kinds);
  return favoured.includes(kind) ? GOAL_BONUS : 0;
}

/**
 * Baseline priorities: derived from open work and gaps, never invented, and
 * ranked so that position 1 is the one that actually matters.
 *
 * Returns 1–3, and deliberately does NOT pad to three. A padded list ends in
 * generic advice, and a founder who reads "pick the one thing that would make
 * today a win" at 7am has learned that the brief had nothing to say. One true
 * instruction beats three where two are filler.
 */
export function baselinePriorities(facts: Facts): string[] {
  const out: Candidate[] = [];
  const g = facts.github;
  const p = facts.product;
  const t = facts.traffic;
  const r = facts.revenue;

  const add = (text: string, score: number, kind: PriorityKind) =>
    out.push({ text, score: score + goalBonus(kind, facts.founder_goal), kind });

  // The decision-grade pattern: the top of the funnel is fine, the funnel isn't.
  if (
    t && p &&
    t.week_change_pct !== null && t.week_change_pct > 20 &&
    p.week_change_pct !== null && p.week_change_pct <= 0
  ) {
    add("Walk through your signup flow as a new visitor — traffic is arriving but not converting.", 100, "growth");
  }

  if (p && p.new_signups === 0 && p.prev_day === 0) {
    add("Do one distribution task today — signups have stalled.", 85, "growth");
  }

  // First money is the rarest signal a brief can carry, and the one most worth
  // acting on the same day — the cause is still fresh enough to identify and
  // repeat. Scored above a signup stall, below a broken funnel: a funnel that
  // leaks is still the bigger problem, because it caps everything that follows.
  // Mirrors the matching case in baselineInsight.
  if (r && r.gross_revenue > 0 && r.prev_day_revenue === 0 && r.prev_week_revenue === 0 && r.week_revenue === r.gross_revenue) {
    add("Find out what caused your first revenue this week, and do it again.", 90, "growth");
  }

  if (g && g.days_since_last_ship !== null && g.days_since_last_ship >= 3) {
    add("Ship something small today to break the drought.", 80, "shipping");
  }

  // A channel visibly worked yesterday → repeat it while it's warm.
  const top = t?.top_sources?.[0];
  if (
    t && top &&
    t.visitors >= 10 &&
    top.visitors / t.visitors >= 0.4 &&
    t.visitors > t.prev_day_visitors * 1.3 &&
    !/direct/i.test(top.source)
  ) {
    add(`Post again where yesterday's spike came from — ${top.source} drove ${top.visitors} visitors.`, 70, "growth");
  }

  // Ranked one notch above talking to a free signup: someone who paid has
  // already answered the question a signup only hints at, so when both are
  // available the payer is the better conversation.
  if (r && r.new_customers > 0) {
    add(
      r.new_customers === 1
        ? "Talk to yesterday's new paying customer — ask what tipped them over."
        : `Talk to one of yesterday's ${r.new_customers} new paying customers — ask what tipped them over.`,
      65,
      "growth"
    );
  }

  if (p && p.new_signups > 0) {
    add(`Talk to one of yesterday's ${p.new_signups} new signups — ask what brought them.`, 60, "growth");
  }

  if (g?.open_prs.length) {
    const oldest = g.open_prs[0];
    // An old PR is a blocked teammate or a forgotten branch; a fresh one is
    // just normal work in progress, and rarely the most important thing today.
    if (oldest.age_days >= 2) {
      add(`Review or close PR #${oldest.number} — "${trunc(oldest.title)}" has been open ${oldest.age_days} days.`, 55, "shipping");
    } else {
      add(`Review open PR #${oldest.number} — "${trunc(oldest.title)}".`, 30, "shipping");
    }
  }

  // Scored below the floor on purpose: it survives only when it is the sole
  // candidate, and then it stands alone rather than padding a real list.
  add("Pick the one thing that would make today a win, and start there.", 5, "none");

  const ranked = out.sort((a, b) => b.score - a.score);
  const kept = ranked.filter((c) => c.score >= PRIORITY_FLOOR).slice(0, 3);
  return (kept.length ? kept : ranked.slice(0, 1)).map((c) => c.text);
}

function trunc(s: string, n = 50): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

/** All numbers that legitimately exist in the facts — the LLM allowlist. */
export function allowedNumbers(facts: Facts): Set<string> {
  const set = new Set<string>();
  const walk = (v: any) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      set.add(String(Math.abs(Math.round(v))));
      set.add(String(Math.abs(v)));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else if (typeof v === "string") {
      // numbers embedded in PR titles etc. are quotable
      (v.match(/\d+/g) ?? []).forEach((n) => set.add(String(parseInt(n, 10))));
    }
  };
  walk(facts);
  // derived values the model may reasonably state
  const p = facts.product;
  if (p) {
    set.add(String(Math.abs(p.new_signups - p.prev_day)));
    set.add(String(Math.abs(p.week_total - p.prev_week_total)));
    if (p.week_change_pct !== null) set.add(String(Math.abs(p.week_change_pct)));
  }
  const t = facts.traffic;
  if (t) {
    set.add(String(Math.abs(t.visitors - t.prev_day_visitors)));
    set.add(String(Math.abs(t.week_visitors - t.prev_week_visitors)));
    if (t.week_change_pct !== null) set.add(String(Math.abs(t.week_change_pct)));
  }
  const r = facts.revenue;
  if (r) {
    for (const v of [
      Math.abs(round2(r.gross_revenue - r.prev_day_revenue)),
      Math.abs(round2(r.week_revenue - r.prev_week_revenue)),
      r.week_change_pct !== null ? Math.abs(r.week_change_pct) : null,
    ]) {
      if (v !== null) {
        set.add(String(v));
        set.add(String(Math.round(v)));
      }
    }
  }
  // small counts (dates, "3 days", ordinals) that appear naturally
  for (let i = 0; i <= 31; i++) set.add(String(i));
  return set;
}

/** True if every digit-sequence in `text` is in the allowlist. */
export function numbersAreGrounded(text: string, allowed: Set<string>): boolean {
  const tokens = text.match(/\d[\d,]*\.?\d*/g) ?? [];
  return tokens.every((t) => {
    const clean = t.replace(/,/g, "").replace(/\.$/, "");
    return allowed.has(clean) || allowed.has(String(parseFloat(clean)));
  });
}
