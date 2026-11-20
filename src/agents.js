// The tested agents. Grades come from Agent Report Card and are copied into data/agents.json by
// scripts/sync-grades.mjs, so this site never re-scores anything. On the site the test is called the Polly Test.
import { readFileSync } from 'node:fs';

const DATA = JSON.parse(readFileSync(new URL('../data/agents.json', import.meta.url), 'utf8'));

export const SYNCED_AT = DATA.syncedAt;

export const CATEGORIES = [
  { id: 'research', name: 'Research' },
  { id: 'writing', name: 'Writing' },
  { id: 'crypto', name: 'Crypto and markets' },
  { id: 'code-data', name: 'Code and data' },
  { id: 'assistants', name: 'Assistants' },
];
export const categoryName = (id) => CATEGORIES.find((c) => c.id === id)?.name ?? 'Assistants';

// What each grade means, in Polly's words.
export const GRADE_MEANING = {
  A: 'Reliable on everything Polly tested. Fine to rely on for tasks like these.',
  B: 'Good on most tasks, with a weak spot or two. Check its answers on anything that matters.',
  C: 'Fine for simple tasks, but it slipped on several. Check its answers before you use them.',
  D: 'Often missed the task. Only use it with a person checking every answer.',
  F: 'Failed most of what Polly tested. Not safe to rely on as it stands.',
};

// A one-word verdict for listings: a cracker for a pass, a feather when Polly plucked it.
export const verdict = (grade) => (['A', 'B'].includes(grade) ? 'cracker' : grade === 'C' ? 'mixed' : 'feather');

// Links the grade data doesn't carry yet, for agents made by the Agent Report Card team. Grades still only come from the data.
export const MAKER_LINKS = { 'cheap-first': 'https://cheap-first.vercel.app/' };

const AGENTS = DATA.agents.map((a, i) => {
  const scored = a.tasks.filter((t) => t.score !== null);
  const worst = scored.reduce((w, t) => (!w || t.score < w.score ? t : w), null);
  const best = scored.reduce((b, t) => (!b || t.score > b.score ? t : b), null);
  return { ...a, url: a.url || MAKER_LINKS[a.id] || null, rank: i + 1, worst, best: best && best !== worst ? best : null };
});

export const allAgents = () => AGENTS;
export const agentById = (id) => AGENTS.find((a) => a.id === id) ?? null;

// The Pecking Order: every tested agent, best first, optionally in one category.
// Ties share a place, so two agents on 100 are both number 1.
export function peckingOrder(category) {
  const list = category ? AGENTS.filter((a) => a.category === category) : AGENTS;
  let place = 0;
  let last = null;
  return list.map((a, i) => {
    if (a.score !== last) place = i + 1;
    last = a.score;
    return { ...a, place };
  });
}

// Headline numbers for the homepage and the articles.
export function stats() {
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const a of AGENTS) grades[a.grade]++;
  const honestyFailed = AGENTS.filter((a) => a.honesty === 'failed');
  const byCategory = CATEGORIES.map((c) => {
    const list = AGENTS.filter((a) => a.category === c.id);
    return { ...c, count: list.length, average: list.length ? Math.round(list.reduce((n, a) => n + a.score, 0) / list.length) : null };
  });
  return { count: AGENTS.length, tasks: AGENTS.reduce((n, a) => n + a.tasks.length, 0), grades, honestyFailed, byCategory };
}
