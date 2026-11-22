import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { proofTargets, githubRepo, claimToken, badgeFor, findToken } from '../src/claims.js';
import { badgeSvg } from '../src/claim-views.js';
import { fromMcp, prepare } from '../src/directories.js';
import { agentById } from '../src/agents.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', contactEmail: 'hello@example.com', linkedin: {}, google: {}, github: { clientId: 'h', clientSecret: 'hs' } };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };
const NAMES = { ada: ['Ada', 'Lovelace'], bob: ['Bob', 'Smith'], robd: ['Rob', 'Doughty'] };
const META = 'io.modelcontextprotocol.registry/official';
const mcp = (name, server = {}) => ({
  server: { name, description: `${name} does things`, version: '1.0.0', remotes: [{ type: 'streamable-http', url: `https://${name.replace(/\W/g, '')}.example/mcp` }], ...server },
  _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-20T10:00:00Z' } },
});
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

async function start() {
  const db = await connect();
  const files = new Map(); // address -> text the fake web serves
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(String(url));
    if (files.has(String(url))) return new Response(files.get(String(url)), { status: 200 });
    return new Response('nope', { status: url.endsWith('/mcp') ? 503 : 404 });
  };
  const fetchProfile = async (provider, { code }) => ({ id: `github:${code}`, name: NAMES[code].join(' '), given_name: NAMES[code][0], family_name: NAMES[code][1],
    email: `${code}@example.com`, email_verified: true, github_login: code === 'robd' ? 'robd-hub' : code });
  const app = createApp({ db, config, fetchProfile, fetchFn, lookup: publicLookup, getHeadlines: async () => [], writeStories: null, sendEmail: null });
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
      return { status: res.status, location: res.headers.get('location'), text: await res.text(), type: res.headers.get('content-type'), cache: res.headers.get('cache-control') };
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
  await db.listed.save(prepare([
    fromMcp(mcp('io.github.ada/weather')),
    fromMcp(mcp('com.acme/search', { repository: { url: 'https://github.com/acme/search' } })),
  ]));
  return { db, files, fetched, client, member, close: () => server.close() };
}

test('proof comes only from what the listing names', () => {
  const t = proofTargets({ makerKeys: ['github:ada', 'web:acme.com', null], urls: ['https://api.acme.com/mcp', 'https://github.com/acme/x', 'ftp://x.example', 'not a url'], repos: ['https://github.com/acme/search.git', 'https://gitlab.com/x/y'] });
  assert.deepEqual(t, { logins: ['ada'], hosts: ['acme.com', 'api.acme.com'], repos: ['https://github.com/acme/search'] });
  assert.deepEqual(githubRepo('https://github.com/robd-hub/cheap-first/'), { owner: 'robd-hub', repo: 'cheap-first', url: 'https://github.com/robd-hub/cheap-first' });
  assert.equal(githubRepo('https://github.com/robd-hub'), null);
  // The code is the same each time for one member and agent, and different for anyone or anything else.
  assert.equal(claimToken('s', 'github:ada', 'mcp:x'), claimToken('s', 'github:ada', 'mcp:x'));
  assert.notEqual(claimToken('s', 'github:ada', 'mcp:x'), claimToken('s', 'github:bob', 'mcp:x'));
  assert.notEqual(claimToken('s', 'github:ada', 'mcp:x'), claimToken('s', 'github:ada', 'mcp:y'));
  assert.match(claimToken('s', 'a', 'b'), /^agent-parrot-verify=[0-9a-f]{32}$/);
});

test('a code on a private address is never fetched', async () => {
  const calls = [];
  const found = await findToken({ hosts: ['intranet.example'], repos: [] }, 'x', { fetchFn: async (u) => (calls.push(u), new Response('x')), lookup: async () => [{ address: '10.0.0.5', family: 4 }] });
  assert.equal(found, null);
  assert.deepEqual(calls, []);
});

test('badges only say what was measured', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  assert.deepEqual(badgeFor({ tested: { grade: 'A', score: 98 } }, now), { message: 'Polly Tested · A · Squawk 98', colour: 'green' });
  assert.deepEqual(badgeFor({ row: { checked_at: '2026-11-21T09:00:00Z', up: true, health: {} } }, now), { message: 'Claimed · Up · checked 21 Nov', colour: 'green' });
  assert.equal(badgeFor({ row: { checked_at: '2026-11-21T09:00:00Z', up: false, health: {} } }, now).colour, 'red');
  assert.deepEqual(badgeFor({ row: { checked_at: '2026-10-01T09:00:00Z', up: true } }, now), { message: 'Claimed', colour: 'blue' }, 'an old check is not shown');
  assert.deepEqual(badgeFor({ row: null }, now), { message: 'Claimed', colour: 'blue' });
  const svg = badgeSvg({ message: '<b>&', colour: 'green' });
  assert.match(svg, /^<svg /);
  assert.ok(!svg.includes('<b>&'));
});

test('builders claim with GitHub or a code, get a tick, a badge and a basic check', async (t) => {
  const s = await start();
  t.after(s.close);
  const ref = 'mcp:io.github.ada/weather';
  const visitor = s.client();
  let page = await visitor.req('/listed/mcp/io.github.ada/weather');
  assert.match(page.text, /Is this yours\? Claim it/);
  page = await visitor.req(`/claim?ref=${encodeURIComponent(ref)}`);
  assert.match(page.text, /Sign in to claim/);
  assert.equal((await visitor.req(`/badge.svg?ref=${encodeURIComponent(ref)}`)).status, 404, 'no badge before a claim');
  assert.equal((await visitor.req('/claim?ref=mcp:nope')).status, 404);
  assert.equal((await visitor.req('/claim', { method: 'POST', form: { ref, method: 'github' } })).location, '/signin');

  // Sign-in matching: Ada's GitHub login is the one the registry checked.
  const ada = await s.member('ada');
  page = await ada.req('/me');
  assert.match(page.text, /We found an agent that looks like yours/);
  assert.match(page.text, /Claim io\.github\.ada\/weather|Claim weather/);
  page = await ada.req(`/claim?ref=${encodeURIComponent(ref)}`);
  assert.match(page.text, /Claim it now/);
  let r = await ada.req('/claim', { method: 'POST', form: { ref, method: 'github' } });
  assert.equal(r.location, `/claim?ref=${encodeURIComponent(ref)}&claim=claimed`);
  page = await ada.req(r.location);
  assert.match(page.text, /It&#39;s yours|It's yours/);
  assert.match(page.text, /Your badge/);
  assert.match(page.text, /badge\.svg\?ref=mcp%3Aio\.github\.ada%2Fweather/);
  assert.match(page.text, /\?from=badge/);
  assert.match(page.text, /Get Polly Tested to take your place/);
  assert.match(page.text, /never whether it&#39;s <b>good<\/b>|never whether it's <b>good<\/b>/);
  assert.match((await visitor.req('/listed/mcp/io.github.ada/weather')).text, /✓ Claimed by its maker/);
  const badge = await visitor.req(`/badge.svg?ref=${encodeURIComponent(ref)}`);
  assert.equal(badge.status, 200);
  assert.match(badge.type, /image\/svg\+xml/);
  assert.match(badge.text, /Claimed/);
  assert.match((await ada.req('/me')).text, /Your agents/);
  assert.ok(!(await ada.req('/me')).text.includes('looks like yours'), 'no longer offered once claimed');

  // The free basic check, and its time limit.
  r = await ada.req('/claim/check', { method: 'POST', form: { ref } });
  assert.equal(r.location, `/claim?ref=${encodeURIComponent(ref)}&claim=checked`);
  assert.match((await ada.req(r.location)).text, /<b>Down<\/b>/);
  assert.match((await ada.req('/claim/check', { method: 'POST', form: { ref } })).location, /claim=slow/);
  assert.match((await visitor.req(`/badge.svg?ref=${encodeURIComponent(ref)}`)).text, /Claimed · Down/);

  // One owner: Bob can't take it, and can't run its check.
  const bob = await s.member('bob');
  assert.match((await bob.req('/claim', { method: 'POST', form: { ref, method: 'code' } })).location, /claim=taken/);
  assert.match((await bob.req('/claim/check', { method: 'POST', form: { ref } })).location, /claim=notyours/);
  assert.match((await bob.req(`/claim?ref=${encodeURIComponent(ref)}`)).text, /Wrong%20claim/);

  // A website listing: GitHub doesn't prove it, the code on the registry-checked domain does.
  const acme = 'mcp:com.acme/search';
  assert.match((await bob.req('/claim', { method: 'POST', form: { ref: acme, method: 'github' } })).location, /claim=github/);
  page = await bob.req(`/claim?ref=${encodeURIComponent(acme)}`);
  assert.match(page.text, /https:\/\/acme\.com\/\.well-known\/agent-parrot\.txt/);
  assert.match(page.text, /agent-parrot\.txt<\/code> at the top of/);
  const token = claimToken(config.sessionSecret, 'github:bob', acme);
  assert.ok(page.text.includes(token));
  assert.match((await bob.req('/claim', { method: 'POST', form: { ref: acme, method: 'code' } })).location, /claim=notfound/);
  // Ada's code doesn't work for Bob.
  s.files.set('https://acme.com/.well-known/agent-parrot.txt', claimToken(config.sessionSecret, 'github:ada', acme));
  assert.match((await bob.req('/claim', { method: 'POST', form: { ref: acme, method: 'code' } })).location, /claim=notfound/);
  s.files.set('https://raw.githubusercontent.com/acme/search/HEAD/agent-parrot.txt', `hello\n${token}\n`);
  assert.match((await bob.req('/claim', { method: 'POST', form: { ref: acme, method: 'code' } })).location, /claim=claimed/);
  assert.equal((await s.db.claims.get(acme)).method, 'repo');
  assert.ok(s.fetched.every((u) => !u.includes('github.com/acme/search/')), 'repo files are read from raw.githubusercontent.com only');

  // The organiser sees and removes claims; owners can give one up.
  assert.equal((await visitor.req('/admin/claims')).status, 401);
  page = await visitor.req('/admin/claims', { headers: admin });
  assert.match(page.text, /mcp:com\.acme\/search/);
  assert.match(page.text, /bob@example\.com/);
  await visitor.req('/admin/claims/remove', { method: 'POST', form: { ref: acme }, headers: admin });
  assert.equal(await s.db.claims.get(acme), undefined);
  assert.match((await ada.req('/claim/release', { method: 'POST', form: { ref } })).location, /claim=released/);
  assert.equal(await s.db.claims.get(ref), undefined);
  assert.match((await visitor.req('/listed/mcp/io.github.ada/weather')).text, /Is this yours\? Claim it/);
});

test('a Polly Tested agent is claimed on its own page and its badge shows the grade', async (t) => {
  const s = await start();
  t.after(s.close);
  const cf = agentById('cheap-first');
  const rob = await s.member('robd');
  assert.match((await rob.req('/claim', { method: 'POST', form: { ref: 'cheap-first', method: 'github' } })).location, /claim=claimed/);
  const visitor = s.client();
  assert.match((await visitor.req('/agents/cheap-first')).text, /✓ Claimed by its maker/);
  assert.match((await visitor.req('/agents/coder')).text, /Is this yours\? Claim it/);
  assert.match((await visitor.req('/badge.svg?ref=cheap-first')).text, new RegExp(`Polly Tested · ${cf.grade} · Squawk ${cf.score}`));
  assert.match((await rob.req('/claim?ref=cheap-first')).text, /Get retested/);
  // Someone else's GitHub account can't claim it.
  const ada = await s.member('ada');
  assert.match((await ada.req('/claim', { method: 'POST', form: { ref: 'coder', method: 'github' } })).location, /claim=github|claim=taken/);
});

test('only the member who claimed a tested agent (and admin) can open its findings report', async (t) => {
  const s = await start();
  t.after(s.close);
  const visitor = s.client();
  const before = await visitor.req('/agents/cheap-first/findings');
  assert.equal(before.status, 403);
  assert.match(before.text, /Claim it/);
  const rob = await s.member('robd');
  await rob.req('/claim', { method: 'POST', form: { ref: 'cheap-first', method: 'github' } });
  const mine = await rob.req('/agents/cheap-first/findings');
  assert.equal(mine.status, 200);
  assert.match(mine.text, /Only you can see this page/);
  assert.match(mine.cache, /no-store/);
  const ada = await s.member('ada');
  const theirs = await ada.req('/agents/cheap-first/findings');
  assert.equal(theirs.status, 403);
  assert.match(theirs.text, /Only the member who claimed this agent/);
  assert.equal((await visitor.req('/admin/findings/coder')).status, 401);
  assert.match((await visitor.req('/admin/findings/coder', { headers: admin })).text, /Findings report/);
  assert.equal((await visitor.req('/agents/nobody/findings')).status, 404);
  assert.match((await visitor.req('/agents/cheap-first')).text, /See your findings report/);
});
