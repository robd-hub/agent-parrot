import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { fromMcp, fromErc8004, prepare, ERC8004_CHAINS } from '../src/directories.js';
import { checkAgent, checkHealth, isPrivateAddress, publicUrl, rpcResult } from '../src/health.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };
const META = 'io.modelcontextprotocol.registry/official';
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...init.headers }, ...init });
const sse = (body, headers = {}) => new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });

// A pretend world of agents, keyed by host.
function fakeAgents(calls = []) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push(`${init.method ?? 'GET'} ${u.host}${u.pathname} ${body?.method ?? ''}`.trim());
    if (u.host === 'good.example') {
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (body?.method === 'initialize') return json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'Good <Server>', version: '2.1' }, capabilities: { tools: {} } } }, { headers: { 'mcp-session-id': 'abc' } });
      if (body?.method === 'tools/list') {
        assert.equal(init.headers['mcp-session-id'], 'abc', 'the session is carried on');
        return sse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'get_weather', description: 'Weather for a city' }, { name: 'forecast' }] } });
      }
      return new Response(null, { status: 202 });
    }
    if (u.host === 'locked.example') return new Response('{"error":"unauthorised"}', { status: 401 });
    if (u.host === 'gone.example') return new Response('not found', { status: 404 });
    if (u.host === 'slow.example') throw new DOMException('timed out', 'TimeoutError');
    if (u.host === 'a2a.example' && u.pathname === '/.well-known/agent-card.json') return json({ name: 'Swapper', version: '1.0', skills: [{ id: 'swap', name: 'Swap tokens' }] });
    return new Response('nope', { status: 500 });
  };
}

test('private and local addresses are never visited', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['93.184.216.34', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  assert.match((await publicUrl('http://localhost:3000/mcp')).error, /private/);
  assert.match((await publicUrl('https://sneaky.example/mcp', async () => [{ address: '10.0.0.8' }])).error, /private/);
  assert.match((await publicUrl('ftp://x.example')).error, /web address/);
  const calls = [];
  const r = await checkAgent({ source: 'mcp', endpoint: 'http://169.254.169.254/latest' }, { fetchFn: fakeAgents(calls) });
  assert.equal(r.up, false);
  assert.equal(calls.length, 0);
});

test('an MCP agent is greeted, its tools are read and the session is closed', async () => {
  const calls = [];
  const r = await checkAgent({ source: 'mcp', endpoint: 'https://good.example/mcp' }, { fetchFn: fakeAgents(calls), lookup: publicLookup });
  assert.equal(r.up, true);
  assert.equal(r.server.name, 'Good <Server>');
  assert.deepEqual(r.tools.map((t) => t.name), ['get_weather', 'forecast']);
  await new Promise((done) => setTimeout(done, 10));
  assert.ok(calls.includes('DELETE good.example/mcp'));
  assert.equal(rpcResult('data: {"jsonrpc":"2.0","id":7,"result":{}}\n\n', 7).id, 7);
});

test('locked, missing, slow and A2A agents each get the right verdict', async () => {
  const opts = { fetchFn: fakeAgents(), lookup: publicLookup };
  const locked = await checkAgent({ source: 'mcp', endpoint: 'https://locked.example/mcp' }, opts);
  assert.deepEqual([locked.up, locked.note], [true, 'Answered, but needs a key']);
  const gone = await checkAgent({ source: 'mcp', endpoint: 'https://gone.example/mcp' }, opts);
  assert.equal(gone.up, false);
  assert.match(gone.note, /404/);
  const slow = await checkAgent({ source: 'mcp', endpoint: 'https://slow.example/mcp' }, opts);
  assert.deepEqual([slow.up, slow.note], [false, 'No answer within 10 seconds']);
  const a2a = await checkAgent({ source: 'erc8004', endpoint: 'https://a2a.example/a2a', details: { a2a: { endpoint: 'https://a2a.example/a2a' } } }, opts);
  assert.equal(a2a.up, true);
  assert.equal(a2a.tools[0].name, 'Swap tokens');
});

test('health runs save results, show on the pages, and each agent is checked once a day at most', async (t) => {
  const db = await connect();
  const app = createApp({ db, config, fetchFn: fakeAgents(), lookup: publicLookup, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, init) => (await fetch(base + path, init)).text();
  const entry = (name, url) => ({ server: { name, title: name.split('/')[1], description: 'x', version: '1', remotes: [{ type: 'streamable-http', url }] }, _meta: { [META]: { status: 'active', isLatest: true } } });
  await db.listed.save(prepare([
    fromMcp(entry('com.good/weather', 'https://good.example/mcp')),
    fromMcp(entry('com.gone/thing', 'https://gone.example/mcp')),
    fromErc8004({ agentId: '5', owner: '0x1111111111111111111111111111111111111111', registrationFile: { name: 'Swapper', description: 'Swaps', a2aEndpoint: 'https://a2a.example/a2a', active: true } }, ERC8004_CHAINS.base),
  ]));

  assert.deepEqual(await checkHealth({ db, fetchFn: fakeAgents(), lookup: publicLookup }), { checked: 3, up: 2 });
  assert.deepEqual(await checkHealth({ db, fetchFn: fakeAgents(), lookup: publicLookup }), { checked: 0, up: 0 }, 'not again the same day');
  // A sync keeps the health results.
  await db.listed.save(prepare([fromMcp(entry('com.good/weather', 'https://good.example/mcp'))]));
  const good = await db.listed.get('mcp', 'com.good/weather');
  assert.deepEqual([good.up, good.checks, good.up_checks], [true, 1, 1]);

  const page = await get('/listed/mcp/com.good/weather');
  assert.match(page, /Answered/);
  assert.match(page, /100%/);
  assert.match(page, /What it can do: 2 tools/);
  assert.match(page, /get_weather/);
  assert.match(page, /Good &lt;Server&gt; 2\.1/);
  assert.match(await get('/listed/mcp/com.gone/thing'), /No answer.*404/s);
  assert.match(await get('/listed/erc8004/8453:5'), /1 skills|Swap tokens/);

  const list = await get('/listed');
  assert.match(list, /tag-pass[^>]*>Up/);
  assert.match(list, /tag-fail[^>]*>Down/);
  assert.match(list, /2 tools/);
  const live = await get('/listed?live=1');
  assert.match(live, /weather/);
  assert.doesNotMatch(live, /thing<\/a>/);

  assert.match(await get('/makers/web/good.com'), /1 of 1 agent answered/);
  assert.match(await get('/admin/directories', { headers: admin }), /3<\/b> of 3 checked/);
  assert.equal((await fetch(`${base}/api/cron/health`)).status, 200);
});

test('claimed agents are checked before the tens of thousands of others', async () => {
  const db = await connect();
  const entry = (name, url) => ({ server: { name, title: name.split('/')[1], description: 'x', version: '1', remotes: [{ type: 'streamable-http', url }] }, _meta: { [META]: { status: 'active', isLatest: true } } });
  await db.listed.save(prepare(['a', 'b', 'c'].map((n) => fromMcp(entry(`com.${n}/agent`, `https://${n}.example/mcp`)))));
  const uid = await db.recordLogin({ id: 'github:7', name: 'Maker', email: 'maker@example.com', email_verified: true, github_login: 'maker' });
  await db.claims.save('mcp:com.c/agent', uid, 'github', 'GitHub sign-in as maker');
  const [first] = await db.listed.dueForCheck(1);
  assert.equal(first.source_id, 'com.c/agent');
});
