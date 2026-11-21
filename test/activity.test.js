import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { fromMcp, fromErc8004, prepare, ERC8004_CHAINS } from '../src/directories.js';
import { x402Price, checkAgent, checkHealth } from '../src/health.js';
import { githubRepo, checkActivity } from '../src/activity.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const META = 'io.modelcontextprotocol.registry/official';
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const offer = (amount, asset = USDC_BASE, network = 'base') => ({ x402Version: 1, accepts: [{ scheme: 'exact', network, maxAmountRequired: amount, asset, payTo: '0x1', resource: 'https://x' }] });
const res402 = (body, headers = {}) => ({ status: 402, text: body ? JSON.stringify(body) : '', headers: new Headers(headers) });

test('the x402 asking price is read, never paid', () => {
  assert.equal(x402Price(res402(offer('5000'))).display, '$0.005 USDC per call on Base');
  assert.equal(x402Price(res402(offer('1500000'))).usd, 1.5);
  const v2 = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: USDC_BASE }] })).toString('base64');
  assert.equal(x402Price(res402(null, { 'payment-required': v2 })).display, '$0.01 USDC per call on Base');
  assert.match(x402Price(res402(offer('42', '0xdeadbeef00000000000000000000000000000000'))).display, /not recognised/);
  assert.equal(x402Price(res402({ error: 'pay up' })), null);
});

test('a 402 answer during the health check records the price', async () => {
  const fetchFn = async () => new Response(JSON.stringify(offer('20000')), { status: 402, headers: { 'content-type': 'application/json' } });
  const r = await checkAgent({ source: 'mcp', endpoint: 'https://paid.example/mcp' }, { fetchFn, lookup: publicLookup });
  assert.equal(r.up, true);
  assert.equal(r.price.display, '$0.02 USDC per call on Base');
});

test('GitHub activity is read weekly, and a rate limit stops the run politely', async () => {
  assert.equal(githubRepo('https://github.com/acme/weather'), 'acme/weather');
  assert.equal(githubRepo('https://github.com/acme/weather.git'), 'acme/weather');
  assert.equal(githubRepo('https://gitlab.com/acme/weather'), null);
  const db = await connect();
  const entry = (name, repo) => fromMcp({ server: { name, title: name, description: 'x', version: '1', repository: { url: repo }, remotes: [{ type: 'streamable-http', url: `https://${name.replace(/\W/g, '')}.example/mcp` }] }, _meta: { [META]: { status: 'active', isLatest: true } } });
  await db.listed.save(prepare([entry('com.a/one', 'https://github.com/a/one'), entry('com.b/two', 'https://github.com/b/two'), entry('com.c/three', 'https://github.com/c/three')]));
  const calls = [];
  const gh = (limitAfter = 99) => async (url, init) => {
    calls.push([url, init.headers.authorization]);
    if (calls.length > limitAfter) return new Response('{}', { status: 403 });
    if (url.endsWith('/b/two')) return new Response('{}', { status: 404, headers: { 'x-ratelimit-remaining': '50' } });
    return new Response(JSON.stringify({ pushed_at: '2026-11-01T00:00:00Z', stargazers_count: 12, open_issues_count: 3, forks_count: 2, archived: url.endsWith('/c/three'), language: 'TypeScript', license: { spdx_id: 'MIT' } }), { status: 200, headers: { 'x-ratelimit-remaining': '50' } });
  };
  const first = await checkActivity({ db, fetchFn: gh(2) });
  assert.deepEqual(first, { checked: 2, stopped: 'GitHub rate limit reached; carries on next run' });
  assert.equal(calls[0][1], undefined, 'no token unless Rob adds one');
  const second = await checkActivity({ db, fetchFn: gh(), token: 't' });
  assert.equal(second.checked, 1, 'only the one not read yet');
  assert.equal(calls.at(-1)[1], 'Bearer t');
  assert.equal((await db.listed.get('mcp', 'com.b/two')).activity.found, false);
  assert.equal((await db.listed.get('mcp', 'com.c/three')).activity.archived, true);
  assert.deepEqual(await checkActivity({ db, fetchFn: gh() }), { checked: 0 }, 'not again within a week');
  await db.close();
});

test('pages show the price, code activity, on-chain activity and the archived warning', async (t) => {
  const db = await connect();
  const app = createApp({ db, config, fetchFn: fetch, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  t.after(() => server.close());
  const get = async (path) => (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).text();
  await db.listed.save(prepare([
    fromMcp({ server: { name: 'com.paid/bot', title: 'Paid Bot', description: 'x', version: '1', repository: { url: 'https://github.com/paid/bot' }, remotes: [{ type: 'streamable-http', url: 'https://paid.example/mcp' }] }, _meta: { [META]: { status: 'active', isLatest: true } } }),
    fromErc8004({ agentId: '9', owner: '0x2222222222222222222222222222222222222222', lastActivity: String(Math.floor(Date.now() / 1000) - 3 * 86400), registrationFile: { name: 'Chain Bot', description: 'x', a2aEndpoint: 'https://chain.example/a2a', active: true, x402Support: true } }, ERC8004_CHAINS.base),
  ]));
  await db.listed.saveHealth([{ source: 'mcp', source_id: 'com.paid/bot', up: true, latency: 90, note: 'Answered, and asks for payment', price: x402Price(res402(offer('5000'))) }]);
  await db.listed.saveActivity([{ source: 'mcp', source_id: 'com.paid/bot', activity: { found: true, pushedAt: new Date(Date.now() - 10 * 86400000).toISOString(), stars: 7, openIssues: 2, forks: 1, archived: true, language: 'Go', license: 'MIT' } }]);

  const page = await get('/listed/mcp/com.paid/bot');
  assert.match(page, /\$0\.005 USDC per call on Base/);
  assert.match(page, /we never pay/);
  assert.match(page, /Last change 10 days ago/);
  assert.match(page, /7 stars · 2 open issues/);
  assert.match(page, /Archived/);
  assert.match(page, /code repository is archived/);
  assert.match(await get('/listed'), /\$0\.005\/call/);

  const chain = await get('/listed/erc8004/8453:9');
  assert.match(chain, /Last on-chain activity/);
  assert.match(chain, /3 days ago/);
  assert.match(chain, /Paid jobs/);
  assert.match(chain, /price is read at its first health check/);
  assert.match(await get('/makers/web/paid.com'), /1 agent active in the last 90 days/);
});
