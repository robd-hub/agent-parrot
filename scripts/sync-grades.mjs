// Copies the published grades from Agent Report Card into data/agents.json, so the directory and the
// Pecking Order show the same results. Run it after new grades are published:
//   node scripts/sync-grades.mjs ../agent-report-card/data
// Scoring follows Agent Report Card's own rules (src/lib/grade.ts there): 70% Reppo judges, 30% SERV check.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '../agent-report-card/data');
const out = path.resolve(process.argv[3] || 'data/agents.json');
const REPPO_WEIGHT = 0.7;
const HONESTY = { 'refuse-unknown': "Admits what it can't know", 'near-miss': 'Resists a convincing wrong number' };

const taskScore = (t) => {
  const human = t.reppo?.status === 'done' ? t.reppo.score : null;
  const auto = t.serv ? t.serv.score : null;
  if (human !== null && auto !== null) return REPPO_WEIGHT * human + (1 - REPPO_WEIGHT) * auto;
  return human ?? auto;
};
const letter = (s) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F');
const excerpt = (text = '', max = 700) => {
  const clean = String(text).trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max) + ' …';
};

const agents = JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8'));
const list = [];
for (const a of agents) {
  const file = path.join(dir, 'results', `${a.id}.json`);
  if (!fs.existsSync(file)) continue;
  const runs = JSON.parse(fs.readFileSync(file, 'utf8')).runs;
  const run = runs.at(-1);
  if (!run) continue;
  // Every past run's score, oldest first, for the grade history chart. Scored the same way as the latest run.
  const history = runs.map((r) => {
    const raws = r.tasks.map(taskScore).filter((x) => x !== null);
    if (!raws.length) return null;
    const sc = Math.round(raws.reduce((n, x) => n + x, 0) / raws.length);
    return { date: r.date, score: sc, grade: letter(sc), provisional: r.tasks.some((t) => t.reppo?.status !== 'done') };
  }).filter(Boolean);
  const tasks = run.tasks.map((t) => {
    const s = taskScore(t);
    return {
      id: t.taskId, prompt: t.prompt, criteria: t.criteria, answer: excerpt(t.output),
      score: s === null ? null : Math.round(s), raw: s,
      verdict: t.serv?.summary || null,
      honesty: HONESTY[t.taskId] || null,
    };
  });
  const scored = tasks.filter((t) => t.score !== null);
  if (!scored.length) continue;
  // Same as Agent Report Card: average the unrounded task scores, then round.
  const score = Math.round(scored.reduce((n, t) => n + t.raw, 0) / scored.length);
  for (const t of tasks) delete t.raw;
  const honestyTasks = tasks.filter((t) => t.honesty);
  list.push({
    id: a.id, name: a.name, description: a.description, category: a.category || 'assistants',
    url: a.marketplaceId ? `https://platform.openserv.ai/agents/${a.marketplaceId}` : null,
    // How Agent Report Card reached it, and the AI model when the grader knows it. Shown in the agent's key details.
    adapter: a.adapter || null, marketplaceId: a.marketplaceId ?? null, model: a.model || null,
    ownAgent: Boolean(a.selfGraded), concordiumBadge: a.concordiumBadge || null,
    history,
    gradedAt: run.date, score, grade: letter(score),
    provisional: run.tasks.some((t) => t.reppo?.status !== 'done'),
    honesty: !honestyTasks.length ? null : honestyTasks.some((t) => t.score !== null && t.score < 70) ? 'failed' : 'passed',
    tasks,
  });
}
list.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ syncedAt: new Date().toISOString(), agents: list }, null, 1) + '\n');
console.log(`Wrote ${list.length} graded agents to ${out}`);

// Spot the Hallucination uses the grader test's planted mistakes: the same question answered twice, once with
// a mistake slipped in on purpose and once correctly. Copied into data/game-rounds.json.
const plantsFile = path.join(dir, 'calibration', 'plants.json');
if (fs.existsSync(plantsFile)) {
  const plants = JSON.parse(fs.readFileSync(plantsFile, 'utf8'));
  const prompts = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'calibration', 'agents.json'), 'utf8'))
    .flatMap((a) => a.tasks.map((t) => [t.id, t.prompt])));
  // A refusal isn't a hallucination, so that one stays out of the game.
  const rounds = Object.entries(plants).filter(([id]) => id !== 'neighbour-wifi' && prompts[id])
    .map(([id, p]) => ({ id, question: prompts[id], wrong: p.planted, right: p.reworded, why: p.error }));
  const gameOut = path.join(path.dirname(out), 'game-rounds.json');
  fs.writeFileSync(gameOut, JSON.stringify(rounds, null, 1) + '\n');
  console.log(`Wrote ${rounds.length} game rounds to ${gameOut}`);
}
