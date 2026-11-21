import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { fromMcp, prepare } from '../src/directories.js';
import { toolPowers, securityFlags, cardFlags } from '../src/security.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const META = 'io.modelcontextprotocol.registry/official';

test('tool powers are read from names and the tools\' own safety notes', () => {
  assert.deepEqual(toolPowers({ name: 'transfer_usdc' }), ['money']);
  assert.deepEqual(toolPowers({ name: 'sendToken' }), ['money']);
  assert.deepEqual(toolPowers({ name: 'send_email' }), ['messages']);
  assert.deepEqual(toolPowers({ name: 'run_python' }), ['code']);
  assert.deepEqual(toolPowers({ name: 'delete_file' }), ['changes']);
  assert.deepEqual(toolPowers({ name: 'get_weather' }), []);
  assert.deepEqual(toolPowers({ name: 'tidy', destructive: true }), ['changes']);
  assert.deepEqual(toolPowers({ name: 'update_cache', readOnly: true }), [], 'a tool that says it only reads is believed');
  assert.deepEqual(toolPowers({ name: 'Swap tokens' }), ['money'], 'A2A skill names work too');
});

test('security flags cover encryption, keys, payment and tool powers, and say when they are unknown', () => {
  const base = { endpoint: 'https://a.example/mcp', checked_at: '2026-11-21', up: true };
  const texts = (r) => securityFlags(r).map((f) => `${f.level}: ${f.text}`);
  assert.deepEqual(texts({ endpoint: 'https://a.example/mcp' }), ['good: Uses HTTPS, so traffic is encrypted', 'info: Tool powers not known yet: not health checked']);
  assert.ok(texts({ endpoint: 'http://a.example/mcp' }).includes('bad: Not encrypted: uses plain HTTP'));
  const risky = texts({ ...base, x402: true, health: { tools: [{ name: 'swap' }, { name: 'send_tweet' }, { name: 'search' }] } });
  assert.ok(risky.includes('info: Open to anyone: no key needed'));
  assert.ok(risky.includes('info: Takes payment (x402)'));
  assert.ok(risky.includes('warn: Moves money or tokens: swap'));
  assert.ok(risky.includes('warn: Sends messages or posts: send_tweet'));
  assert.ok(texts({ ...base, health: { tools: [{ name: 'a', readOnly: true }] } }).includes('good: Every tool says it only reads'));
  assert.ok(texts({ ...base, details: { needsKey: true }, health: { tools: [] } }).includes('info: Needs a key or sign-in to use'));
  assert.deepEqual(cardFlags({ endpoint: 'http://x.example', health: { tools: [{ name: 'execute_command' }] } }).map((f) => f.text), ['No HTTPS', 'Runs code']);
});

test('pages show the security section, card warnings and the grade history chart', async (t) => {
  const db = await connect();
  const app = createApp({ db, config, fetchFn: fetch, getHeadlines: async () => [], writeStories: null, sendEmail: null });
  const server = app.listen(0);
  t.after(() => server.close());
  const get = async (path) => (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).text();
  await db.listed.save(prepare([fromMcp({ server: { name: 'com.bank/wallet', title: 'Wallet Bot', description: 'x', version: '1', remotes: [{ type: 'streamable-http', url: 'https://wallet.example/mcp' }] }, _meta: { [META]: { status: 'active', isLatest: true } } })]));
  await db.listed.saveHealth([{ source: 'mcp', source_id: 'com.bank/wallet', up: true, latency: 120, tools: [{ name: 'transfer_funds', description: 'Send money' }, { name: 'get_balance', readOnly: true }] }]);

  const page = await get('/listed/mcp/com.bank/wallet');
  assert.match(page, /<h2>Security<\/h2>/);
  assert.match(page, /Moves money or tokens: transfer_funds/);
  assert.match(page, /Uses HTTPS/);
  assert.match(await get('/listed'), /tag-mid">Moves money/);

  const coder = await get('/agents/coder');
  assert.match(coder, /Grade history/);
  assert.match(coder, /2 tests since 5 November 2026\. Up 7 points since the first test\./);
  assert.match(coder, /Reached through the OpenServ marketplace/);
  assert.match(await get('/agents/research-agent'), /Tested once so far/);
});
