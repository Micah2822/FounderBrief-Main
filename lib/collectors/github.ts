import type { GitHubDayData } from "@/lib/types";

const GH = "https://api.github.com";

async function gh(token: string, path: string, params?: Record<string, string>) {
  const url = new URL(GH + path);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.json();
}

type PullRequest = {
  number: number;
  title: string;
  created_at: string;
  merged_at: string | null;
};

/**
 * Pull requests for one repo, read per-repo rather than through /search/issues.
 *
 * Search would handle all the repos in one call, but its behaviour for private
 * repositories under a GitHub App installation token is not something we can
 * rely on — and the failure mode is silent (zero results, not an error), which
 * would quietly empty the shipping half of the brief. Per-repo listing is
 * unambiguous. Repos are capped at 5, so this costs a handful of extra calls
 * against a 5,000/hour per-installation budget.
 */
async function listPulls(token: string, repo: string, state: "closed" | "open") {
  try {
    const pulls = await gh(token, `/repos/${repo}/pulls`, {
      state,
      sort: state === "closed" ? "updated" : "created",
      direction: state === "closed" ? "desc" : "asc",
      per_page: "100",
    });
    return Array.isArray(pulls) ? (pulls as PullRequest[]) : [];
  } catch {
    // A repo can disappear from the installation between the picker and here.
    return [];
  }
}

/** Collect facts for one local day across the selected repos. */
export async function collectGitHub(
  token: string,
  repos: string[], // ["owner/name", ...]
  range: { from: Date; to: Date },
  _dateStr: string // kept for signature stability; windowing is done on merged_at
): Promise<GitHubDayData> {
  const closed = await Promise.all(repos.map((r) => listPulls(token, r, "closed")));
  const mergedInWindow = closed
    .flat()
    .filter((p) => {
      if (!p.merged_at) return false;
      const t = new Date(p.merged_at).getTime();
      return t >= range.from.getTime() && t < range.to.getTime();
    })
    .sort((a, b) => (a.merged_at! < b.merged_at! ? 1 : -1));

  const openPerRepo = await Promise.all(repos.map((r) => listPulls(token, r, "open")));
  const openPrs = repos.flatMap((repo, i) =>
    openPerRepo[i].map((p) => ({ ...p, repo }))
  );
  openPrs.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  // Commits + deployments per repo within the local-day window
  let commits = 0;
  let deployments = 0;
  for (const repo of repos) {
    try {
      const c = await gh(token, `/repos/${repo}/commits`, {
        since: range.from.toISOString(),
        until: range.to.toISOString(),
        per_page: "100",
      });
      commits += Array.isArray(c) ? c.length : 0;
    } catch {
      // empty repos 409 — count as zero
    }
    try {
      const d = await gh(token, `/repos/${repo}/deployments`, { per_page: "50" });
      if (Array.isArray(d)) {
        deployments += d.filter((dep: any) => {
          const t = new Date(dep.created_at).getTime();
          return t >= range.from.getTime() && t < range.to.getTime();
        }).length;
      }
    } catch {
      /* deployments API unused by many setups */
    }
  }

  const now = Date.now();
  return {
    prs_merged: mergedInWindow.length,
    // Titles are third-party-writable text (anyone can open a PR) — cap them
    // to shrink the prompt-injection surface before they reach the LLM.
    merged_titles: mergedInWindow.slice(0, 5).map((p) => String(p.title).slice(0, 140)),
    commits,
    deployments,
    open_prs: openPrs.slice(0, 10).map((p) => ({
      number: p.number,
      title: String(p.title).slice(0, 140),
      repo: p.repo,
      age_days: Math.floor((now - new Date(p.created_at).getTime()) / 86400000),
    })),
    repos,
  };
}

/**
 * Commits across the tracked repos in one window.
 *
 * The comparison day only ever needs this number, so calling collectGitHub for
 * it would fetch — and discard — every pull request twice over.
 */
export async function countCommits(
  token: string,
  repos: string[],
  range: { from: Date; to: Date }
): Promise<number> {
  const counts = await Promise.all(
    repos.map(async (repo) => {
      try {
        const c = await gh(token, `/repos/${repo}/commits`, {
          since: range.from.toISOString(),
          until: range.to.toISOString(),
          per_page: "100",
        });
        return Array.isArray(c) ? c.length : 0;
      } catch {
        return 0; // empty repos 409
      }
    })
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Days since the last merged PR, across the tracked repos. */
export async function daysSinceLastShip(
  token: string,
  repos: string[],
  today: string
): Promise<number | null> {
  const closed = await Promise.all(repos.map((r) => listPulls(token, r, "closed")));
  const lastMerged = closed
    .flat()
    .map((p) => p.merged_at)
    .filter((d): d is string => !!d)
    .sort()
    .reverse()[0];
  if (!lastMerged) return null;
  const last = new Date(`${lastMerged.slice(0, 10)}T12:00:00Z`);
  const ref = new Date(`${today}T12:00:00Z`);
  return Math.max(0, Math.round((ref.getTime() - last.getTime()) / 86400000));
}

/**
 * Repositories this installation can see — i.e. the ones the user ticked on
 * GitHub's install screen. `/user/repos` is a user endpoint and returns 403 for
 * an installation token, so it cannot be used here.
 */
export async function listRepos(token: string) {
  const res = await gh(token, "/installation/repositories", { per_page: "100" });
  const repos = (res.repositories ?? []) as any[];
  return repos
    .map((r) => ({
      full_name: r.full_name as string,
      private: r.private as boolean,
      pushed_at: r.pushed_at as string,
    }))
    .sort((a, b) => (a.pushed_at < b.pushed_at ? 1 : -1));
}
