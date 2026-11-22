// Request a Polly Test on Agent Parrot itself, instead of sending people to the grader's own page.
//
// The grade still comes from Agent Report Card (config.graderUrl). Its request form posts JSON to
// POST <graderUrl>/api/request/ (agent-report-card src/server/request.ts), and that is all we call:
//   {agent, whatItDoes, payment, name, model, task, contact}  -> {status: "opened", request: <GitHub issue url>}
//   the same with check: true and no payment                    -> {status: "ok", priceUsd, regrade}
//   anything wrong                                              -> {status: "invalid", field, error} or "unavailable"
// The grader checks the USDC payment on Base before it opens the request, so nothing here can start a free test.
// Card payments go through the grader's Stripe Payment Link, which collects the agent's link itself and opens its
// own request, so a card buyer never comes back through this form.
//
// We keep a row per request we sent (test_requests) so the buyer has a status page here, /request/<id>. Its live
// state comes from the public GitHub issue the grader opened (open = being tested, closed = graded).
import express from 'express';
import { randomBytes } from 'node:crypto';
import { allAgents, agentById } from './agents.js';
import { claimable } from './claims.js';
import { requestPage, requestStatusPage, myRequestsBlock } from './test-request-views.js';
import { pageNotFound } from './views.js';

// Rob's public Base wallet for USDC grade payments (same as PAY_ADDRESS in agent-report-card src/lib/links.ts).
export const PAY_ADDRESS = '0x57dE743368Ef3cf200ea6295Ab4981C8784a1054';
export const USDC_ON_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const GRADE_PRICE_USD = 10;
export const REGRADE_PRICE_USD = 5;
// The grader's own GitHub form, the fallback the grader itself offers when its form can't be reached.
export const GITHUB_REQUEST_URL = 'https://github.com/robd-hub/agent-report-card/issues/new?template=grade-request.yml';

const GRADER_MS = 25000; // the grader checks the payment on Base before it answers
const STATUS_MS = 6000;
const STATUS_EVERY_MS = 2 * 60 * 1000;
const PER_IP = { max: 10, windowMs: 10 * 60 * 1000 };
const clean = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

export const FIELDS = { agent: 500, model: 100, whatItDoes: 2000, name: 80, task: 1000, contact: 200, payment: 300 };
export const formFrom = (body = {}) => Object.fromEntries(Object.entries(FIELDS).map(([k, max]) => [k, clean(body[k], max)]));

// The grader tests an OpenServ marketplace agent, a public https address that answers POST {"prompt": "..."}, an
// OpenAI-style /chat/completions address (with a model name), or a remote MCP server (agent-report-card PR #57).
// It treats an address as MCP when a path part is /mcp, it ends in /sse, or its host starts with mcp.; any other MCP
// address is sent as "mcp:<address>". Its check (check: true) connects to an MCP server before anyone pays.
export function looksLikeMcp(link) {
  const l = String(link ?? '').trim().split(/\s+/)[0] ?? '';
  if (/^mcp:/i.test(l)) return true;
  try {
    const u = new URL(l);
    return /(^|\/)mcp(\/|$)/i.test(u.pathname) || /\/sse\/?$/i.test(u.pathname) || /(^|\.)mcp\./i.test(u.hostname);
  } catch {
    return false;
  }
}

// The address as the grader should get it: an MCP server it wouldn't spot by its address gets "mcp:" in front.
export const asMcp = (link) => (!link || looksLikeMcp(link) ? link : `mcp:${link}`);

// What we can tell before calling the grader. Returns {field, error} or null.
export function checkForm(f, { needPayment = true } = {}) {
  const link = (f.agent.split(/\s+/)[0] ?? '').replace(/^mcp:/i, '');
  const openserv = /^\d{1,7}$/.test(link) || /openserv/i.test(link);
  if (!link) return { field: 'agent', error: 'Tell us where to find your agent.' };
  if (!openserv) {
    let u;
    try {
      u = new URL(link);
    } catch {}
    if (!u || u.protocol !== 'https:') return { field: 'agent', error: 'Use your agent\'s OpenServ marketplace link, or a public https address.' };
    if (/\/chat\/completions\/?$/.test(u.pathname) && !f.model) return { field: 'model', error: 'OpenAI-style addresses also need the model name.' };
  }
  if (f.whatItDoes.length < 10) return { field: 'whatItDoes', error: 'Tell us in a sentence what your agent does, so Polly can pick fair test tasks.' };
  if (needPayment && !/0x[0-9a-f]{64}/i.test(f.payment)) return { field: 'payment', error: 'Paste the Basescan link or the transaction hash (it starts with 0x) for your USDC payment.' };
  return null;
}

// Sends the form to the grader. Always resolves to a reply object, never throws.
export async function sendToGrader({ graderUrl, fetchFn = fetch }, body) {
  try {
    const res = await fetchFn(`${graderUrl}/api/request/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'agent-parrot' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GRADER_MS),
      redirect: 'error',
    });
    const reply = await res.json().catch(() => ({}));
    if (reply && typeof reply === 'object' && reply.status) return reply;
    return { status: 'unavailable', error: res.status === 429 ? 'Too many requests just now. Try again in a minute.' : "The grader didn't answer properly just now." };
  } catch {
    return { status: 'unavailable', error: "We couldn't reach the grader just now." };
  }
}

// owner/repo/number of a GitHub issue link, only for github.com issue links.
export function issueOf(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([\w.-]{1,100})\/issues\/(\d{1,9})$/.exec(String(url ?? ''));
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

// Reads the grade request issue's public state from GitHub. Null if it can't be read just now.
export async function readIssue(url, { fetchFn = fetch, githubToken } = {}) {
  const i = issueOf(url);
  if (!i) return null;
  try {
    const res = await fetchFn(`https://api.github.com/repos/${i.owner}/${i.repo}/issues/${i.number}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-parrot', ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}) },
      signal: AbortSignal.timeout(STATUS_MS),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { state: j.state === 'closed' ? 'closed' : 'open', comments: Number(j.comments) || 0, closedAt: j.closed_at ?? null };
  } catch {
    return null;
  }
}

// What the grader's check said, kept to what we show: the price, and for an MCP server its name and tools.
export function quoteOf(reply) {
  const m = reply.agentType === 'mcp' && reply.mcp && typeof reply.mcp === 'object' ? reply.mcp : null;
  const names = (v) => (Array.isArray(v) ? v.map((t) => String(typeof t === 'object' && t ? t.name ?? '' : t).slice(0, 80)).filter(Boolean).slice(0, 30) : []);
  return {
    status: 'ok', priceUsd: Number(reply.priceUsd), regrade: Boolean(reply.regrade),
    mcp: m ? { name: String(m.name ?? '').slice(0, 100), tools: Array.isArray(m.tools) ? m.tools.length : Number(m.tools) || 0, usable: names(m.usableTools) } : null,
  };
}

// A tested agent the grader would call by this link (marketplace number or the same address).
export function testedFor(link) {
  const l = (String(link ?? '').trim().split(/\s+/)[0] ?? '').replace(/^mcp:/i, '');
  if (!l) return null;
  const mp = /^\d{1,7}$/.test(l) ? Number(l) : /openserv/i.test(l) ? Number((/agents?\/(\d{1,7})(?!\d)/i.exec(l) ?? [])[1]) : NaN;
  const same = (a, b) => String(a ?? '').replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
  return allAgents().find((a) => (Number.isFinite(mp) && a.marketplaceId === mp) || (a.url && same(a.url, l))) ?? null;
}

// What the form starts with when someone comes from an agent's page (?ref=) or an older link (?agent=).
export async function prefill(db, query) {
  const ref = clean(query.ref, 300);
  const out = { form: formFrom({ agent: query.agent, name: query.name }), agentRef: '', from: null };
  if (!ref) return out;
  const c = await claimable(db, ref).catch(() => null);
  if (!c) return out;
  const tested = c.tested ?? null;
  const isMcp = !tested && c.row?.source === 'mcp' && Boolean(c.row?.endpoint);
  const link = tested ? (tested.url || '') : isMcp ? asMcp(c.row.endpoint) : (c.row?.endpoint || c.row?.url || '');
  out.agentRef = c.ref;
  out.from = { name: c.name, path: c.path, tested, mcp: isMcp || looksLikeMcp(link) };
  out.form.agent ||= link;
  out.form.name ||= c.name;
  if (!out.form.whatItDoes) out.form.whatItDoes = clean(tested?.description || c.row?.description, FIELDS.whatItDoes);
  return out;
}

export function testRequestRoutes({ db, config, fetchFn = fetch, now = () => new Date() }) {
  const app = express.Router();
  const grader = { graderUrl: config.graderUrl, fetchFn };
  const cardLink = config.cardPaymentLink;
  const hits = new Map();
  const tooMany = (req) => {
    const key = req.ip ?? 'unknown';
    const t = now().getTime();
    const list = (hits.get(key) ?? []).filter((x) => x > t - PER_IP.windowMs);
    if (hits.size > 5000) hits.clear();
    if (list.length >= PER_IP.max) return true;
    list.push(t);
    hits.set(key, list);
    return false;
  };
  const memberId = async (req) => (req.session.uid && (await db.get(req.session.uid)) ? req.session.uid : null);
  const render = async (req, res, extra) => {
    const uid = await memberId(req);
    res.send(requestPage({ cardLink, payAddress: PAY_ADDRESS, mine: uid ? await db.testRequests.mine(uid) : [], ...extra }));
  };

  app.get('/request', async (req, res) => {
    const p = await prefill(db, req.query);
    await render(req, res, { ...p, tested: p.from?.tested ?? testedFor(p.form.agent) });
  });

  // The wallet button asks first, so the buyer pays only once the form is right and pays the right price.
  app.post('/request/quote', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (tooMany(req)) return res.status(429).json({ status: 'invalid', error: 'Too many tries. Wait a few minutes and try again.' });
    const f = formFrom(req.body);
    const bad = checkForm(f, { needPayment: false });
    if (bad) return res.status(400).json({ status: 'invalid', ...bad });
    const { payment, ...rest } = f;
    const reply = await sendToGrader(grader, { ...rest, check: true });
    if (reply.status === 'ok' && [GRADE_PRICE_USD, REGRADE_PRICE_USD].includes(Number(reply.priceUsd))) {
      return res.json({ ...quoteOf(reply), payTo: PAY_ADDRESS, usdc: USDC_ON_BASE });
    }
    res.status(reply.status === 'invalid' ? 400 : 503).json({ status: reply.status === 'invalid' ? 'invalid' : 'unavailable', field: reply.field, error: reply.error ?? "We couldn't check your details just now, so nothing was paid." });
  });

  // "Check it first (free)": the same check without JavaScript, before paying by pasting a transaction.
  const checkFirst = async (req, res, f, agentRef) => {
    const bad = checkForm(f, { needPayment: false });
    let check;
    if (bad) check = { ok: false, ...bad };
    else {
      const { payment, ...rest } = f;
      const reply = await sendToGrader(grader, { ...rest, check: true });
      check = reply.status === 'ok' && [GRADE_PRICE_USD, REGRADE_PRICE_USD].includes(Number(reply.priceUsd))
        ? { ok: true, ...quoteOf(reply) }
        : { ok: false, field: reply.field, error: reply.error ?? "We couldn't check your agent just now. Nothing was paid; try again in a minute." };
    }
    res.status(check.ok ? 200 : 400);
    await render(req, res, { form: f, agentRef, check, field: check.ok ? undefined : check.field, tested: testedFor(f.agent) });
  };

  app.post('/request', async (req, res) => {
    const f = formFrom(req.body);
    const agentRef = clean(req.body.agentRef, 300);
    const again = async (status, error, field) => {
      res.status(status);
      await render(req, res, { form: f, agentRef, error, field, tested: testedFor(f.agent), fallback: status >= 500 });
    };
    if (tooMany(req)) return again(429, 'Too many tries. Wait a few minutes and try again (you never pay twice for one transaction).');
    if (req.body.intent === 'check') return checkFirst(req, res, f, agentRef);
    const bad = checkForm(f);
    if (bad) return again(400, bad.error, bad.field);
    const reply = await sendToGrader(grader, f);
    if (reply.status !== 'opened' || !issueOf(reply.request)) {
      if (reply.status === 'invalid') return again(400, reply.error ?? 'Please check the form.', reply.field);
      return again(503, reply.error ?? "We couldn't open your request just now.");
    }
    const tx = (/0x[0-9a-f]{64}/i.exec(f.payment) ?? [''])[0].toLowerCase();
    let row = await db.testRequests.byRequestUrl(reply.request);
    if (!row) {
      row = await db.testRequests.save({
        id: randomBytes(9).toString('base64url'), memberId: await memberId(req), agentRef: agentRef || null,
        agent: f.agent, name: f.name || testedFor(f.agent)?.name || '', requestUrl: reply.request, tx,
        priceUsd: Number(reply.priceUsd) || null,
      });
    }
    res.redirect(303, `/request/${encodeURIComponent(row.id)}${reply.existing ? '?existing=1' : ''}`);
  });

  app.get('/request/:id', async (req, res) => {
    const row = /^[\w-]{6,40}$/.test(req.params.id) ? await db.testRequests.get(req.params.id) : null;
    if (!row) return res.status(404).send(pageNotFound());
    let live = row.issue_state ? { state: row.issue_state, comments: row.issue_comments, closedAt: row.issue_closed_at } : null;
    const stale = !row.issue_checked_at || now() - new Date(row.issue_checked_at) > STATUS_EVERY_MS;
    if (stale && row.issue_state !== 'closed') {
      const fresh = await readIssue(row.request_url, { fetchFn, githubToken: config.githubToken });
      if (fresh) {
        live = fresh;
        await db.testRequests.setIssue(row.id, fresh);
      }
    }
    const tested = (row.agent_ref && agentById(row.agent_ref)) || testedFor(row.agent);
    res.set('Cache-Control', 'no-store');
    res.send(requestStatusPage({ row, live, tested, existing: req.query.existing === '1' }));
  });

  return app;
}

export { myRequestsBlock };
