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

const MAX_SUBJECTS = 10;
const MAX_SUBJECT_CHARS = 120;

/**
 * Commit subject lines, cleaned for use as LLM context.
 *
 * The messages are already in the `/commits` response we fetch for the count,
 * so this costs nothing extra — and without it the model receives `commits: 5`
 * and no idea what was shipped, which is why the brief could only ever say
 * "you shipped 5 commits".
 *
 * Everything here is defensive, because a commit message is text an attacker
 * can write:
 *  - first line only, so a crafted multi-line body cannot smuggle in an
 *    instruction block that reads like a new prompt;
 *  - whitespace collapsed and control characters dropped;
 *  - truncated, and capped in number, so no single message can dominate;
 *  - merge commits and near-empty messages dropped, because "Merge branch
 *    main" and "wip" are noise that crowds out the real ones. Commit hygiene
 *    varies, and a brief built from ten "fix" messages is worse than one built
 *    from a count.
 */
function commitSubjects(commits: any[]): string[] {
  const out: string[] = [];
  for (const c of commits) {
    const raw = String(c?.commit?.message ?? "");
    const subject = raw
      .split("\n")[0]
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!subject || subject.length < 4) continue;
    if (/^merge (pull request|branch|remote-tracking)/i.test(subject)) continue;
    const clipped = subject.slice(0, MAX_SUBJECT_CHARS);
    if (!out.includes(clipped)) out.push(clipped);
  }
  return out;
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
  const unreadable: string[] = [];
  const subjects: string[] = [];
  for (const repo of repos) {
    try {
      const c = await gh(token, `/repos/${repo}/commits`, {
        since: range.from.toISOString(),
        until: range.to.toISOString(),
        per_page: "100",
      });
      commits += Array.isArray(c) ? c.length : 0;
      if (Array.isArray(c)) subjects.push(...commitSubjects(c));
    } catch (e) {
      // A 409 is a genuinely empty repository and really is zero commits.
      // Anything else — a 403 from a missing Contents permission, a 404 from a
      // repo that left the installation — is a failure to read, and reporting
      // that as "0 commits" is the one thing this brief must never do.
      if (!/ → 409$/.test(String(e))) unreadable.push(repo);
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

  // Does this founder work through pull requests at all? Pushing straight to
  // main is normal for a solo founder, and for them "Pull requests merged: 0"
  // and "Open pull requests: 0" are not information — they are two permanent
  // zeroes at the top of the ledger, crowding out the rows that do move.
  const usesPrs =
    openPrs.length > 0 ||
    closed
      .flat()
      .some((p) => p.merged_at && now - new Date(p.merged_at).getTime() <= 30 * 86400000);

  return {
    uses_prs: usesPrs,
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
    ...(subjects.length ? { commit_subjects: subjects.slice(0, MAX_SUBJECTS) } : {}),
    ...(unreadable.length ? { unreadable_repos: unreadable } : {}),
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

/**
 * Days since anything last shipped, across the tracked repos.
 *
 * "Shipped" is the most recent of a **deployment**, a **merged PR**, or a
 * **commit on the default branch** — in that order of meaning, but whichever is
 * latest wins. Counting merged PRs alone returns `null` forever for anyone who
 * pushes straight to main, which silently disables every downstream use of this
 * number: the "nothing has shipped in N days" gap, the matching insight, and
 * the priority that tells the founder to break the drought. A solo founder
 * pushing to main is the common case, not the exception.
 */
export async function daysSinceLastShip(
  token: string,
  repos: string[],
  today: string
): Promise<number | null> {
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const [closed, deployments, commits] = await Promise.all([
        listPulls(token, repo, "closed"),
        gh(token, `/repos/${repo}/deployments`, { per_page: "1" }).catch(() => []),
        gh(token, `/repos/${repo}/commits`, { per_page: "1" }).catch(() => []),
      ]);
      const dates: string[] = closed.map((p) => p.merged_at).filter((d): d is string => !!d);
      const deploy = Array.isArray(deployments) ? deployments[0]?.created_at : null;
      if (deploy) dates.push(deploy);
      // committer.date is when it landed on the branch, which is the shipping
      // moment; author.date can be far older on a rebase or a cherry-pick.
      const commit = Array.isArray(commits) ? commits[0]?.commit?.committer?.date : null;
      if (commit) dates.push(commit);
      return dates;
    })
  );

  const latest = perRepo.flat().sort().reverse()[0];
  if (!latest) return null;
  const last = new Date(`${latest.slice(0, 10)}T12:00:00Z`);
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
