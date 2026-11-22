// Full findings report: a paid Polly Test's results laid out for the agent's maker. Every task that lost points,
// worst first, with what the task asked for, the judges' note, the answer and how much fixing it could add to the
// Squawk Score. Only the member who claimed the agent (and Rob, at /admin/findings/<id>) can open it.
// Reads only the synced grade data: nothing here changes a grade, the Pecking Order or the reputation score.
import express from 'express';
import { agentById } from './agents.js';
import { esc, layout, dateLabel, gradeBadge, pageNotFound } from './views.js';

// passed: full or nearly full marks. partial: passed but lost points. failed: under the pass mark of 70.
export const levelFor = (score) => (score === null || score === undefined ? 'pending' : score >= 90 ? 'passed' : score >= 70 ? 'partial' : 'failed');
const LEVEL_NAME = { failed: 'Failed', partial: 'Lost points', passed: 'Passed', pending: 'Still being scored' };

export function findingsFor(agent) {
  const n = agent.tasks.length || 1;
  const items = agent.tasks.map((t) => {
    const level = levelFor(t.score);
    // The Squawk Score is the average of the task scores, so full marks on this task adds (100 - score) / tasks.
    const gain = t.score === null ? 0 : Math.round(((100 - t.score) / n) * 10) / 10;
    return { ...t, level, gain };
  });
  const order = { failed: 0, partial: 1, pending: 2, passed: 3 };
  items.sort((a, b) => order[a.level] - order[b.level] || (a.score ?? 101) - (b.score ?? 101));
  const counts = { failed: 0, partial: 0, passed: 0, pending: 0 };
  for (const i of items) counts[i.level] += 1;
  const toFix = items.filter((i) => i.level === 'failed' || i.level === 'partial');
  const best = Math.min(100, Math.round(agent.score + toFix.reduce((s, i) => s + i.gain, 0)));
  return { items, counts, toFix, best };
}

function itemHtml(t) {
  const lost = t.score !== null && t.score < 100;
  return `<article class="task finding finding-${esc(t.level)}">
      <div class="task-head"><span class="task-score score-${t.score === null ? 'none' : t.score >= 70 ? 'ok' : 'bad'}">${t.score === null ? '…' : Number(t.score)}</span>
        <div><p class="eyebrow">${esc(LEVEL_NAME[t.level])}${t.honesty ? ` · Honesty check: ${esc(t.honesty)}` : ''}</p><h3>${esc(t.prompt)}</h3></div></div>
      ${t.criteria ? `<p><b>What full marks needed:</b> ${esc(t.criteria)}</p>` : ''}
      ${t.verdict ? `<p class="judge"><b>Judges' note:</b> ${esc(t.verdict)}</p>` : ''}
      ${lost && t.gain > 0 ? `<p class="muted small">Full marks here would add up to ${esc(t.gain)} ${t.gain === 1 ? 'point' : 'points'} to the Squawk Score.</p>` : ''}
      <details><summary>Read the agent's answer</summary><pre class="answer">${esc(t.answer)}</pre></details>
    </article>`;
}

export function findingsPage({ agent, report }) {
  const { items, counts, toFix, best } = report;
  const passed = items.filter((i) => i.level === 'passed');
  const pending = items.filter((i) => i.level === 'pending');
  const lead = toFix.length
    ? `${toFix.length} of ${items.length} tasks lost points. Fixing them could take the Squawk Score from ${Number(agent.score)} to as much as ${Number(best)}.`
    : `Every scored task got 90 or more. Nothing to fix from this test.`;
  return layout(`Findings report: ${agent.name}`, `
    <section class="page-head">
      <p class="eyebrow">Findings report · for the maker · Polly Tested ${esc(dateLabel(agent.gradedAt))}</p>
      <h1>${esc(agent.name)} ${gradeBadge(agent.grade, { size: 'sm' })}</h1>
      <p class="lead">${esc(lead)}</p>
      <div class="facts">
        <span><b>${Number(agent.score)}</b> Squawk Score</span>
        <span><b class="bad">${counts.failed}</b> failed</span>
        ${counts.partial ? `<span><b>${counts.partial}</b> lost points</span>` : ''}
        <span><b class="ok">${counts.passed}</b> passed</span>
        ${counts.pending ? `<span class="muted">${counts.pending} still being scored</span>` : ''}
      </div>
      <p class="muted small">Only you can see this page. The tasks and judges' notes come straight from your Polly Test; the agent's public page shows the same scores.</p>
    </section>
    ${toFix.length ? `<section class="section"><h2>What to fix, worst first</h2>${toFix.map(itemHtml).join('')}</section>` : ''}
    ${pending.length ? `<section class="section"><h2>Still being scored</h2>${pending.map(itemHtml).join('')}</section>` : ''}
    ${passed.length ? `<section class="section"><h2>Passed</h2><details><summary>Show the ${passed.length} ${passed.length === 1 ? 'task' : 'tasks'} it passed</summary>${passed.map(itemHtml).join('')}</details></section>` : ''}
    <section class="card cta-card">
      <img src="/parrot.svg" width="56" height="56" alt="">
      <div><h2>Fixed something?</h2>
        <p>A retest is $5. It runs the same tasks again and updates the grade, the Pecking Order and the grade history.</p>
        <a class="btn" href="/request?ref=${encodeURIComponent(agent.id)}">Request a retest</a>
        <a class="btn ghost" href="/agents/${encodeURIComponent(agent.id)}">Back to the agent page</a></div>
    </section>`, { description: `Findings report for ${agent.name}'s Polly Test.` });
}

function onlyMakerPage({ agent, claimed }) {
  return layout(`Findings report: ${agent.name}`, `
    <section class="page-head">
      <p class="eyebrow">Findings report</p>
      <h1>This report is for ${esc(agent.name)}'s maker</h1>
      <p class="lead">${claimed
        ? 'Only the member who claimed this agent can open it. Sign in with that account to see it.'
        : 'Built this agent? Claim it first, then the full findings report from its Polly Test is yours to read.'}</p>
      <p>${claimed ? '' : `<a class="btn" href="/claim?ref=${encodeURIComponent(agent.id)}">Claim it</a> `}<a class="btn ghost" href="/agents/${encodeURIComponent(agent.id)}">Back to the agent page</a></p>
    </section>`, { description: `Findings report for ${agent.name}.` });
}

export function findingsRoutes({ db, adminOnly }) {
  const app = express.Router();
  const show = (res, agent) => res.set('Cache-Control', 'private, no-store').send(findingsPage({ agent, report: findingsFor(agent) }));

  app.get('/agents/:id/findings', async (req, res) => {
    const agent = agentById(req.params.id);
    if (!agent) return res.status(404).send(pageNotFound());
    const claim = await db.claims.get(agent.id);
    if (claim && req.session.uid && String(claim.member_id) === String(req.session.uid)) return show(res, agent);
    res.set('Cache-Control', 'private, no-store').status(403).send(onlyMakerPage({ agent, claimed: Boolean(claim) }));
  });

  app.get('/admin/findings/:id', adminOnly, (req, res) => {
    const agent = agentById(req.params.id);
    if (!agent) return res.status(404).send(pageNotFound());
    show(res, agent);
  });

  return app;
}
