// Free Lite Check: a quick look at an agent that costs a few cents, to give builders a reason to try Polly before
// paying for a full test. Scoping doc: https://claude.ai/artifact/URF1ntgeCiDFo3yKhDza1b
//
// The grader runs the check (agent-report-card src/lib/lite.ts) behind a private endpoint:
//   POST <GRADER_URL>/api/lite/  Authorization: Bearer <LITE_SECRET>
//   {agent, model, whatItDoes, name, task} -> {status: "ok", band, bandLabel, checks, findings, cost, ...}
// It gives a band (Strong, Mixed, Weak or Couldn't check) and two findings, never a grade. This file keeps the
// limits that stop the AI bill running away, and the results, which stay private to the member who ran one and
// are never counted in grades, the Pecking Order, the digest or maker reputation.
//
// Rob runs checks from /admin/lite first. Members can only start one once he switches "open to members" on there.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { claimable } from './claims.js';
import { prefill, testedFor } from './test-requests.js';
import { litePage, liteResultPage, adminLitePage, myLiteBlock } from './lite-check-views.js';
import { pageNotFound } from './views.js';

export const LIMITS = {
  perAgentDays: 30, // one check per agent address in this many days
  perMemberMonth: 3, // checks a member can start in a calendar month
  perDay: 30, // checks across the whole site in a UTC day
  monthlyUsd: 15, // estimated AI spend in a calendar month (LITE_MONTHLY_USD overrides)
  testedDays: 60, // an agent Polly Tested this recently gets pointed to a retest instead
};
const GRADER_MS = 58000;
const clean = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
export const FIELDS = { agent: 500, model: 100, whatItDoes: 2000, name: 80, task: 1000 };
export const formFrom = (body = {}) => Object.fromEntries(Object.entries(FIELDS).map(([k, max]) => [k, clean(body[k], max)]));

// The address without "mcp:", query, fragment, case or a trailing slash, so one agent can't be checked twice a month
// by writing its address a little differently.
export function agentKey(link) {
  const raw = String(link ?? '').trim().replace(/^mcp:\s*/i, '').split(/\s+/)[0] ?? '';
  try {
    const u = new URL(raw);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return raw.toLowerCase();
  }
}

// What we can tell before calling the grader. Returns {field, error} or null. The grader checks again.
export function checkForm(f) {
  const link = f.agent.replace(/^mcp:\s*/i, '').split(/\s+/)[0] ?? '';
  if (!link) return { field: 'agent', error: 'Tell Polly where to find the agent.' };
  if (/^\d{1,7}$/.test(link) || /openserv/i.test(link)) return { field: 'agent', error: "OpenServ marketplace agents aren't in the Lite Check yet. Use the agent's own https address, or request a full Polly Test." };
  let u;
  try {
    u = new URL(link);
  } catch {}
  if (!u || u.protocol !== 'https:') return { field: 'agent', error: 'Use a public https address.' };
  if (/\/chat\/completions\/?$/.test(u.pathname) && !f.model) return { field: 'model', error: 'OpenAI-style addresses also need the model name.' };
  if (f.whatItDoes.length < 10) return { field: 'whatItDoes', error: 'Say in a sentence what the agent does, so Polly can pick a fair task.' };
  return null;
}

const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Whether a check may start now. Returns {ok: true} or {ok: false, error, existing?, retest?}.
// Rob's own runs (admin) skip the per-member, per-agent and Polly Tested rules but not the budget.
export async function mayStart(db, { memberId, link, now, budgetUsd = LIMITS.monthlyUsd, admin = false }) {
  if ((await db.settings.get('lite_paused')) === '1') return { ok: false, error: 'Lite Checks are paused just now. Try again later, or request a full Polly Test.' };
  const month = monthStart(now);
  if ((await db.liteChecks.spendSince(month.toISOString())) >= budgetUsd) {
    return { ok: false, error: "This month's free Lite Checks have all been used. They open again on the 1st, or you can request a full Polly Test now." };
  }
  if ((await db.liteChecks.countSince(dayStart(now).toISOString())) >= LIMITS.perDay) return { ok: false, error: "Today's free Lite Checks have all been used. Try again tomorrow." };
  if (admin) return { ok: true };
  const tested = testedFor(link);
  if (tested?.gradedAt && now - new Date(tested.gradedAt) < LIMITS.testedDays * 864e5) {
    return { ok: false, retest: tested, error: `Polly gave ${tested.name} a full test recently (grade ${tested.grade}), so a Lite Check wouldn't tell you more. A retest shows what's changed.` };
  }
  const existing = await db.liteChecks.recentFor(agentKey(link), new Date(now - LIMITS.perAgentDays * 864e5).toISOString());
  if (existing) return { ok: false, existing, error: `This agent had a Lite Check in the last ${LIMITS.perAgentDays} days. Each agent gets one a month.` };
  if ((await db.liteChecks.countForMember(memberId, month.toISOString())) >= LIMITS.perMemberMonth) {
    return { ok: false, error: `You've used your ${LIMITS.perMemberMonth} free Lite Checks this month. They come back on the 1st.` };
  }
  return { ok: true };
}

// Asks the grader to run the check. Always resolves, never throws.
export async function askGrader({ graderUrl, liteSecret, fetchFn = fetch }, body) {
  try {
    const res = await fetchFn(`${graderUrl}/api/lite/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'agent-parrot', Authorization: `Bearer ${liteSecret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GRADER_MS),
      redirect: 'error',
    });
    const reply = await res.json().catch(() => ({}));
    if (reply && typeof reply === 'object' && reply.status) return reply;
    return { status: 'unavailable', error: "The grader didn't answer properly." };
  } catch {
    return { status: 'unavailable', error: "We couldn't reach the grader, or it took too long." };
  }
}

const BANDS = new Set(['strong', 'mixed', 'weak', 'couldnt-check']);

// Keeps only what the pages show, so a bad reply can't put anything odd on the page.
export function tidyResult(r) {
  const str = (v, max) => String(v ?? '').slice(0, max);
  const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  return {
    band: BANDS.has(r.band) ? r.band : 'couldnt-check',
    reason: r.reason ? str(r.reason, 300) : undefined,
    kind: r.kind === 'mcp' ? 'mcp' : 'agent',
    checks: list(r.checks, 12).map((c) => ({ label: str(c?.label, 60), status: ['pass', 'warn', 'fail', 'skip'].includes(c?.status) ? c.status : 'skip', detail: str(c?.detail, 400) })),
    findings: list(r.findings, 2).map((f) => ({ from: str(f?.from, 80), text: str(f?.text, 500) })),
    tasks: list(r.tasks, 4).map((t) => ({ label: str(t?.label, 80), summary: str(t?.summary, 500) })),
    note: str(r.note, 400),
    estUsd: Math.max(0, Math.min(1, Number(r.cost?.estimatedUsd) || 0)),
    checkedAt: str(r.checkedAt, 40),
  };
}

// Runs a queued check: takes it (only once), calls the grader, saves the result.
export async function runCheck(db, grader, id) {
  await db.liteChecks.expire();
  const row = await db.liteChecks.start(id);
  if (!row) return db.liteChecks.get(id);
  const reply = await askGrader(grader, { agent: row.agent, model: row.model, whatItDoes: row.what_it_does, name: row.name, task: row.task });
  if (reply.status !== 'ok') {
    await db.liteChecks.fail(id, clean(reply.error ?? 'The check could not run.', 300));
  } else {
    const result = tidyResult(reply);
    await db.liteChecks.finish(id, { band: result.band, result, estUsd: result.estUsd });
  }
  return db.liteChecks.get(id);
}

export function liteCheckRoutes({ db, config, adminOnly, fetchFn = fetch, now = () => new Date() }) {
  const app = express.Router();
  const grader = { graderUrl: config.graderUrl, liteSecret: config.liteSecret, fetchFn };
  const budgetUsd = Number(config.liteMonthlyUsd) > 0 ? Number(config.liteMonthlyUsd) : LIMITS.monthlyUsd;
  const switchedOn = () => Boolean(config.liteSecret);
  const openToMembers = async () => switchedOn() && (await db.settings.get('lite_open')) === '1';
  const member = async (req) => (req.session.uid && (await db.get(req.session.uid))) || null;
  const newId = () => randomBytes(9).toString('base64url');
  const validId = (id) => /^[\w-]{6,40}$/.test(id);
  // The page's script asks for JSON; the no-script button gets sent back to the page.
  const reply = (req, res, row, page) => {
    res.set('Cache-Control', 'no-store');
    if ((req.get('accept') ?? '').includes('application/json')) return res.json({ status: row.status });
    res.redirect(303, page);
  };

  app.get('/lite', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const open = await openToMembers();
    const m = await member(req);
    const p = await prefill(db, req.query);
    res.send(litePage({ open, member: m, form: p.form, agentRef: p.agentRef, from: p.from, mine: m ? await db.liteChecks.mine(m.id) : [], limits: LIMITS }));
  });

  app.post('/lite', async (req, res) => {
    const m = await member(req);
    if (!m) return res.redirect(303, '/signin');
    if (!m.consent_at) return res.redirect(303, '/join');
    const f = formFrom(req.body);
    const agentRef = clean(req.body.agentRef, 300);
    const again = async (status, error, field, extra = {}) => {
      res.status(status).send(litePage({ open: true, member: m, form: f, agentRef, error, field, mine: await db.liteChecks.mine(m.id), limits: LIMITS, ...extra }));
    };
    if (!(await openToMembers())) return res.status(403).send(litePage({ open: false, member: m, form: f, limits: LIMITS }));
    const bad = checkForm(f);
    if (bad) return again(400, bad.error, bad.field);
    const may = await mayStart(db, { memberId: m.id, link: f.agent, now: now(), budgetUsd });
    if (!may.ok) return again(409, may.error, null, { existing: may.existing?.member_id === m.id ? may.existing : null, retest: may.retest });
    const ref = agentRef && (await claimable(db, agentRef).catch(() => null)) ? agentRef : null;
    const row = await db.liteChecks.create({ id: newId(), memberId: m.id, agentRef: ref, agentKey: agentKey(f.agent), agent: f.agent, model: f.model, whatItDoes: f.whatItDoes, task: f.task, name: f.name || testedFor(f.agent)?.name || '' });
    res.redirect(303, `/lite/${encodeURIComponent(row.id)}`);
  });

  // Each check's page is only for the member who ran it: a band is private, so nobody can show a Weak band for a rival.
  const ownRow = async (req) => {
    if (!validId(req.params.id)) return null;
    const m = await member(req);
    const row = await db.liteChecks.get(req.params.id);
    return row && m && row.member_id === m.id ? row : null;
  };

  app.get('/lite/:id', async (req, res) => {
    const row = await ownRow(req);
    if (!row) return res.status(404).send(pageNotFound());
    res.set('Cache-Control', 'private, no-store');
    res.send(liteResultPage({ row, runUrl: `/lite/${encodeURIComponent(row.id)}/run` }));
  });

  app.post('/lite/:id/run', async (req, res) => {
    const row = await ownRow(req);
    if (!row) return res.status(404).json({ status: 'missing' });
    const done = await runCheck(db, grader, row.id);
    reply(req, res, done, `/lite/${encodeURIComponent(row.id)}`);
  });

  // ----- Admin -----

  app.get('/admin/lite', adminOnly, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const t = now();
    const [rows, spend, today, open, paused] = await Promise.all([
      db.liteChecks.forAdmin(), db.liteChecks.spendSince(monthStart(t).toISOString()), db.liteChecks.countSince(dayStart(t).toISOString()),
      db.settings.get('lite_open'), db.settings.get('lite_paused'),
    ]);
    res.send(adminLitePage({ rows, spend, today, budgetUsd, open: open === '1', paused: paused === '1', switchedOn: switchedOn(), limits: LIMITS, error: req.query.error }));
  });

  app.post('/admin/lite', adminOnly, async (req, res) => {
    const f = formFrom(req.body);
    if (!switchedOn()) return res.redirect(303, '/admin/lite?error=off');
    const bad = checkForm(f);
    if (bad) return res.redirect(303, `/admin/lite?error=${encodeURIComponent(bad.error)}`);
    const may = await mayStart(db, { link: f.agent, now: now(), budgetUsd, admin: true });
    if (!may.ok) return res.redirect(303, `/admin/lite?error=${encodeURIComponent(may.error)}`);
    const row = await db.liteChecks.create({ id: newId(), memberId: null, agentRef: null, agentKey: agentKey(f.agent), agent: f.agent, model: f.model, whatItDoes: f.whatItDoes, task: f.task, name: f.name });
    res.redirect(303, `/admin/lite/${encodeURIComponent(row.id)}`);
  });

  app.post('/admin/lite/settings', adminOnly, async (req, res) => {
    await db.settings.set('lite_open', req.body.open === '1' ? '1' : '0');
    await db.settings.set('lite_paused', req.body.paused === '1' ? '1' : '0');
    res.redirect(303, '/admin/lite');
  });

  app.get('/admin/lite/:id', adminOnly, async (req, res) => {
    const row = validId(req.params.id) ? await db.liteChecks.get(req.params.id) : null;
    if (!row) return res.status(404).send(pageNotFound());
    res.set('Cache-Control', 'private, no-store');
    res.send(liteResultPage({ row, runUrl: `/admin/lite/${encodeURIComponent(row.id)}/run`, admin: true }));
  });

  app.post('/admin/lite/:id/run', adminOnly, async (req, res) => {
    const row = validId(req.params.id) ? await db.liteChecks.get(req.params.id) : null;
    if (!row) return res.status(404).json({ status: 'missing' });
    const done = await runCheck(db, grader, row.id);
    reply(req, res, done, `/admin/lite/${encodeURIComponent(row.id)}`);
  });

  return app;
}

export { myLiteBlock };
