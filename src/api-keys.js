// Grades API plans: keys, daily limits, grade history, grade webhooks and pay-per-call over x402.
// Plan: https://claude.ai/artifact/X27gvgpmZnvcrSdVy5cnu2 (revenue line 3, paid grades API).
//
// The free feed stays as it was: /api/grades.json, /api/grades/<id>.json and /api/grades/lookup need no key.
// A key (sent as "Authorization: Bearer ap_..." or "X-API-Key: ap_...") adds a known daily limit, and on a paid
// plan grade history (/api/grades/<id>/history.json) and a webhook when grades change.
// Anyone without a paid key can buy one history call at a time in USDC on Base over x402, once X402_PAY_TO is set.
//
// Paying for the API never changes a grade, a ranking or what the free feed shows. Grades come from Agent Report Card.
import express from 'express';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { allAgents, agentById } from './agents.js';
import { publicUrl } from './health.js';
import { apiKeysPage, adminApiPage } from './api-key-views.js';

export const PLANS = {
  free: { name: 'Free, no key', perHour: 300, history: false, webhooks: false, price: 'Free' },
  starter: { name: 'Starter key', perDay: 1000, history: false, webhooks: false, price: 'Free' },
  developer: { name: 'Developer', perDay: 20000, history: true, webhooks: true, price: '$29 a month' },
  business: { name: 'Business', perDay: 200000, history: true, webhooks: true, commercial: true, price: '$99 a month' },
};
export const KEYS_PER_MEMBER = 3;
export const USDC_ON_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const KEY_RE = /^ap_[A-Za-z0-9_-]{20,60}$/;

export const hashKey = (key) => createHash('sha256').update(key).digest('hex');
export const newKey = () => `ap_${randomBytes(24).toString('base64url')}`;
const day = (d) => d.toISOString().slice(0, 10);

// The plan a key is on right now: a paid plan only counts until paid_until.
export function planOf(key, now = new Date()) {
  if (!key) return 'free';
  if ((key.plan === 'developer' || key.plan === 'business') && key.paid_until && new Date(key.paid_until) > now) return key.plan;
  return 'starter';
}

// The key sent with a request, if any.
export function keyFrom(req) {
  const auth = req.get('authorization') || '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  return bearer || req.get('x-api-key') || '';
}

// Calls without a key are counted per address per hour, in this server's memory only. It's a speed bump, not billing:
// most of these are served from the CDN cache and never get here.
export function ipLimiter({ perHour = PLANS.free.perHour, max = 20000 } = {}) {
  const seen = new Map();
  return (ip, now = Date.now()) => {
    const hour = Math.floor(now / 36e5);
    let e = seen.get(ip);
    if (!e || e.hour !== hour) {
      if (seen.size >= max) seen.clear();
      e = { hour, calls: 0 };
      seen.set(ip, e);
    }
    e.calls++;
    return { limit: perHour, remaining: Math.max(0, perHour - e.calls), over: e.calls > perHour };
  };
}

// Payment details for one x402 call, in the "exact" scheme (x402 version 1). USDC has 6 decimals.
export function x402Requirements({ config, resource, description }) {
  return {
    scheme: 'exact', network: 'base',
    maxAmountRequired: String(Math.round(Number(config.x402LookupUsd) * 1e6)),
    resource, description, mimeType: 'application/json',
    payTo: config.x402PayTo, maxTimeoutSeconds: 60, asset: USDC_ON_BASE,
    extra: { name: 'USD Coin', version: '2' },
  };
}

// Checks and settles an x402 payment with the facilitator. Returns {ok: true, settled} or {ok: false, error}.
export async function takePayment({ header, requirements, config, fetchFn = fetch }) {
  let paymentPayload;
  try {
    paymentPayload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return { ok: false, error: 'The X-PAYMENT header is not valid base64 JSON.' };
  }
  const body = JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements });
  const call = async (path) => {
    const res = await fetchFn(`${config.x402Facilitator}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20000) });
    return res.json().catch(() => ({}));
  };
  try {
    const verified = await call('verify');
    if (!verified.isValid) return { ok: false, error: `Payment not accepted: ${verified.invalidReason || 'invalid'}.` };
    const settled = await call('settle');
    if (!settled.success) return { ok: false, error: `Payment could not be settled: ${settled.errorReason || 'unknown reason'}.` };
    return { ok: true, settled };
  } catch (err) {
    console.error('x402 facilitator error:', err);
    return { ok: false, error: 'The payment service did not answer. Nothing was charged; please try again.' };
  }
}

// Every grade that is new or different since the last run, compared with the saved snapshots.
export function gradeChanges(agents, snapshots) {
  const before = new Map(snapshots.map((s) => [s.agent_id, s]));
  return agents.filter((a) => {
    const s = before.get(a.id);
    return !s || s.graded_at !== a.gradedAt || s.grade !== a.grade || Number(s.score) !== Number(a.score);
  }).map((a) => {
    const s = before.get(a.id);
    return { id: a.id, name: a.name, before: s ? { grade: s.grade, score: Number(s.score), gradedAt: s.graded_at } : null, after: { grade: a.grade, score: a.score, gradedAt: a.gradedAt } };
  });
}

export const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

// Posts one webhook. Public https addresses only, no redirects, 8 second limit. Returns a short status for the key's page.
export async function postWebhook(key, payload, { fetchFn = fetch, lookup = dnsLookup } = {}) {
  const checked = await publicUrl(key.webhook_url, lookup);
  if (checked.error || checked.url.protocol !== 'https:') return `refused: ${checked.error || 'needs https'}`;
  const body = JSON.stringify(payload);
  try {
    const res = await fetchFn(checked.url.href, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000), body,
      headers: { 'content-type': 'application/json', 'user-agent': 'GradesWebhook/1.0', 'x-grades-event': payload.event, 'x-signature-256': sign(key.webhook_secret, body) },
    });
    return res.ok ? `ok ${res.status}` : `failed ${res.status}`;
  } catch (err) {
    return `failed: ${err.name === 'TimeoutError' ? 'no answer in 8 seconds' : 'could not connect'}`;
  }
}

// The daily run: send each paid key with a webhook the grades that changed. The first run only saves snapshots,
// so nobody gets every grade at once.
export async function sendGradeWebhooks({ db, config, fetchFn = fetch, lookup = dnsLookup, now = new Date(), agents = allAgents() }) {
  const snapshots = await db.apiKeys.snapshots();
  const changes = gradeChanges(agents, snapshots);
  const save = () => Promise.all(changes.map((c) => db.apiKeys.saveSnapshot({ agentId: c.id, ...c.after })));
  if (!snapshots.length) {
    await save();
    return { seeded: changes.length, changes: 0, sent: 0 };
  }
  if (!changes.length) return { changes: 0, sent: 0 };
  const payload = {
    event: 'grades.updated', sentAt: now.toISOString(), source: 'Agent Report Card',
    changes: changes.map((c) => ({ ...c, report: `${config.graderUrl}/agents/${encodeURIComponent(c.id)}/` })),
  };
  const keys = await db.apiKeys.withWebhooks(now.toISOString());
  let sent = 0;
  for (const k of keys) {
    const status = await postWebhook(k, payload, { fetchFn, lookup });
    if (status.startsWith('ok')) sent++;
    await db.apiKeys.webhookResult(k.id, status);
  }
  await save();
  return { changes: changes.length, keys: keys.length, sent };
}

// Runs before every /api/grades call: works out the caller's plan, counts the call and sets the limit headers.
export function apiAccess({ db, now = () => new Date(), limiter = ipLimiter() }) {
  return async (req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, X-API-Key, X-PAYMENT, Content-Type',
      'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-PAYMENT-RESPONSE',
      Vary: 'Authorization, X-API-Key',
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
    const raw = keyFrom(req);
    if (!raw) {
      req.apiPlan = 'free';
      const r = limiter(req.ip);
      res.set({ 'X-RateLimit-Limit': `${r.limit}/hour`, 'X-RateLimit-Remaining': String(r.remaining) });
      if (r.over) return res.status(429).json({ error: 'Too many calls without a key. Get a free key for a higher limit.', keys: '/api-keys' });
      return next();
    }
    if (!KEY_RE.test(raw)) return res.status(401).json({ error: 'That API key is not valid.' });
    const key = await db.apiKeys.byHash(hashKey(raw));
    if (!key) return res.status(401).json({ error: 'That API key is not valid or has been revoked.' });
    const at = now();
    const plan = planOf(key, at);
    const calls = await db.apiKeys.countCall(key.id, day(at));
    const limit = PLANS[plan].perDay;
    res.set({ 'X-RateLimit-Limit': `${limit}/day`, 'X-RateLimit-Remaining': String(Math.max(0, limit - calls)), 'Cache-Control': 'private, no-store' });
    if (calls > limit) return res.status(429).json({ error: `This key has used its ${limit} calls for today (UTC). The limit resets at midnight UTC.` });
    req.apiKey = key;
    req.apiPlan = plan;
    next();
  };
}

// Grade history for one agent: a paid key, or one x402 payment per call.
export function historyHandler({ db, config, fetchFn = fetch, source }) {
  return async (req, res) => {
    const agent = agentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'No graded agent with that id.' });
    const answer = () => ({
      version: 1, source: source(),
      agent: { id: agent.id, name: agent.name, grade: agent.grade, score: agent.score, gradedAt: agent.gradedAt, report: `${config.graderUrl}/agents/${encodeURIComponent(agent.id)}/` },
      history: (agent.history ?? []).map((h) => ({ date: h.date, grade: h.grade, score: h.score, provisional: Boolean(h.provisional) })),
    });
    res.set('Cache-Control', 'private, no-store');
    if (PLANS[req.apiPlan]?.history) return res.json(answer());
    if (!config.x402PayTo) {
      return res.status(403).json({ error: 'Grade history needs a Developer or Business key.', plans: `${config.baseUrl}/feed#plans` });
    }
    const requirements = x402Requirements({ config, resource: `${config.baseUrl}${req.originalUrl.split('?')[0]}`, description: `Grade history for ${agent.name} (Agent Report Card)` });
    const header = req.get('x-payment');
    const needPay = (error) => res.status(402).json({ x402Version: 1, error, accepts: [requirements] });
    if (!header) return needPay('X-PAYMENT header is required. Or use a Developer or Business key.');
    const paid = await takePayment({ header, requirements, config, fetchFn });
    if (!paid.ok) return needPay(paid.error);
    const s = paid.settled;
    await db.apiKeys.recordPayment({ tx: s.transaction, payer: s.payer, network: s.network, resource: requirements.resource, usd: Number(config.x402LookupUsd) })
      .catch((err) => console.error('Could not record an x402 payment:', err));
    res.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, transaction: s.transaction, network: s.network, payer: s.payer })).toString('base64'));
    res.json(answer());
  };
}

// The member's key page, the admin page and the webhook cron.
export function apiKeyRoutes({ db, config, adminOnly, fetchFn = fetch, lookup = dnsLookup, now = () => new Date() }) {
  const app = express.Router();
  const member = async (req) => (req.session.uid && (await db.get(req.session.uid))) || null;
  const signedIn = async (req, res, next) => {
    req.member = await member(req);
    if (!req.member) return res.redirect('/signin');
    if (!req.member.consent_at) return res.redirect('/join');
    res.set('Cache-Control', 'private, no-store');
    next();
  };
  const links = { developer: config.apiDeveloperLink, business: config.apiBusinessLink };
  const page = async (req, res, extra = {}, status = 200) => res.status(status).send(apiKeysPage({
    member: req.member, keys: await db.apiKeys.mine(req.member.id), plans: PLANS, planOf: (k) => planOf(k, now()), links,
    contactEmail: config.contactEmail, x402: Boolean(config.x402PayTo), x402Usd: config.x402LookupUsd, max: KEYS_PER_MEMBER, ...extra,
  }));
  const myKey = async (req) => {
    const k = await db.apiKeys.get(req.params.id);
    return k && k.member_id === req.member.id && !k.revoked_at ? k : null;
  };

  app.get('/api-keys', signedIn, (req, res) => page(req, res));

  app.post('/api-keys', signedIn, async (req, res) => {
    if ((await db.apiKeys.countMine(req.member.id)) >= KEYS_PER_MEMBER) return page(req, res, { error: `You can have up to ${KEYS_PER_MEMBER} keys. Revoke one to make another.` }, 409);
    const key = newKey();
    const label = String(req.body.label ?? '').trim().slice(0, 60);
    await db.apiKeys.create({ id: randomBytes(8).toString('hex'), memberId: req.member.id, keyHash: hashKey(key), prefix: key.slice(0, 10), label });
    page(req, res, { newKey: key });
  });

  app.post('/api-keys/:id/revoke', signedIn, async (req, res) => {
    if (await myKey(req)) await db.apiKeys.revoke(req.params.id, req.member.id);
    res.redirect(303, '/api-keys');
  });

  app.post('/api-keys/:id/webhook', signedIn, async (req, res) => {
    const k = await myKey(req);
    if (!k) return res.redirect(303, '/api-keys');
    if (!PLANS[planOf(k, now())].webhooks) return page(req, res, { error: 'Webhooks come with the Developer and Business plans.' }, 403);
    const url = String(req.body.url ?? '').trim().slice(0, 500);
    if (url) {
      const checked = await publicUrl(url, lookup);
      if (checked.error || checked.url.protocol !== 'https:') return page(req, res, { error: `That webhook address can't be used: ${checked.error || 'it must start with https://'}.` }, 400);
    }
    await db.apiKeys.setWebhook(k.id, req.member.id, url || null, randomBytes(24).toString('hex'));
    page(req, res, { notice: url ? 'Webhook saved. Grade changes will be sent there once a day.' : 'Webhook removed.' });
  });

  app.post('/api-keys/:id/webhook/test', signedIn, async (req, res) => {
    const k = await myKey(req);
    if (!k?.webhook_url) return res.redirect(303, '/api-keys');
    const a = allAgents()[0];
    const status = await postWebhook(k, { event: 'grades.test', sentAt: now().toISOString(), source: 'Agent Report Card',
      changes: a ? [{ id: a.id, name: a.name, before: null, after: { grade: a.grade, score: a.score, gradedAt: a.gradedAt } }] : [] }, { fetchFn, lookup });
    await db.apiKeys.webhookResult(k.id, status);
    page(req, res, { notice: `Test sent: ${status}.` });
  });

  // What a key is on today. Needs a key.
  app.get('/api/account', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const raw = keyFrom(req);
    const key = KEY_RE.test(raw) ? await db.apiKeys.byHash(hashKey(raw)) : null;
    if (!key) return res.status(401).json({ error: 'Send your key as "Authorization: Bearer ap_..."' });
    const plan = planOf(key, now());
    const today = (await db.apiKeys.mine(key.member_id)).find((k) => k.id === key.id)?.today ?? 0;
    res.json({ plan, name: PLANS[plan].name, callsToday: today, limitPerDay: PLANS[plan].perDay, paidUntil: plan === 'starter' ? null : key.paid_until, history: PLANS[plan].history, webhooks: PLANS[plan].webhooks });
  });

  app.get('/admin/api', adminOnly, async (req, res) => {
    const at = now();
    const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
    res.set('Cache-Control', 'private, no-store').send(adminApiPage({
      keys: await db.apiKeys.forAdmin(day(at)), payments: await db.apiKeys.payments(), month: await db.apiKeys.paymentTotal(month),
      planOf: (k) => planOf(k, at), plans: PLANS, notice: req.query.saved ? 'Plan saved.' : '',
    }));
  });

  // Rob sets a key's plan once its Stripe payment comes in (the payment link carries the key's id as its reference).
  app.post('/admin/api/:id/plan', adminOnly, async (req, res) => {
    const k = await db.apiKeys.get(req.params.id);
    const plan = ['starter', 'developer', 'business'].includes(req.body.plan) ? req.body.plan : null;
    const months = Math.min(24, Math.max(0, Number.parseInt(req.body.months, 10) || 0));
    if (!k || !plan) return res.status(400).send('Pick a key and a plan.');
    let until = null;
    if (plan !== 'starter') {
      const from = k.paid_until && new Date(k.paid_until) > now() ? new Date(k.paid_until) : now();
      until = new Date(from);
      until.setUTCMonth(until.getUTCMonth() + (months || 1));
    }
    await db.apiKeys.setPlan(k.id, plan, until?.toISOString() ?? null);
    res.redirect(303, '/admin/api?saved=1');
  });

  app.get('/api/cron/webhooks', async (req, res) => {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'unauthorised' });
    try {
      res.json(await sendGradeWebhooks({ db, config, fetchFn, lookup, now: now() }));
    } catch (err) {
      console.error('Grade webhooks failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
