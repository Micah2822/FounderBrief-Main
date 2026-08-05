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

/** Collect facts for one local day across the selected repos. */
export async function collectGitHub(
  token: string,
  repos: string[], // ["owner/name", ...]
  range: { from: Date; to: Date },
  dateStr: string // YYYY-MM-DD, for the search API's merged: qualifier
): Promise<GitHubDayData> {
  const repoQ = repos.map((r) => `repo:${r}`).join(" ");

  // Merged PRs on the day (search API handles cross-repo cleanly)
  const merged = await gh(token, "/search/issues", {
    q: `is:pr ${repoQ} merged:${dateStr}..${dateStr}`,
    per_page: "50",
  });

  // Open PRs right now
  const open = await gh(token, "/search/issues", {
    q: `is:pr is:open ${repoQ}`,
    per_page: "20",
    sort: "created",
    order: "asc",
  });

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
    prs_merged: merged.total_count ?? 0,
    // Titles are third-party-writable text (anyone can open a PR) — cap them
    // to shrink the prompt-injection surface before they reach the LLM.
    merged_titles: (merged.items ?? []).slice(0, 5).map((i: any) => String(i.title).slice(0, 140)),
    commits,
    deployments,
    open_prs: (open.items ?? []).slice(0, 10).map((i: any) => ({
      number: i.number,
      title: String(i.title).slice(0, 140),
      repo: i.repository_url?.split("/repos/")[1] ?? "",
      age_days: Math.floor((now - new Date(i.created_at).getTime()) / 86400000),
    })),
    repos,
  };
}

/** Days since the last merged PR or deployment (looking back up to 30 days). */
export async function daysSinceLastShip(
  token: string,
  repos: string[],
  today: string
): Promise<number | null> {
  const repoQ = repos.map((r) => `repo:${r}`).join(" ");
  const res = await gh(token, "/search/issues", {
    q: `is:pr ${repoQ} is:merged`,
    sort: "updated",
    order: "desc",
    per_page: "10",
  });
  const dates = (res.items ?? [])
    .map((i: any) => i.pull_request?.merged_at || i.closed_at)
    .filter(Boolean)
    .map((d: string) => d.slice(0, 10))
    .sort()
    .reverse();
  if (!dates.length) return null;
  const last = new Date(`${dates[0]}T12:00:00Z`);
  const ref = new Date(`${today}T12:00:00Z`);
  return Math.max(0, Math.round((ref.getTime() - last.getTime()) / 86400000));
}

export async function listRepos(token: string) {
  const repos = await gh(token, "/user/repos", {
    sort: "pushed",
    per_page: "100",
    affiliation: "owner,collaborator,organization_member",
  });
  return (repos as any[]).map((r) => ({
    full_name: r.full_name as string,
    private: r.private as boolean,
    pushed_at: r.pushed_at as string,
  }));
}
