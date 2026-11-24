import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { allAgents } from '../src/agents.js';
import { planOf, ipLimiter, gradeChanges, sendGradeWebhooks, hashKey, PLANS } from '../src/api-keys.js';

const baseConfig = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: { clientId: 'h', clientSecret: 'hs' }, x402Facilitator: 'https://facilitator.example', x402LookupUsd: 0.002 };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

async function start(configExtra = {}) {
  const db = await connect();
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === 'https://facilitator.example/verify') return Response.json({ isValid: JSON.parse(init.body).paymentPayload.ok === true, invalidReason: 'bad_signature', payer: '0xabc' });
    if (u === 'https://facilitator.example/settle') return Response.json({ success: true, transaction: '0xtx1', network: 'base', payer: '0xabc' });
    if (u.startsWith('https://hooks.example/')) return new Response('ok', { status: 200 });
    return new Response('nope', { status: 404 });
  };
  const fetchProfile = async (provider, { code }) => ({ id: `github:${code}`, name: `${code} Tester`, given_name: code, family_name: 'Tester', email: `${code}@example.com`, email_verified: true, github_login: code });
  const app = createApp({ db, config: { ...baseConfig, ...configExtra }, fetchFn, fetchProfile, lookup: publicLookup, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    const jar = new Map();
    const req = async (path, { method = 'GET', form, headers = {} } = {}) => {
      const h = { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      let body;
      if (form) (h['content-type'] = 'application/x-www-form-urlencoded'), (body = new URLSearchParams(form).toString());
      const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, headers: res.headers, location: res.headers.get('location'), text, json };
    };
    return { req };
  };
  const member = async (who) => {
    const c = client();
    const go = await c.req('/auth/github');
    await c.req(`/auth/github/callback?code=${who}&state=${new URL(go.location).searchParams.get('state')}`);
    await c.req('/join', { method: 'POST', form: { consent: 'yes', role: 'builder' } });
    return c;
  };
  const makeKey = async (c, label = 'test') => {
    const page = await c.req('/api-keys', { method: 'POST', form: { label } });
    return /(ap_[A-Za-z0-9_-]{20,60})/.exec(page.text)[1];
  };
  return { db, calls, client, member, makeKey, close: () => server.close() };
}

test('plans: a paid plan only counts until it runs out', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  assert.equal(planOf(null, now), 'free');
  assert.equal(planOf({ plan: 'starter' }, now), 'starter');
  assert.equal(planOf({ plan: 'developer', paid_until: '2026-12-15T00:00:00Z' }, now), 'developer');
  assert.equal(planOf({ plan: 'business', paid_until: '2026-11-30T00:00:00Z' }, now), 'starter');
  assert.ok(PLANS.developer.history && !PLANS.starter.history);
});

test('calls without a key are capped per address per hour', () => {
  const limit = ipLimiter({ perHour: 2 });
  const t = Date.UTC(2026, 10, 24, 10);
  assert.equal(limit('1.1.1.1', t).over, false);
  assert.equal(limit('1.1.1.1', t).over, false);
  assert.equal(limit('1.1.1.1', t).over, true);
  assert.equal(limit('2.2.2.2', t).over, false, 'per address');
  assert.equal(limit('1.1.1.1', t + 36e5).over, false, 'resets next hour');
});

test('the free feed still needs no key; a key is counted and never cached', async (t) => {
  const s = await start();
  t.after(s.close);
  const anon = s.client();
  const free = await anon.req('/api/grades.json');
  assert.equal(free.status, 200);
  assert.match(free.headers.get('cache-control'), /public/);
  assert.match(free.headers.get('x-ratelimit-limit'), /hour/);

  const ada = await s.member('ada');
  const key = await s.makeKey(ada);
  const keyPage = await ada.req('/api-keys');
  assert.doesNotMatch(keyPage.text, new RegExp(key), 'the whole key is only shown once');
  assert.match(keyPage.text, new RegExp(key.slice(0, 10)));
  const row = await s.db.apiKeys.byHash(hashKey(key));
  assert.ok(row && !JSON.stringify(row).includes(key), 'only a hash is stored');

  const keyed = await anon.req('/api/grades.json', { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(keyed.status, 200);
  assert.equal(keyed.json.count, allAgents().length, 'same data as the free feed');
  assert.equal(keyed.headers.get('cache-control'), 'private, no-store');
  assert.equal(keyed.headers.get('x-ratelimit-limit'), '1000/day');
  assert.equal(keyed.headers.get('x-ratelimit-remaining'), '999');
  const byHeader = await anon.req('/api/grades/coder.json', { headers: { 'X-API-Key': key } });
  assert.equal(byHeader.headers.get('x-ratelimit-remaining'), '998');
  const acct = await anon.req('/api/account', { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(acct.json.plan, 'starter');
  assert.equal(acct.json.callsToday, 2);

  assert.equal((await anon.req('/api/grades.json', { headers: { Authorization: 'Bearer ap_notarealkeynotarealkey00' } })).status, 401);
  assert.equal((await anon.req('/api/grades.json', { headers: { Authorization: 'Bearer junk' } })).status, 401);

  // Revoked keys stop working; another member can't revoke yours.
  const bob = await s.member('bob');
  await bob.req(`/api-keys/${row.id}/revoke`, { method: 'POST' });
  assert.equal((await anon.req('/api/grades.json', { headers: { Authorization: `Bearer ${key}` } })).status, 200);
  await ada.req(`/api-keys/${row.id}/revoke`, { method: 'POST' });
  assert.equal((await anon.req('/api/grades.json', { headers: { Authorization: `Bearer ${key}` } })).status, 401);
});

test('grade history: paid keys only, switched on by Rob at /admin/api', async (t) => {
  const s = await start();
  t.after(s.close);
  const anon = s.client();
  assert.equal((await anon.req('/api/grades/coder/history.json')).status, 403, 'no key, no x402 wallet set');
  const ada = await s.member('ada');
  const key = await s.makeKey(ada);
  const auth = { headers: { Authorization: `Bearer ${key}` } };
  const starter = await anon.req('/api/grades/coder/history.json', auth);
  assert.equal(starter.status, 403);
  assert.match(starter.json.plans, /feed#plans/);

  const row = await s.db.apiKeys.byHash(hashKey(key));
  assert.equal((await anon.req(`/admin/api/${row.id}/plan`, { method: 'POST', form: { plan: 'developer', months: '1' } })).status, 401, 'admin only');
  assert.equal((await anon.req(`/admin/api/${row.id}/plan`, { method: 'POST', form: { plan: 'developer', months: '1' }, headers: admin })).status, 303);
  const adminPage = await anon.req('/admin/api', { headers: admin });
  assert.match(adminPage.text, /Developer/);
  assert.match(adminPage.text, new RegExp(row.id));

  const hist = await anon.req('/api/grades/coder/history.json', auth);
  assert.equal(hist.status, 200);
  const real = allAgents().find((a) => a.id === 'coder');
  assert.equal(hist.json.agent.grade, real.grade);
  assert.equal(hist.json.history.length, real.history.length);
  assert.equal(hist.json.source.name, 'Agent Report Card');
  assert.doesNotMatch(JSON.stringify(hist.json), /Polly|Parrot|Squawk/);
  assert.equal(hist.headers.get('x-ratelimit-limit'), '20000/day');
  assert.equal((await anon.req('/api/grades/nope/history.json', auth)).status, 404);

  const page = await ada.req('/api-keys');
  assert.match(page.text, /Webhook/, 'paid keys can add a webhook');
});

test('pay per call over x402: 402 with payment details, then verified and settled', async (t) => {
  const s = await start({ x402PayTo: '0x1111111111111111111111111111111111111111' });
  t.after(s.close);
  const anon = s.client();
  const ask = await anon.req('/api/grades/coder/history.json');
  assert.equal(ask.status, 402);
  const reqs = ask.json.accepts[0];
  assert.equal(ask.json.x402Version, 1);
  assert.equal(reqs.scheme, 'exact');
  assert.equal(reqs.network, 'base');
  assert.equal(reqs.maxAmountRequired, '2000');
  assert.equal(reqs.payTo, '0x1111111111111111111111111111111111111111');
  assert.equal(reqs.resource, 'http://localhost/api/grades/coder/history.json');

  const pay = (payload) => ({ headers: { 'X-PAYMENT': Buffer.from(JSON.stringify(payload)).toString('base64') } });
  const bad = await anon.req('/api/grades/coder/history.json', pay({ ok: false }));
  assert.equal(bad.status, 402);
  assert.match(bad.json.error, /bad_signature/);
  assert.ok(!s.calls.some((c) => c.url.endsWith('/settle')), 'a bad payment is never settled');
  assert.equal((await anon.req('/api/grades/coder/history.json', { headers: { 'X-PAYMENT': '%%%' } })).status, 402);

  const good = await anon.req('/api/grades/coder/history.json', pay({ ok: true }));
  assert.equal(good.status, 200);
  assert.ok(good.json.history.length > 0);
  const receipt = JSON.parse(Buffer.from(good.headers.get('x-payment-response'), 'base64').toString());
  assert.equal(receipt.transaction, '0xtx1');
  const sent = JSON.parse(s.calls.find((c) => c.url.endsWith('/settle')).init.body);
  assert.equal(sent.paymentRequirements.maxAmountRequired, '2000');
  const adminPage = await anon.req('/admin/api', { headers: admin });
  assert.match(adminPage.text, /1 paid calls/);
  assert.match(adminPage.text, /0xtx1/);
  const feed = await anon.req('/feed');
  assert.match(feed.text, /402 Payment Required/);
});

test('grade webhooks: first run only saves, later runs send what changed, signed', async (t) => {
  const s = await start();
  t.after(s.close);
  const ada = await s.member('ada');
  const key = await s.makeKey(ada);
  const row = await s.db.apiKeys.byHash(hashKey(key));
  // A starter key can't add a webhook.
  const refused = await ada.req(`/api-keys/${row.id}/webhook`, { method: 'POST', form: { url: 'https://hooks.example/a' } });
  assert.equal(refused.status, 403);
  await s.db.apiKeys.setPlan(row.id, 'business', '2099-01-01T00:00:00Z');
  assert.equal((await ada.req(`/api-keys/${row.id}/webhook`, { method: 'POST', form: { url: 'http://hooks.example/a' } })).status, 400, 'https only');
  assert.equal((await ada.req(`/api-keys/${row.id}/webhook`, { method: 'POST', form: { url: 'https://hooks.example/a' } })).status, 200);

  const fetchFn = async (url, init) => (s.calls.push({ url: String(url), init }), new Response('ok'));
  const config = { graderUrl: 'https://grader.example' };
  const agents = allAgents();
  const first = await sendGradeWebhooks({ db: s.db, config, fetchFn, lookup: publicLookup, agents });
  assert.equal(first.seeded, agents.length);
  assert.equal(first.sent, 0);
  assert.equal((await sendGradeWebhooks({ db: s.db, config, fetchFn, lookup: publicLookup, agents })).changes, 0);

  const changed = agents.map((a, i) => (i === 0 ? { ...a, grade: 'F', score: 12, gradedAt: '2026-12-01T00:00:00Z' } : a));
  const run = await sendGradeWebhooks({ db: s.db, config, fetchFn, lookup: publicLookup, agents: changed });
  assert.deepEqual([run.changes, run.sent], [1, 1]);
  const hook = s.calls.findLast((c) => c.url === 'https://hooks.example/a');
  const body = JSON.parse(hook.init.body);
  assert.equal(body.event, 'grades.updated');
  assert.equal(body.changes[0].after.grade, 'F');
  assert.equal(body.changes[0].before.grade, agents[0].grade);
  const secret = (await s.db.apiKeys.get(row.id)).webhook_secret;
  assert.equal(hook.init.headers['x-signature-256'], `sha256=${createHmac('sha256', secret).update(hook.init.body).digest('hex')}`);
  assert.equal(hook.init.redirect, 'manual');
  assert.equal((await s.db.apiKeys.get(row.id)).webhook_status, 'ok 200');

  // Private addresses are never posted to.
  await s.db.apiKeys.setWebhook(row.id, 'github:ada', 'https://internal.example/x', 'x');
  const before = s.calls.length;
  await sendGradeWebhooks({ db: s.db, config, fetchFn, lookup: async () => [{ address: '10.0.0.5', family: 4 }], agents });
  assert.equal(s.calls.length, before);
  assert.match((await s.db.apiKeys.get(row.id)).webhook_status, /refused/);
});

test('gradeChanges spots new and changed grades only', () => {
  const agents = [{ id: 'a', name: 'A', grade: 'B', score: 85, gradedAt: 'd1' }, { id: 'b', name: 'B', grade: 'A', score: 95, gradedAt: 'd1' }];
  const snaps = [{ agent_id: 'a', grade: 'B', score: 85, graded_at: 'd1' }];
  const c = gradeChanges(agents, snaps);
  assert.deepEqual(c.map((x) => x.id), ['b']);
  assert.equal(c[0].before, null);
});
