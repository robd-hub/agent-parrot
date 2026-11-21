import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { syncDirectories, fromMcp, fromErc8004, prepare, listedOn, ERC8004_CHAINS } from '../src/directories.js';
import { agentById } from '../src/agents.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };
const META = 'io.modelcontextprotocol.registry/official';

const mcp = (name, extra = {}, meta = {}) => ({
  server: { name, title: extra.title, description: `${name} does things`, version: '1.0.0', websiteUrl: extra.website,
    remotes: extra.noRemote ? undefined : [{ type: 'streamable-http', url: `https://${name.replace(/\W/g, '')}.example/mcp` }] },
  _meta: { [META]: { status: 'active', isLatest: true, updatedAt: '2026-11-20T10:00:00Z', ...meta } },
});

// A pretend MCP Registry with two pages, and a pretend ERC-8004 index.
function fakeFetch(calls = []) {
  const pages = {
    '': { servers: [mcp('com.example/weather', { title: 'Weather Bot' }), mcp('com.example/local-only', { noRemote: true }),
      mcp('io.github.robd-hub/agent-report-card', { title: 'Agent Report Card' })], metadata: { nextCursor: 'p2' } },
    p2: { servers: [mcp('io.github.robd-hub/cheap-first', { title: 'Cheap First', website: 'https://cheap-first.vercel.app' }),
      mcp('com.example/old', {}, { isLatest: false }), mcp('com.example/sums', { title: 'Sums <b>' })], metadata: {} },
  };
  return async (url, init) => {
    calls.push(String(url));
    const u = new URL(url);
    let body;
    if (u.host === 'registry.modelcontextprotocol.io') body = pages[u.searchParams.get('cursor') ?? ''];
    else if (u.host === 'gateway.thegraph.com') {
      const { variables } = JSON.parse(init.body);
      body = { data: { agents: variables.after ? [] : u.pathname.includes(ERC8004_CHAINS.base.subgraph) ? [
        { id: '8453:7', agentId: '7', updatedAt: '1763600000', registrationFile: { name: 'Chain Helper', description: 'Helps on chain', a2aEndpoint: 'https://helper.example/a2a', x402Support: true, active: true } },
        { id: '8453:8', agentId: '8', updatedAt: '1763600000', registrationFile: null },
      ] : [] } };
    }
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body };
  };
}

async function start(fetchFn, extraConfig = {}) {
  const db = await connect();
  const app = createApp({ db, config: { ...config, ...extraConfig }, fetchFn, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, opts = {}) => {
    const res = await fetch(base + path, { redirect: 'manual', ...opts });
    return { status: res.status, text: await res.text() };
  };
  return { db, req, close: () => server.close() };
}

test('registry entries are read into the shape we store', () => {
  const row = fromMcp(mcp('com.example/weather', { title: 'Weather Bot' }));
  assert.equal(row.name, 'Weather Bot');
  assert.equal(row.endpoint, 'https://comexampleweather.example/mcp');
  assert.equal(row.keep, true);
  assert.equal(fromMcp(mcp('com.example/local', { noRemote: true })).keep, false, 'not hosted, so it cannot be tested');
  assert.equal(fromMcp(mcp('com.example/x', {}, { isLatest: false })), null, 'older versions are skipped, not taken out');
  assert.equal(fromMcp(mcp('com.example/x', {}, { status: 'deleted' })).keep, false);
  const chain = fromErc8004({ agentId: '9', registrationFile: { name: 'A', description: 'B', active: true } }, ERC8004_CHAINS.base);
  assert.equal(chain.source_id, '8453:9');
  assert.equal(chain.chain, 'Base');
  assert.equal(fromErc8004({ agentId: '10', registrationFile: null }, ERC8004_CHAINS.base).keep, false);
});

test('our own agents are matched, and the grader itself is never listed as untested', () => {
  const [cf, arc, other] = prepare([fromMcp(mcp('io.github.robd-hub/cheap-first', { title: 'Cheap First' })),
    fromMcp(mcp('io.github.robd-hub/agent-report-card', { title: 'Agent Report Card' })), fromMcp(mcp('com.example/weather'))]);
  assert.equal(cf.tested_id, 'cheap-first');
  assert.equal(arc.keep, false);
  assert.equal(other.tested_id, null);
  assert.equal(prepare([fromMcp(mcp('io.github.someone/coder', { title: 'Coder' }))])[0].tested_id, null, 'a shared name is not a match');
  const badges = listedOn(agentById('cheap-first'), [{ source: 'erc8004', source_id: '8453:5', chain: 'Base' }]);
  assert.ok(badges.some((b) => b.name === 'Official MCP Registry'));
  assert.ok(badges.some((b) => b.name === 'Concordium registry'));
  assert.equal(badges.filter((b) => b.name === 'ERC-8004 registry').length, 1, 'no duplicate badge');
});

test('sync copies the MCP Registry, skips ERC-8004 without a key, and the /listed page shows them', async (t) => {
  const calls = [];
  const s = await start(fakeFetch(calls));
  t.after(s.close);
  const report = await syncDirectories({ db: s.db, config, fetchFn: fakeFetch(calls) });
  assert.deepEqual(report.map((r) => [r.source, r.done]), [['mcp', true], ['erc8004', false]]);
  assert.match(report[1].skipped, /GRAPH_API_KEY/);
  assert.ok(!calls.some((c) => c.includes('thegraph')));

  const page = await s.req('/listed');
  assert.equal(page.status, 200);
  assert.match(page.text, /Weather Bot/);
  assert.match(page.text, /Sums &lt;b&gt;/, 'names are escaped');
  assert.doesNotMatch(page.text, /local-only|com\.example\/old|robd-hub\/agent-report-card/);
  assert.doesNotMatch(page.text, /Cheap First<\/a>/, 'tested agents stay in the graded directory');
  assert.match(page.text, /get-polly-tested\?agent=https%3A%2F%2Fcomexampleweather\.example%2Fmcp/);
  assert.match((await s.req('/listed?q=weather')).text, /1 agent matching/);
  assert.doesNotMatch((await s.req('/listed?q=weather')).text, /Sums/);
  assert.match((await s.req('/listed?q=%25')).text, /No agents match/, 'wildcards are searched literally');
  assert.match((await s.req('/listed?source=erc8004')).text, /No agents match|Nothing synced/);

  // The tested agent's page shows where else it is listed.
  const cf = await s.req('/agents/cheap-first');
  assert.match(cf.text, /Also listed on/);
  assert.match(cf.text, /NEAR AI Agent Market/);
  assert.match((await s.req('/agents')).text, /href="\/listed"/);

  // The next run only asks for what changed since the first full copy.
  calls.length = 0;
  await syncDirectories({ db: s.db, config, fetchFn: fakeFetch(calls) });
  assert.ok(calls[0].includes('updated_since='));
});

test('ERC-8004 is read when a Graph key is set; a run that hits its time limit carries on next time', async (t) => {
  const s = await start(fakeFetch());
  t.after(s.close);
  const cfg = { ...config, graphApiKey: 'k', erc8004Chains: ['base'] };
  const first = await syncDirectories({ db: s.db, config: cfg, fetchFn: fakeFetch(), budgetMs: -1 });
  assert.equal(first[1].done, false, 'out of time before ERC-8004');
  const second = await syncDirectories({ db: s.db, config: cfg, fetchFn: fakeFetch() });
  assert.equal(second[0].done, true);
  assert.equal(second[1].done, true);
  const page = await s.req('/listed?source=erc8004');
  assert.match(page.text, /Chain Helper/);
  assert.match(page.text, /ERC-8004 · Base/);
  assert.match(page.text, /x402/);
  assert.doesNotMatch(page.text, /Agent 8\b/, 'empty registrations are skipped');
});

test('a registry that is down does not break the run', async (t) => {
  const s = await start(fakeFetch());
  t.after(s.close);
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const report = await syncDirectories({ db: s.db, config, fetchFn: down });
  assert.match(report[0].error, /503/);
  assert.equal((await s.req('/listed')).status, 200);
});

test('the sync is admin-only or needs the cron secret', async (t) => {
  const s = await start(fakeFetch(), { cronSecret: 'cs' });
  t.after(s.close);
  assert.equal((await s.req('/admin/directories')).status, 401);
  assert.equal((await s.req('/api/cron/directories')).status, 401);
  const cron = await s.req('/api/cron/directories', { headers: { authorization: 'Bearer cs' } });
  assert.equal(cron.status, 200);
  assert.match((await s.req('/admin/directories', { headers: admin })).text, /Official MCP Registry/);
  const run = await s.req('/admin/directories/sync', { method: 'POST', headers: admin });
  assert.match(run.text, /Up to date/);
});

test('an entry deleted from a registry is taken out here too', async () => {
  const db = await connect();
  const row = (status) => prepare([fromMcp(mcp('com.example/gone', { title: 'Gone' }, { status }))]);
  await db.listed.save(row('active'));
  assert.equal((await db.listed.search({ query: 'Gone' })).total, 1);
  assert.deepEqual(await db.listed.save(row('deleted')), { saved: 0, removed: 1 });
  assert.equal((await db.listed.search({ query: 'Gone' })).total, 0);
  await db.close();
});
