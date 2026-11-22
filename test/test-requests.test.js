import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { checkForm, formFrom, looksLikeMcp, issueOf, testedFor } from '../src/test-requests.js';
import { fromMcp, prepare } from '../src/directories.js';
import { allAgents } from '../src/agents.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', cardPaymentLink: 'https://buy.stripe.example/x', linkedin: {}, google: {}, github: {} };
const TX = `0x${'ab'.repeat(32)}`;
const ISSUE = 'https://github.com/robd-hub/agent-report-card/issues/42';
const META = 'io.modelcontextprotocol.registry/official';

async function start() {
  const db = await connect();
  const sent = [];
  let clock = Date.now();
  let issue = { state: 'open', comments: 0, closed_at: null };
  const fetchFn = async (url, init = {}) => {
    url = String(url);
    if (url === 'https://grader.example/api/request/') {
      const body = JSON.parse(init.body);
      sent.push(body);
      if (body.check) return Response.json({ status: 'ok', priceUsd: 10, regrade: false });
      if (body.payment.includes('dead')) return Response.json({ status: 'invalid', field: 'payment', error: "That transaction wasn't found on Base." }, { status: 400 });
      return Response.json({ status: 'opened', request: ISSUE, priceUsd: 10 }, { status: 201 });
    }
    if (url === 'https://api.github.com/repos/robd-hub/agent-report-card/issues/42') return Response.json(issue);
    return new Response('nope', { status: 404 });
  };
  await db.listed.save(prepare([fromMcp({
    server: { name: 'com.acme/weather', description: 'Weather forecasts for anywhere', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://weather.acme.example/mcp' }] },
    _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-20T10:00:00Z' } },
  })]));
  const app = createApp({ db, config, fetchFn, now: () => new Date(clock), lookup: async () => [{ address: '93.184.216.34', family: 4 }], getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, { form } = {}) => {
    const res = await fetch(base + path, form ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), redirect: 'manual' } : { redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
  return { db, sent, req, setIssue: (i) => (issue = i), tick: (ms) => (clock += ms), close: () => server.close() };
}

const good = { agent: 'https://my-agent.example/api', whatItDoes: 'Answers questions about invoices.', name: 'Invoice Bot', payment: `https://basescan.org/tx/${TX}` };

test('checkForm stops MCP servers, bad links and missing payments before anyone pays', () => {
  assert.equal(checkForm(formFrom(good)), null);
  assert.equal(checkForm(formFrom({ ...good, agent: 'https://platform.openserv.ai/agents/39' })), null);
  assert.equal(checkForm(formFrom({ ...good, agent: 'http://my-agent.example/api' })).field, 'agent');
  assert.match(checkForm(formFrom({ ...good, agent: 'https://x.example/mcp' })).error, /MCP/);
  assert.equal(checkForm(formFrom({ ...good, agent: 'https://x.example/v1/chat/completions' })).field, 'model');
  assert.equal(checkForm(formFrom({ ...good, whatItDoes: 'short' })).field, 'whatItDoes');
  assert.equal(checkForm(formFrom({ ...good, payment: 'paid!' })).field, 'payment');
  assert.equal(checkForm(formFrom({ ...good, payment: '' }), { needPayment: false }), null);
  assert.ok(looksLikeMcp('https://a.example/sse') && !looksLikeMcp('https://a.example/api'));
  assert.deepEqual(issueOf(ISSUE), { owner: 'robd-hub', repo: 'agent-report-card', number: 42 });
  assert.equal(issueOf('https://evil.example/issues/1'), null);
  const mp = allAgents().find((a) => a.marketplaceId);
  assert.equal(testedFor(`https://platform.openserv.ai/agents/${mp.marketplaceId}`)?.id, mp.id);
});

test('the form is prefilled from a listing and warns about MCP servers', async () => {
  const s = await start();
  try {
    const page = await s.req(`/request?ref=${encodeURIComponent('mcp:com.acme/weather')}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Request a Polly Test/);
    assert.match(page.text, /value="https:\/\/weather\.acme\.example\/mcp"/);
    assert.match(page.text, /Weather forecasts for anywhere<\/textarea>/);
    assert.match(page.text, /can(&#39;|')t test MCP servers yet/);
    assert.match(page.text, /buy\.stripe\.example/);
    const mp = allAgents().find((a) => a.marketplaceId);
    const retest = await s.req(`/request?ref=${encodeURIComponent(mp.id)}`);
    assert.match(retest.text, /\$5 retest/);
    const listed = await s.req('/listed');
    assert.match(listed.text, /href="\/request\?ref=mcp%3Acom.acme%2Fweather">Test this agent/);
  } finally {
    s.close();
  }
});

test('a request goes to the grader, gets a status page, and shows the grade request state', async () => {
  const s = await start();
  try {
    const mcp = await s.req('/request', { form: { ...good, agent: 'https://weather.acme.example/mcp' } });
    assert.equal(mcp.status, 400);
    assert.match(mcp.text, /can(&#39;|')t test MCP servers yet/);
    assert.equal(s.sent.length, 0, 'nothing is sent to the grader for an MCP server');

    const bad = await s.req('/request', { form: { ...good, payment: `0xdead${'0'.repeat(60)}` } });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /wasn(&#39;|')t found on Base/);
    assert.match(bad.text, /value="Invoice Bot"/, 'the form keeps what was typed');

    const sent = await s.req('/request', { form: good });
    assert.equal(sent.status, 303);
    assert.match(sent.location, /^\/request\/[\w-]+$/);
    const last = s.sent.at(-1);
    assert.equal(last.agent, good.agent);
    assert.equal(last.whatItDoes, good.whatItDoes);
    assert.match(last.payment, new RegExp(TX));

    const status = await s.req(sent.location);
    assert.equal(status.status, 200);
    assert.match(status.text, /Polly is testing it/);
    assert.match(status.text, new RegExp(ISSUE.replace(/[/.]/g, '\\$&')));

    // Same payment again: same status page, no second row.
    const again = await s.req('/request', { form: good });
    assert.equal(again.location.split('?')[0], sent.location);

    // Three minutes on, the page reads GitHub again and sees the request closed (graded).
    s.setIssue({ state: 'closed', comments: 2, closed_at: '2026-11-22T12:00:00Z' });
    s.tick(3 * 60 * 1000);
    const graded = await s.req(sent.location);
    assert.match(graded.text, /rq-step done"><b>✓ Graded/);
    assert.match(graded.text, /2 replies so far/);
    assert.equal((await s.req('/request/nope')).status, 404);
  } finally {
    s.close();
  }
});

test('the wallet quote asks the grader for the price without a payment', async () => {
  const s = await start();
  try {
    const res = await s.req('/request/quote', { form: { agent: good.agent, whatItDoes: good.whatItDoes } });
    const body = JSON.parse(res.text);
    assert.equal(body.status, 'ok');
    assert.equal(body.priceUsd, 10);
    assert.match(body.payTo, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(s.sent.at(-1).check, true);
    assert.equal(s.sent.at(-1).payment, undefined);
    const mcp = await s.req('/request/quote', { form: { agent: 'https://x.example/mcp', whatItDoes: good.whatItDoes } });
    assert.equal(mcp.status, 400);
  } finally {
    s.close();
  }
});
