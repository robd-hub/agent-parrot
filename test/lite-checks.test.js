import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { agentKey, checkForm, formFrom, tidyResult, LIMITS } from '../src/lite-checks.js';
import { allAgents } from '../src/agents.js';

const SECRET = 'x'.repeat(32);
const baseConfig = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', liteSecret: SECRET, linkedin: {}, google: {}, github: { clientId: 'h', clientSecret: 'hs' } };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };
const NAMES = { ada: ['Ada', 'Lovelace'], bob: ['Bob', 'Smith'] };
const GOOD = { agent: 'https://my-agent.example/api', whatItDoes: 'Answers questions about invoices.', name: 'Invoice Bot' };

const REPLY = {
  status: 'ok', band: 'mixed', bandLabel: 'Mixed', kind: 'agent', average: 71,
  checks: [{ id: 'reach', label: 'Answers', status: 'pass', detail: 'Answered 3 of 3 tasks.' }, { id: 'shape', label: 'Answer shape', status: 'warn', detail: 'The answer wasn\'t first on 2 of 3. <b>x</b>' }],
  tasks: [{ kind: 'core', label: 'Core job', score: 60, summary: 'Missed the VAT line.' }],
  findings: [{ from: 'Core job', text: 'Missed the VAT line.' }, { from: 'Answer shape', text: 'Put the answer first.' }],
  cost: { servCalls: 4, inputTokens: 4000, outputTokens: 300, estimatedUsd: 0.0044 }, note: 'A Polly Peek uses 3 tasks.', checkedAt: '2026-11-22T12:00:00Z',
};

async function start(configExtra = {}) {
  const db = await connect();
  const sent = [];
  let clock = new Date('2026-11-22T12:00:00Z').getTime();
  let reply = REPLY;
  const fetchFn = async (url, init = {}) => {
    if (String(url) === 'https://grader.example/api/lite/') {
      sent.push({ body: JSON.parse(init.body), auth: init.headers.Authorization });
      return Response.json(reply, { status: reply.status === 'ok' ? 200 : 503 });
    }
    return new Response('nope', { status: 404 });
  };
  const fetchProfile = async (provider, { code }) => ({ id: `github:${code}`, name: NAMES[code].join(' '), given_name: NAMES[code][0], family_name: NAMES[code][1], email: `${code}@example.com`, email_verified: true, github_login: code });
  const app = createApp({ db, config: { ...baseConfig, ...configExtra }, fetchFn, fetchProfile, now: () => new Date(clock), getHeadlines: async () => [], writeStories: null, sendEmail: null });
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
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
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
  return { db, sent, client, member, setReply: (r) => (reply = r), tick: (ms) => (clock += ms), close: () => server.close() };
}

test('addresses are cleaned up so one agent is one agent, and the form is checked', () => {
  assert.equal(agentKey('mcp: https://Weather.Example/MCP/?x=1#y'), 'weather.example/mcp');
  assert.equal(agentKey('https://weather.example/mcp'), 'weather.example/mcp');
  assert.equal(checkForm(formFrom(GOOD)), null);
  assert.equal(checkForm(formFrom({ ...GOOD, agent: 'mcp: https://x.example/rpc' })), null);
  assert.equal(checkForm(formFrom({ ...GOOD, agent: 'http://x.example' })).field, 'agent');
  assert.match(checkForm(formFrom({ ...GOOD, agent: 'https://platform.openserv.ai/agents/3' })).error, /OpenServ/);
  assert.equal(checkForm(formFrom({ ...GOOD, agent: 'https://x.example/v1/chat/completions' })).field, 'model');
  assert.equal(checkForm(formFrom({ ...GOOD, whatItDoes: 'short' })).field, 'whatItDoes');
  // Odd replies are trimmed to what the page shows.
  const t = tidyResult({ band: 'great', checks: [{ status: 'boom', label: 'x' }], cost: { estimatedUsd: 99 } });
  assert.equal(t.band, 'couldnt-check');
  assert.equal(t.checks[0].status, 'skip');
  assert.equal(t.estUsd, 1);
});

test('Polly Peeks stay closed to members until Rob opens them, and admin runs work first', async () => {
  const app = await start();
  try {
    const ada = await member(app, 'ada');
    let r = await ada.req('/lite');
    assert.match(r.text, /aren't open yet/);
    r = await ada.req('/lite', { method: 'POST', form: GOOD });
    assert.equal(r.status, 403);
    assert.equal(app.sent.length, 0);

    // Rob runs one from the admin page.
    r = await app.client().req('/admin/lite', { method: 'POST', form: GOOD, headers: admin });
    assert.equal(r.status, 303);
    const page = r.location;
    assert.match(page, /^\/admin\/lite\/[\w-]+$/);
    assert.match((await app.client().req(page, { headers: admin })).text, /Checking Invoice Bot/);
    r = await app.client().req(`${page}/run`, { method: 'POST', headers: { ...admin, Accept: 'application/json' } });
    assert.equal(JSON.parse(r.text).status, 'done');
    assert.equal(app.sent.length, 1);
    assert.equal(app.sent[0].auth, `Bearer ${SECRET}`);
    assert.deepEqual(app.sent[0].body, { agent: GOOD.agent, model: '', whatItDoes: GOOD.whatItDoes, name: 'Invoice Bot', task: '' });
    // Running it again doesn't call the grader twice.
    await app.client().req(`${page}/run`, { method: 'POST', headers: { ...admin, Accept: 'application/json' } });
    assert.equal(app.sent.length, 1);
    const result = (await app.client().req(page, { headers: admin })).text;
    assert.match(result, /Mixed/);
    assert.match(result, /Missed the VAT line/);
    assert.match(result, /Get the full Polly Test/);
    assert.ok(!result.includes('<b>x</b>'), 'grader text is escaped');
    assert.ok(!/\b71\b/.test(result), 'the average behind the band is never shown');
    assert.match((await app.client().req('/admin/lite', { headers: admin })).text, /\$0\.00[0-9]? of \$15/);
    assert.equal((await app.client().req('/admin/lite')).status, 401);
  } finally {
    app.close();
  }
});

async function member(app, who) {
  return app.member(who);
}

test('members get one check per agent a month, three a month each, and private results', async () => {
  const app = await start();
  try {
    await app.client().req('/admin/lite/settings', { method: 'POST', form: { open: '1' }, headers: admin });
    const ada = await member(app, 'ada');
    const bob = await member(app, 'bob');
    // Signed out: no run.
    assert.equal((await app.client().req('/lite', { method: 'POST', form: GOOD })).location, '/signin');

    let r = await ada.req('/lite', { method: 'POST', form: GOOD });
    assert.equal(r.status, 303);
    const page = r.location;
    await ada.req(`${page}/run`, { method: 'POST', headers: { Accept: 'application/json' } });
    assert.match((await ada.req(page)).text, /only you can see this/);
    // Nobody else can see Ada's result, or run it.
    assert.equal((await bob.req(page)).status, 404);
    assert.equal((await app.client().req(page)).status, 404);
    assert.equal((await bob.req(`${page}/run`, { method: 'POST' })).status, 404);
    assert.match((await ada.req('/me')).text, /Your Polly Peeks/);

    // The same agent, written differently, can't be checked again this month, by anyone.
    r = await bob.req('/lite', { method: 'POST', form: { ...GOOD, agent: 'https://MY-AGENT.example/api/' } });
    assert.equal(r.status, 409);
    assert.match(r.text, /one a month/);
    r = await ada.req('/lite', { method: 'POST', form: GOOD });
    assert.match(r.text, /See your last one/);

    // Three a month per member.
    for (const n of [2, 3]) assert.equal((await ada.req('/lite', { method: 'POST', form: { ...GOOD, agent: `https://agent${n}.example/api` } })).status, 303);
    r = await ada.req('/lite', { method: 'POST', form: { ...GOOD, agent: 'https://agent4.example/api' } });
    assert.equal(r.status, 409);
    assert.match(r.text, new RegExp(`your ${LIMITS.perMemberMonth} free Polly Peeks`));

    // After 30 days the agent can be checked again.
    app.tick(31 * 864e5);
    assert.equal((await bob.req('/lite', { method: 'POST', form: GOOD })).status, 303);
  } finally {
    app.close();
  }
});

test('a recently Polly Tested agent is pointed to a retest, and a failed run costs nothing', async () => {
  const app = await start();
  try {
    await app.client().req('/admin/lite/settings', { method: 'POST', form: { open: '1' }, headers: admin });
    const ada = await member(app, 'ada');
    const tested = allAgents().find((a) => a.url && !a.marketplaceId && /^https:/.test(a.url) && a.gradedAt);
    if (tested) {
      const fresh = await start();
      fresh.tick(new Date(tested.gradedAt).getTime() + 864e5 - new Date('2026-11-22T12:00:00Z').getTime());
      try {
        await fresh.client().req('/admin/lite/settings', { method: 'POST', form: { open: '1' }, headers: admin });
        const c = await member(fresh, 'ada');
        const r = await c.req('/lite', { method: 'POST', form: { ...GOOD, agent: tested.url } });
        assert.equal(r.status, 409);
        assert.match(r.text, /Request a retest/);
      } finally {
        fresh.close();
      }
    }

    app.setReply({ status: 'unavailable', error: 'The Polly Peek isn\'t switched on here.' });
    const r = await ada.req('/lite', { method: 'POST', form: GOOD });
    await ada.req(`${r.location}/run`, { method: 'POST', headers: { Accept: 'application/json' } });
    assert.match((await ada.req(r.location)).text, /didn't finish/);
    // A failed check doesn't use up the agent's monthly check.
    app.setReply({ ...REPLY, band: 'couldnt-check', average: null, reason: "The agent didn't answer any of the tasks." });
    const again = await ada.req('/lite', { method: 'POST', form: GOOD });
    assert.equal(again.status, 303);
    await ada.req(`${again.location}/run`, { method: 'POST', headers: { Accept: 'application/json' } });
    assert.match((await ada.req(again.location)).text, /doesn't count against your free checks/);
    // Nor does one that came back "couldn't check".
    app.setReply(REPLY);
    assert.equal((await ada.req('/lite', { method: 'POST', form: GOOD })).status, 303);
  } finally {
    app.close();
  }
});

test('the monthly budget and the pause switch stop new checks', async () => {
  const app = await start({ liteMonthlyUsd: '0.004' });
  try {
    await app.client().req('/admin/lite/settings', { method: 'POST', form: { open: '1' }, headers: admin });
    const ada = await member(app, 'ada');
    const r = await ada.req('/lite', { method: 'POST', form: GOOD });
    await ada.req(`${r.location}/run`, { method: 'POST', headers: { Accept: 'application/json' } });
    // $0.0044 spent of a $0.004 budget.
    const full = await ada.req('/lite', { method: 'POST', form: { ...GOOD, agent: 'https://other.example/api' } });
    assert.equal(full.status, 409);
    assert.match(full.text, /all been used/);

    const app2 = await start();
    try {
      await app2.client().req('/admin/lite/settings', { method: 'POST', form: { open: '1', paused: '1' }, headers: admin });
      const bob = await member(app2, 'bob');
      const p = await bob.req('/lite', { method: 'POST', form: GOOD });
      assert.equal(p.status, 409);
      assert.match(p.text, /paused/);
    } finally {
      app2.close();
    }
  } finally {
    app.close();
  }
});

test('/peek goes to the Polly Peek page', async () => {
  const app = await start();
  try {
    const r = await app.client().req('/peek?ref=coder');
    assert.equal(r.status, 301);
    assert.equal(r.location, '/lite?ref=coder');
    assert.match((await app.client().req('/lite')).text, /Free Polly Peek/);
  } finally {
    app.close();
  }
});

test('without LITE_SECRET, Polly Peeks are off everywhere', async () => {
  const app = await start({ liteSecret: undefined });
  try {
    await app.client().req('/admin/lite/settings', { method: 'POST', form: { open: '1' }, headers: admin });
    assert.match((await app.client().req('/lite')).text, /aren't open yet/);
    const r = await app.client().req('/admin/lite', { method: 'POST', form: GOOD, headers: admin });
    assert.equal(r.location, '/admin/lite?error=off');
    assert.match((await app.client().req(r.location, { headers: admin })).text, /LITE_SECRET/);
    assert.equal(app.sent.length, 0);
  } finally {
    app.close();
  }
});
