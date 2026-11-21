import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { fromMcp, fromErc8004, mcpMaker, prepare, fetchErc8004Page, ERC8004_CHAINS } from '../src/directories.js';
import { makerReputation, testedDetails } from '../src/makers.js';
import { agentById } from '../src/agents.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const META = 'io.modelcontextprotocol.registry/official';
const WALLET = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';

const mcp = (name, server = {}, meta = {}) => ({
  server: { name, description: `${name} does things`, version: '1.2.0', remotes: [{ type: 'streamable-http', url: `https://${name.replace(/\W/g, '')}.example/mcp` }], ...server },
  _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-20T10:00:00Z', ...meta } },
});
const chainAgent = (id, extra = {}) => ({
  id: `8453:${id}`, agentId: String(id), owner: WALLET, createdAt: '1760000000', updatedAt: '1763600000', totalFeedback: '3',
  agentURI: 'ipfs://bafyexample/agent.json',
  registrationFile: { name: `Chain Helper ${id}`, description: 'Helps on chain', a2aEndpoint: 'https://helper.example/a2a', a2aVersion: '0.3', x402Support: true, active: true,
    ens: 'helper.eth', supportedTrusts: ['reputation'], a2aSkills: ['swap'], mcpTools: [] },
  ...extra,
});

async function start() {
  const db = await connect();
  const app = createApp({ db, config, fetchFn: fetch, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path) => {
    const res = await fetch(base + path, { redirect: 'manual' });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };
  return { db, req, close: () => server.close() };
}

test('makers come from checked MCP names and ERC-8004 owner wallets', () => {
  assert.deepEqual(mcpMaker('io.github.Some-One/tool'), { maker_key: 'github:some-one', maker_name: 'Some-One', maker_url: 'https://github.com/Some-One' });
  assert.equal(mcpMaker('com.acme.labs/tool').maker_key, 'web:labs.acme.com');
  assert.equal(mcpMaker('nonsense').maker_key, null);

  const row = fromMcp(mcp('com.acme/weather', { repository: { url: 'https://github.com/acme/weather' }, packages: [{ registryType: 'npm', identifier: '@acme/weather', version: '1.2.0' }],
    remotes: [{ type: 'sse', url: 'https://w.example/sse', headers: [{ name: 'Authorization', isSecret: true }] }] }));
  assert.equal(row.maker_name, 'acme.com');
  assert.equal(row.first_published_at, '2026-11-10T00:00:00Z');
  assert.deepEqual(row.details.transports, ['sse']);
  assert.equal(row.details.packages[0].id, '@acme/weather');
  assert.equal(row.details.needsKey, true);
  assert.equal(row.url, 'https://github.com/acme/weather', 'the repo stands in for a missing website');

  const chain = fromErc8004(chainAgent(7), ERC8004_CHAINS.base);
  assert.equal(chain.maker_key, `wallet:${WALLET.toLowerCase()}`);
  assert.equal(chain.maker_url, `https://basescan.org/address/${WALLET.toLowerCase()}`);
  assert.equal(chain.first_published_at, new Date(1760000000 * 1000).toISOString());
  assert.equal(chain.details.registration, 'https://ipfs.io/ipfs/bafyexample/agent.json');
  assert.equal(chain.details.a2a.version, '0.3');
  assert.equal(chain.details.feedback, 3);
});

test('an older ERC-8004 index without the extra fields falls back to the basic query', async () => {
  const queries = [];
  const fetchFn = async (url, init) => {
    const { query } = JSON.parse(init.body);
    queries.push(query);
    const body = query.includes('createdAt') ? { errors: [{ message: 'Type `Agent` has no field `createdAt`' }] } : { data: { agents: [chainAgent(9, { createdAt: undefined })] } };
    return { ok: true, status: 200, json: async () => body };
  };
  const page = await fetchErc8004Page({ fetchFn, apiKey: 'k', chain: ERC8004_CHAINS.base });
  assert.equal(page.rows[0].name, 'Chain Helper 9');
  assert.equal(queries.length, 2);
});

test('maker reputation: grades earn most of it, trust signals the rest, bulk wallets lose points', () => {
  const now = new Date('2026-11-21T00:00:00Z');
  const tested = [{ score: 98, honesty: 'passed' }];
  const proven = makerReputation({ key: 'github:a', stats: { agents: 1, sources: 1, since: '2026-01-01T00:00:00Z', feedback: 0 }, tested, places: 8, now });
  assert.equal(proven.score, 69 + 10 + 5 + 5);
  assert.equal(proven.label, 'Trusted');
  const unproven = makerReputation({ key: 'wallet:0x1', stats: { agents: 2, sources: 1, since: '2026-11-01T00:00:00Z', feedback: 4 }, now });
  assert.equal(unproven.score, 5);
  assert.equal(makerReputation({ key: 'wallet:0x1', stats: { agents: 2, checked: 2, up: 1 }, now }).score, 5, 'half answering earns the uptime points');
  assert.equal(unproven.label, 'Unproven');
  const liar = makerReputation({ key: 'github:b', stats: { agents: 1 }, tested: [{ score: 60, honesty: 'failed' }], now });
  assert.equal(liar.score, 42 - 10 + 10);
  const bulk = makerReputation({ key: 'wallet:0x2', stats: { agents: 500, sources: 1, since: '2025-01-01T00:00:00Z', feedback: 0 }, now });
  assert.equal(bulk.score, 0);
  assert.ok(bulk.bulk);
});

test('tested agents show who made them, or say why it is not known', () => {
  const cf = testedDetails(agentById('cheap-first'));
  assert.equal(cf.maker.name, 'Agent Report Card team');
  assert.match(cf.pricing, /x402/);
  const openserv = testedDetails(agentById('coder'));
  assert.equal(openserv.maker, null);
  assert.match(openserv.makerNote, /sign-in/);
  assert.equal(openserv.platform, 'OpenServ marketplace');
  assert.equal(testedDetails(agentById('serv-baseline')).model, 'gpt-5.4-mini', 'the model comes from the grade data');
});

test('listed agents and makers get their own pages', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.db.listed.save(prepare([
    fromMcp(mcp('io.github.robd-hub/cheap-first', { title: 'Cheap First', websiteUrl: 'https://cheap-first.vercel.app', repository: { url: 'https://github.com/robd-hub/cheap-first' } })),
    fromMcp(mcp('com.acme/weather', { title: 'Weather <Bot>' })),
    fromMcp(mcp('com.acme/sums', { title: 'Sums' })),
    fromErc8004(chainAgent(7), ERC8004_CHAINS.base),
  ]));
  // A newer version does not make it look newer than it is.
  await s.db.listed.save(prepare([fromMcp(mcp('com.acme/weather', { title: 'Weather <Bot>' }, { publishedAt: '2026-11-19T00:00:00Z' }))]));
  assert.equal(new Date((await s.db.listed.get('mcp', 'com.acme/weather')).first_published_at).toISOString(), '2026-11-10T00:00:00.000Z');

  const list = await s.req('/listed');
  assert.match(list.text, /href="\/listed\/mcp\/com\.acme\/weather"/);
  assert.match(list.text, /by <a href="\/makers\/web\/acme\.com">acme\.com<\/a> \(\+1 more\)/);

  const page = await s.req('/listed/mcp/com.acme/weather');
  assert.equal(page.status, 200);
  assert.match(page.text, /Weather &lt;Bot&gt;/);
  assert.match(page.text, /checked by the registry/);
  assert.match(page.text, /10 November 2026/);
  assert.match(page.text, /MCP over streamable-http/);
  assert.match(page.text, /Not published: neither registry asks for it/);
  assert.match(page.text, /More from acme\.com/);
  assert.match(page.text, /Unproven/);

  const chain = await s.req('/listed/erc8004/8453:7');
  assert.match(chain.text, /Registered on chain/);
  assert.match(chain.text, /helper\.eth/);
  assert.match(chain.text, /basescan\.org\/address/);
  assert.match(chain.text, /3 entries/);

  assert.equal((await s.req('/listed/mcp/io.github.robd-hub/cheap-first')).location, '/agents/cheap-first', 'tested agents go to their graded page');
  assert.equal((await s.req('/listed/mcp/nope/x')).status, 404);
  assert.equal((await s.req('/listed/bogus/x')).status, 404);

  const maker = await s.req('/makers/web/acme.com');
  assert.equal(maker.status, 200);
  assert.match(maker.text, /Sums/);
  assert.match(maker.text, /Nothing tested yet/);
  assert.match((await s.req(`/makers/wallet/${WALLET}`)).text, /not who they are/);
  assert.equal((await s.req('/makers/web/nobody.example')).status, 404);
  assert.equal((await s.req('/makers/evil/x')).status, 404);

  // Our own maker has a tested agent, so a real reputation, and the agent page shows its key details.
  const own = await s.req('/makers/github/robd-hub');
  assert.match(own.text, /Trusted|Solid/);
  assert.match(own.text, /href="\/agents\/cheap-first"/);
  const cf = await s.req('/agents/cheap-first');
  assert.match(cf.text, /Key details/);
  assert.match(cf.text, /Agent Report Card team/);
  assert.match(cf.text, /href="\/makers\/github\/robd-hub"/);
  assert.match(cf.text, /Maker reputation/);
  const coder = await s.req('/agents/coder');
  assert.match(coder.text, /doesn&#39;t show who made its agents/);
  assert.match(coder.text, /Not published by the maker or the marketplace/);
});
