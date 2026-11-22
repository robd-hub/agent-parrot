// The weekly top-movers digest: who climbed, who dropped, who was tested for the first time, which listed agents went
// quiet, and what members reviewed, for one week (Monday to Sunday, UTC). Built from what the site already holds:
// grades and their history from data/agents.json (copied from Agent Report Card, never re-scored), health checks
// from the directory copy, and member reviews. Nothing is guessed.
//
// A cron builds last week's digest every Monday and keeps it, so /digest has an archive that doesn't shift later.
// It never posts anywhere: the organiser copies the ready-made LinkedIn text from /admin/digest and posts it by hand.
import express from 'express';
import { allAgents } from './agents.js';
import { resolveAgent } from './reviews.js';
import { listedPath, listedRef } from './directory-views.js';
import { digestPage, digestArchivePage, adminDigestPage } from './digest-views.js';
import { pageNotFound } from './views.js';

const DAY = 864e5;
export const TOP = 5; // how many of each list the page shows
const POST_TOP = 3; // and the LinkedIn post, which has to stay short
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

// ----- Weeks -----

// The Monday (UTC) a date's week starts on, as "2026-11-16".
export function weekOf(date) {
  const d = new Date(date);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
  return new Date(start).toISOString().slice(0, 10);
}
export const addWeeks = (week, n) => new Date(Date.parse(`${week}T00:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10);
// The last week that has fully ended.
export const lastFullWeek = (now = new Date()) => addWeeks(weekOf(now), -1);
export const isWeek = (s) => WEEK_RE.test(s ?? '') && weekOf(`${s}T00:00:00Z`) === s;
const bounds = (week) => [Date.parse(`${week}T00:00:00Z`), Date.parse(`${addWeeks(week, 1)}T00:00:00Z`)];

// ----- Grades -----

// Every grade change in the week, from each agent's test history. Provisional runs are left out: only settled results count.
// Returns { gains, drops, steady, fresh, top }, each agent with its score before and after.
export function gradeMoves(agents, week) {
  const [start, end] = bounds(week);
  const gains = [], drops = [], steady = [], fresh = [];
  const standings = [];
  for (const a of agents) {
    const runs = (a.history ?? []).filter((h) => !h.provisional && Number.isFinite(h.score) && Date.parse(h.date) < end)
      .sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
    if (!runs.length) continue;
    const last = runs.at(-1);
    standings.push({ id: a.id, name: a.name, own: Boolean(a.ownAgent), score: last.score, grade: last.grade });
    const inWeek = runs.filter((h) => Date.parse(h.date) >= start);
    if (!inWeek.length) continue;
    const before = runs.filter((h) => Date.parse(h.date) < start).at(-1);
    const base = { id: a.id, name: a.name, own: Boolean(a.ownAgent), score: last.score, grade: last.grade, runs: inWeek.length, date: last.date };
    if (!before) fresh.push(base);
    else {
      const m = { ...base, from: before.score, fromGrade: before.grade, change: last.score - before.score };
      (m.change > 0 ? gains : m.change < 0 ? drops : steady).push(m);
    }
  }
  gains.sort((x, y) => y.change - x.change || y.score - x.score);
  drops.sort((x, y) => x.change - y.change || x.score - y.score);
  fresh.sort((x, y) => y.score - x.score);
  standings.sort((x, y) => y.score - x.score);
  return { gains, drops, steady, fresh, top: standings.slice(0, 3) };
}

// ----- Building a week -----

// Everything for one week's digest. `live` means health checks are read now, so only the week that just ended (or the
// one under way) gets them; weeks filled in afterwards only have what has dates on it (grades, reviews, new listings).
export async function buildDigest({ db, week, agents = allAgents(), live = true, previous = null }) {
  const [start, end] = bounds(week);
  const from = new Date(start).toISOString(), to = new Date(end).toISOString();
  const grades = gradeMoves(agents, week);

  // Reviews written in the week that are still visible, grouped by agent.
  const reviewRows = await db.digest.reviewsBetween(from, to);
  const reviewed = [];
  for (const r of reviewRows.slice(0, TOP)) {
    const agent = await resolveAgent(db, r.agent_ref);
    if (agent) reviewed.push({ ref: agent.ref, name: agent.name, path: agent.path, count: r.count, avg: r.avg });
  }
  const reviews = { total: reviewRows.reduce((n, r) => n + r.count, 0), agents: reviewRows.length, top: reviewed };

  const newListed = await db.digest.listedBetween(from, to);

  let health = null;
  if (live) {
    // "Went quiet": answered at least once before, didn't answer the latest check. Compared with last week's digest
    // to say which are new this week and which came back.
    const down = await db.digest.down();
    const downRefs = down.map(listedRef);
    const before = previous?.health ? new Set(previous.health.downRefs ?? []) : null;
    const newlyDown = before ? down.filter((r) => !before.has(listedRef(r))) : down;
    const backUp = before?.size ? await db.digest.upNow([...before]) : [];
    const counts = await db.listed.healthCounts();
    const item = (r) => ({ ref: listedRef(r), name: r.name, path: r.tested_id ? `/agents/${encodeURIComponent(r.tested_id)}` : listedPath(r),
      tested: Boolean(r.tested_id), uptime: r.checks ? Math.round((100 * r.up_checks) / r.checks) : null });
    health = { checked: counts.checked, up: counts.up, down: down.length, comparedWithLastWeek: Boolean(before),
      newlyDown: newlyDown.slice(0, TOP).map(item), newlyDownCount: newlyDown.length,
      backUp: backUp.slice(0, TOP).map(item), backUpCount: backUp.length, downRefs: downRefs.slice(0, 5000) };
  }

  return {
    week, from, to, live, builtAt: new Date().toISOString(),
    gains: grades.gains.slice(0, TOP), drops: grades.drops.slice(0, TOP), fresh: grades.fresh.slice(0, TOP),
    counts: { gains: grades.gains.length, drops: grades.drops.length, steady: grades.steady.length, fresh: grades.fresh.length, retested: grades.gains.length + grades.drops.length + grades.steady.length },
    steady: grades.steady.slice(0, TOP), top: grades.top, reviews, newListed, health,
  };
}

// True when nothing at all happened, so an empty week filled in afterwards isn't kept.
export const quietWeek = (d) => !d.counts.fresh && !d.counts.retested && !d.reviews.total && !d.newListed
  && !(d.health && (d.health.newlyDownCount || d.health.backUpCount));

// Builds and keeps last week's digest, unless it's already kept (or `force`), and fills in any earlier weeks since the
// first test that have none. Returns what it did.
export async function runWeekly({ db, now = new Date(), agents = allAgents(), force = false }) {
  const week = lastFullWeek(now);
  const existing = await db.digest.get(week);
  let built = null;
  if (!existing || force) {
    const previous = await db.digest.get(addWeeks(week, -1));
    built = await buildDigest({ db, week, agents, live: true, previous: previous?.content });
    await db.digest.save(week, built);
  }
  const filled = [];
  const first = agents.flatMap((a) => (a.history ?? []).map((h) => Date.parse(h.date))).filter(Number.isFinite).reduce((m, t) => Math.min(m, t), Infinity);
  if (Number.isFinite(first)) {
    const kept = new Set(await db.digest.weeks());
    for (let w = weekOf(first); w < week; w = addWeeks(w, 1)) {
      if (kept.has(w)) continue;
      const d = await buildDigest({ db, week: w, agents, live: false });
      if (quietWeek(d)) continue;
      await db.digest.save(w, d);
      filled.push(w);
    }
  }
  return { week, built: Boolean(built), filled };
}

// ----- Words -----

export const weekLabel = (week) => new Date(`${week}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const own = (a) => (a.own ? ' (our own agent, for the record)' : '');
export const moveText = (m) => `${m.name}: ${m.from} → ${m.score} (${m.change > 0 ? '+' : ''}${m.change})${m.fromGrade !== m.grade ? `, ${m.fromGrade} to ${m.grade}` : `, still ${article(m.grade)} ${m.grade}`}${own(m)}`;
const article = (g) => (['A', 'F'].includes(g) ? 'an' : 'a');

// The headline for the week, in Polly's voice. Facts only: it names the biggest mover if there is one.
export function headline(d) {
  const g = d.gains[0], dr = d.drops[0];
  if (g && (!dr || g.change >= -dr.change)) return `${g.name} climbs ${plural(g.change, 'point')}`;
  if (dr) return `${dr.name} drops ${plural(-dr.change, 'point')}`;
  if (d.counts.fresh) return `${plural(d.counts.fresh, 'new agent')} on the perch`;
  if (d.counts.steady) return 'Retests, and nobody budged';
  return 'A quiet week on the perch';
}

// The ready-to-post LinkedIn text. Plain words, short lines, every number from the digest. The organiser posts it by hand.
export function linkedinText(d, { url }) {
  const lines = [`🦜 Agent Parrot top movers: week of ${weekLabel(d.week)}`, '', `${headline(d)}.`, ''];
  const block = (title, items, more) => {
    if (!items.length) return;
    lines.push(title, ...items.map((t) => `• ${t}`));
    if (more > 0) lines.push(`…and ${more} more.`);
    lines.push('');
  };
  block('📈 Climbed', d.gains.slice(0, POST_TOP).map(moveText), d.counts.gains - POST_TOP);
  block('📉 Dropped a feather', d.drops.slice(0, POST_TOP).map(moveText), d.counts.drops - POST_TOP);
  block('🆕 First Polly Test', d.fresh.slice(0, POST_TOP).map((a) => `${a.name}: ${a.grade}, ${a.score}${own(a)}`), d.counts.fresh - POST_TOP);
  if (!d.gains.length && !d.drops.length && d.counts.steady) lines.push(`🔁 ${plural(d.counts.steady, 'agent')} retested, same score as before.`, '');
  if (!d.counts.retested && !d.counts.fresh) lines.push('No new test results this week. Polly is sharpening the red pen.', '');
  const h = d.health;
  if (h?.newlyDownCount) {
    lines.push(`📡 Went quiet: ${plural(h.newlyDownCount, 'listed agent')} that used to answer didn't at the latest health check${h.newlyDownCount <= POST_TOP ? ` (${h.newlyDown.map((a) => a.name).join(', ')})` : ''}.`);
    lines.push('');
  }
  if (h?.backUpCount) lines.push(`✅ Back up: ${plural(h.backUpCount, 'agent')} answering again.`, '');
  if (d.reviews.total) {
    const t = d.reviews.top[0];
    lines.push(`⭐ ${plural(d.reviews.total, 'new member review')}${t ? `. Most reviewed: ${t.name} (${t.avg.toFixed(1)} stars from ${plural(t.count, 'review')})` : ''}.`, '');
  }
  if (d.newListed) lines.push(`🗂️ ${plural(d.newListed, 'new agent')} turned up in the public directories we follow. Not Polly Tested yet.`, '');
  if (d.top.length) lines.push(`🏆 Top of the Pecking Order: ${d.top.map((a) => `${a.name} (${a.score})`).join(', ')}.`, '');
  lines.push('Every grade comes from real tasks marked by two independent judges. No vibes, just test results.');
  lines.push(`Full digest: ${url}`);
  lines.push('', '#AIagents #AgentParrot');
  return lines.join('\n');
}

// ----- Routes -----

export function digestRoutes({ db, config, adminOnly, now = () => new Date() }) {
  const app = express.Router();
  const urlFor = (week) => `${config.baseUrl.replace(/\/$/, '')}/digest/${week}`;

  app.get('/digest', async (req, res) => {
    const list = await db.digest.list();
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(digestArchivePage({ latest: list[0] ? await db.digest.get(list[0].week) : null, list }));
  });

  app.get('/digest/:week', async (req, res) => {
    const week = req.params.week;
    const row = isWeek(week) ? await db.digest.get(week) : null;
    if (!row) return res.status(404).send(pageNotFound());
    const weeks = await db.digest.weeks();
    const i = weeks.indexOf(week); // newest first
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(digestPage({ d: row.content, newer: weeks[i - 1] ?? null, older: weeks[i + 1] ?? null }));
  });

  const admin = async (res, { notice, preview } = {}) => {
    const list = await db.digest.list();
    const rows = await Promise.all(list.slice(0, 12).map((r) => db.digest.get(r.week)));
    res.set('Cache-Control', 'private, no-store');
    res.send(adminDigestPage({ digests: rows.map((r) => ({ ...r, post: linkedinText(r.content, { url: urlFor(r.week) }) })), notice,
      preview: preview && { d: preview, post: linkedinText(preview, { url: urlFor(preview.week) }) }, nextRun: addWeeks(weekOf(now()), 1) }));
  };
  app.get('/admin/digest', adminOnly, (req, res) => admin(res));
  // Rebuilds last week's digest with today's health checks, and fills in any missing earlier weeks.
  app.post('/admin/digest/build', adminOnly, async (req, res) => {
    const r = await runWeekly({ db, now: now(), force: true });
    await admin(res, { notice: `Built the digest for the week of ${weekLabel(r.week)}.${r.filled.length ? ` Also filled in ${plural(r.filled.length, 'earlier week')}.` : ''}` });
  });
  // The week so far, shown here only and not kept.
  app.post('/admin/digest/preview', adminOnly, async (req, res) => {
    const week = weekOf(now());
    const previous = await db.digest.get(addWeeks(week, -1));
    await admin(res, { preview: await buildDigest({ db, week, live: true, previous: previous?.content }) });
  });

  // Vercel Cron calls this every Monday morning (see vercel.json). Does nothing if last week's digest is already kept.
  app.get('/api/cron/digest', async (req, res) => {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'unauthorised' });
    try {
      res.json(await runWeekly({ db, now: now() }));
    } catch (err) {
      console.error('Weekly digest failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
