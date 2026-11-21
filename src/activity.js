// Code activity for listed agents with a public GitHub repository: when the code last changed, stars, open issues and
// whether it has been archived. Read from GitHub's public API, at most once a week per repo, after each health run.
// Without a token GitHub allows about 60 lookups an hour from one address (shared on Vercel), so only a few are done
// per run. An optional GITHUB_TOKEN (a fine-grained token with no extra permissions, set in Vercel by Rob) raises that
// to 5,000 an hour.

const API = 'https://api.github.com/repos/';

export function githubRepo(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(String(url ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function fetchRepo(repo, { fetchFn = fetch, token } = {}) {
  const res = await fetchFn(API + repo, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'AgentParrot/1.0', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(10000), redirect: 'follow',
  });
  const left = Number(res.headers?.get?.('x-ratelimit-remaining'));
  if (res.status === 403 || res.status === 429) return { limited: true };
  if (res.status === 404 || res.status === 451) return { activity: { found: false }, left };
  if (!res.ok) return { error: `GitHub answered ${res.status}`, left };
  const r = await res.json();
  return {
    left,
    activity: {
      found: true, pushedAt: r.pushed_at ?? null, createdAt: r.created_at ?? null, stars: Number(r.stargazers_count) || 0,
      // GitHub counts open pull requests as issues too.
      openIssues: Number(r.open_issues_count) || 0, forks: Number(r.forks_count) || 0, archived: Boolean(r.archived),
      language: typeof r.language === 'string' ? r.language.slice(0, 40) : null, license: typeof r.license?.spdx_id === 'string' ? r.license.spdx_id.slice(0, 40) : null,
    },
  };
}

// One activity run: the repos looked at longest ago first, until the budget, the limit or GitHub's allowance runs out.
export async function checkActivity({ db, fetchFn = fetch, token, budgetMs = 40000, limit } = {}) {
  const started = Date.now();
  const due = await db.listed.dueForActivity(limit ?? (token ? 400 : 25));
  const results = [];
  let stopped = null;
  for (const row of due) {
    if (Date.now() - started > budgetMs) break;
    const repo = githubRepo(row.details?.repo);
    if (!repo) continue;
    let r;
    try {
      r = await fetchRepo(repo, { fetchFn, token });
    } catch {
      r = { error: 'Could not reach GitHub' };
    }
    if (r.limited) {
      stopped = 'GitHub rate limit reached; carries on next run';
      break;
    }
    if (r.activity) results.push({ source: row.source, source_id: row.source_id, activity: r.activity });
    if (Number.isFinite(r.left) && r.left < 3) {
      stopped = 'GitHub rate limit nearly used; carries on next run';
      break;
    }
  }
  await db.listed.saveActivity(results);
  return { checked: results.length, ...(stopped ? { stopped } : {}) };
}
