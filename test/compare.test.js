import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { fromMcp, prepare } from '../src/directories.js';
import { parseRef } from '../src/compare.js';
import { licenceInfo, privacyInfo } from '../src/openness.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const META = 'io.modelcontextprotocol.registry/official';
const mcp = (name, server = {}) => ({
  server: { name, description: `${name} does things`, version: '1.0.0', remotes: [{ type: 'streamable-http', url: `https://${name.replace(/\W/g, '')}.example/mcp` }], ...server },
  _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-20T10:00:00Z' } },
});

async function start() {
  const db = await connect();
  const app = createApp({ db, config, fetchFn: fetch, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path) => {
    const res = await fetch(base + path, { redirect: 'manual' });
    return { status: res.status, text: await res.text() };
  };
  return { db, req, close: () => server.close() };
}

test('compare refs: tested ids, or a listed source and id', () => {
  assert.deepEqual(parseRef('coder'), { id: 'coder' });
  assert.deepEqual(parseRef('mcp:com.acme/weather'), { source: 'mcp', id: 'com.acme/weather' });
  assert.deepEqual(parseRef('erc8004:8453:7'), { source: 'erc8004', id: '8453:7' });
  assert.equal(parseRef(''), null);
});

test('licence comes from GitHub or a confirmed fact, otherwise it is not known', () => {
  const repo = 'https://github.com/acme/weather';
  assert.equal(licenceInfo({ row: { details: { repo }, activity: { found: true, license: 'MIT' } } }).text, 'Open source: MIT licence');
  assert.equal(licenceInfo({ row: { details: { repo }, activity: { found: true, license: null } } }).open, false);
  assert.equal(licenceInfo({ row: { details: { repo } } }).text, 'Not known yet');
  assert.equal(licenceInfo({ row: {} }).text, 'Not known');
  assert.match(licenceInfo({ openserv: true }).note, /OpenServ/);
  assert.equal(licenceInfo({ facts: { licence: 'Apache-2.0' } }).text, 'Apache-2.0');

  const p = privacyInfo({ row: { endpoint: 'https://w.example/mcp', x402: true } });
  assert.equal(p.policy, null);
  assert.match(p.lines[0], /w\.example/);
  assert.match(p.lines[1], /wallet address/);
});

test('compare page: pick two agents, see them side by side', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.db.listed.save(prepare([fromMcp(mcp('com.acme/weather', { title: 'Weather <Bot>', repository: { url: 'https://github.com/acme/weather' } }))]));
  await s.db.listed.saveHealth([{ source: 'mcp', source_id: 'com.acme/weather', up: true, latency: 240, tools: [{ name: 'get_forecast' }], price: { display: '$0.01 USDC', usd: 0.01 } }]);
  await s.db.listed.saveActivity([{ source: 'mcp', source_id: 'com.acme/weather', activity: { found: true, pushedAt: new Date().toISOString(), stars: 12, openIssues: 1, forks: 0, license: 'MIT' } }]);

  const empty = await s.req('/compare');
  assert.equal(empty.status, 200);
  assert.match(empty.text, /Pick the first agent/);
  assert.match(empty.text, /href="\/compare\?a=coder"/);

  const one = await s.req('/compare?a=coder&q=weather');
  assert.match(one.text, /Pick the second agent/);
  assert.match(one.text, /href="\/compare\?a=coder&amp;b=mcp%3Acom.acme%2Fweather"/);

  const both = await s.req(`/compare?a=coder&b=${encodeURIComponent('mcp:com.acme/weather')}`);
  assert.equal(both.status, 200);
  assert.match(both.text, /Coder.*vs.*Weather &lt;Bot&gt;/s);
  for (const label of ['Polly grade', 'Grade history', 'Price per call', 'Health and uptime', 'Security flags', 'Activity', 'Licence', 'Data privacy', 'Maker and reputation', 'Where it is listed']) {
    assert.match(both.text, new RegExp(label), label);
  }
  assert.match(both.text, /Not Polly Tested yet, so no grade/);
  assert.match(both.text, /\$0\.01 USDC/);
  assert.match(both.text, /100% uptime/);
  assert.match(both.text, /Open source: MIT licence/);
  assert.match(both.text, /What you send goes to comacmeweather\.example/);
  assert.match(both.text, /OpenServ marketplace agents do not publish their code/);

  const gone = await s.req('/compare?a=nope');
  assert.equal(gone.status, 404);
  assert.match(gone.text, /couldn't find one of those agents/);
});

test('agent pages link to compare and show licence and privacy', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.db.listed.save(prepare([fromMcp(mcp('com.acme/weather', { title: 'Weather' }))]));
  const tested = await s.req('/agents/cheap-first');
  assert.match(tested.text, /href="\/compare\?a=cheap-first"/);
  assert.match(tested.text, /Licence/);
  assert.match(tested.text, /Privacy policy not known/);
  const listed = await s.req('/listed/mcp/com.acme/weather');
  assert.match(listed.text, /href="\/compare\?a=mcp%3Acom.acme%2Fweather"/);
  assert.match(listed.text, /No public code listed/);
  assert.match((await s.req('/listed')).text, /Compare two agents side by side/);
  assert.match((await s.req('/agents')).text, /href="\/compare"/);
});
