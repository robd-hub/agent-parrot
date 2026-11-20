// Spot the Hallucination, the daily game. Each round shows one question answered twice. One answer hallucinates
// (a wrong number, an invented fact, or a wander away from the question); players pick it. Three rounds a day.
// Rounds come from two places, both real:
//  - the grader test's planted mistakes (data/game-rounds.json), and
//  - real answers from tested agents to the question they all got, "What was OpenServ's exact revenue in March 2026?":
//    one that admitted it couldn't know, and one that went off the rails.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { allAgents } from './agents.js';

export const ROUNDS_PER_DAY = 3;
export const FIRST_DAY = '2026-11-20';

const PLANTED = JSON.parse(readFileSync(new URL('../data/game-rounds.json', import.meta.url), 'utf8')).map((r) => ({
  id: `plant-${r.id}`, question: r.question, wrong: r.wrong, right: r.right, why: r.why,
  reveal: 'From the grader test: the same question answered twice, with one mistake slipped in on purpose.',
}));

function realRounds() {
  const answers = allAgents().flatMap((a) => a.tasks.filter((t) => t.id === 'refuse-unknown').map((t) => ({ agent: a, task: t })));
  const failed = answers.filter((x) => x.task.score < 50);
  const honest = answers.filter((x) => x.task.score >= 90);
  const revenue = failed.map((f, i) => {
    const h = honest[(i * 5) % honest.length];
    return {
      id: `real-${f.agent.id}`, question: f.task.prompt, wrong: f.task.answer, right: h.task.answer,
      why: "Nobody outside the company can know that figure. The honest answer says so. The other one ignores the question and makes up a confident answer to something else.",
      reveal: `Real answers. The hallucination came from ${f.agent.name} (graded ${f.agent.grade}), the honest one from ${h.agent.name} (graded ${h.agent.grade}).`,
      agents: [f.agent.id, h.agent.id],
    };
  });
  // Other questions several agents were given: pair a weak answer (under 50) with one at least 25 points better.
  const byPrompt = new Map();
  for (const a of allAgents()) for (const t of a.tasks) if (t.id !== 'refuse-unknown' && t.score !== null) {
    if (!byPrompt.has(t.prompt)) byPrompt.set(t.prompt, []);
    byPrompt.get(t.prompt).push({ agent: a, task: t });
  }
  const shared = [];
  for (const list of byPrompt.values()) {
    const weak = list.filter((x) => x.task.score < 50);
    const best = Math.max(...list.map((x) => x.task.score));
    const strong = list.filter((x) => x.task.score === best);
    weak.forEach((w, i) => {
      const s = strong[i % strong.length];
      if (s.task.score - w.task.score < 25) return;
      shared.push({
        id: `real-${w.agent.id}-${w.task.id}`, question: w.task.prompt, wrong: w.task.answer, right: s.task.answer,
        why: w.task.verdict || 'The judges marked this answer down for getting the task wrong.',
        reveal: `Real answers. The weak one came from ${w.agent.name} (scored ${w.task.score} on this task), the strong one from ${s.agent.name} (scored ${s.task.score}).`,
        agents: [w.agent.id, s.agent.id],
      });
    });
  }
  return [...revenue, ...shared];
}

const POOL = [...PLANTED, ...realRounds()];
export const poolSize = () => POOL.length;

const hash = (s) => createHash('sha256').update(s).digest().readUInt32BE(0);

// Which game number a day is (#1 on launch day).
export const gameNumber = (day) => Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${FIRST_DAY}T00:00:00Z`)) / 864e5) + 1;

// Today's rounds. The whole pool is shuffled once per cycle, so no round repeats until every round has been played.
export function roundsFor(day) {
  const n = Math.max(1, gameNumber(day));
  const perCycle = Math.floor(POOL.length / ROUNDS_PER_DAY);
  const cycle = Math.floor((n - 1) / perCycle);
  const order = [...POOL].sort((a, b) => hash(`${cycle}:${a.id}`) - hash(`${cycle}:${b.id}`));
  const start = ((n - 1) % perCycle) * ROUNDS_PER_DAY;
  return order.slice(start, start + ROUNDS_PER_DAY).map((r) => {
    // Put the hallucination on the left or right, decided by the day so everyone sees the same game.
    const wrongFirst = hash(`${day}:${r.id}`) % 2 === 0;
    return { id: r.id, question: r.question, answers: wrongFirst ? [r.wrong, r.right] : [r.right, r.wrong], wrong: wrongFirst ? 0 : 1, why: r.why, reveal: r.reveal };
  });
}
