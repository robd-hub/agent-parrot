import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { roundsFor, gameNumber, poolSize, ROUNDS_PER_DAY } from '../src/game.js';
import { peckingOrder, allAgents } from '../src/agents.js';
import { writeStories } from '../src/hallucination.js';

const config = {
  baseUrl: 'http://localhost', sessionSecret: 'test-secret', adminPassword: 'pw', graderUrl: 'https://grader.example',
  linkedin: {}, google: { clientId: 'g', clientSecret: 'gs' }, github: { clientId: 'h', clientSecret: 'hs' },
  adminEmail: 'admin@example.com',
};
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };

async function start(overrides = {}) {
  const db = await connect();
  const sent = [];
  const app = createApp({
    db, config: { ...config, ...overrides.config },
    getHeadlines: async () => [
      { title: 'Lab launches agent that books meetings', link: 'https://news.example/1', source: 'News', summary: 'An agent.', date: new Date() },
      { title: 'New coding assistant ships', link: 'https://news.example/2', source: 'News', summary: 'Code.', date: new Date(Date.now() - 864e5) },
    ],
    writeStories: async () => ({ stories: [
      { pick: 1, headline: 'Agent books 400 meetings with itself', body: 'Para one.\n\nPara two.', agent: 'general-assistant' },
      { pick: 2, headline: 'Coding assistant refactors the office plant', body: 'It was fine.', agent: 'not-a-real-agent' },
    ] }),
    sendEmail: async (m) => sent.push(m),
    fetchProfile: async (provider) => ({ id: `${provider}:42`, name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace', email: 'ada@example.com', email_verified: true }),
    ...overrides.routes,
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  const req = async (path, { method = 'GET', form, headers = {}, json } = {}) => {
    const h = { ...headers, cookie: headers.cookie ?? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    let body;
    if (form) (h['content-type'] = 'application/x-www-form-urlencoded'), (body = new URLSearchParams(form).toString());
    if (json) (h['content-type'] = 'application/json'), (body = JSON.stringify(json));
    const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text: await res.text() };
  };
  return { db, req, sent, close: () => server.close() };
}

test('public pages load', async (t) => {
  const s = await start();
  t.after(s.close);
  for (const p of ['/', '/agents', '/agents/coder', '/pecking-order', '/pecking-order?category=writing', '/news', '/game', '/articles',
    '/articles/how-the-polly-test-works', '/get-polly-tested', '/signin', '/signup', '/privacy', '/squawk', '/sitemap.xml', '/robots.txt']) {
    assert.equal((await s.req(p)).status, 200, p);
  }
  assert.equal((await s.req('/agents/nope')).status, 404);
  assert.equal((await s.req('/articles/nope')).status, 404);
});

test('light and dark mode, with a toggle in the top bar', async (t) => {
  const { req, close } = await start();
  t.after(close);
  const css = await req('/style.css');
  assert.match(css.text, /:root\[data-theme="dark"\]/);
  assert.match(css.text, /color-scheme: dark/);
  assert.equal((await req('/theme.js')).status, 200);
  const home = await req('/');
  assert.match(home.text, /data-theme-toggle/);
  assert.match(home.text, /localStorage\.getItem\('theme'\)/);
  // Light unless someone picks dark: the device's dark setting doesn't switch it.
  assert.doesNotMatch(home.text, /prefers-color-scheme/);
});

test('signed out, the top bar has Sign in and Sign up; each page links to the other', async (t) => {
  const { req, close } = await start();
  t.after(close);
  const home = await req('/');
  assert.match(home.text, /href="\/signin"[^>]*>Sign in</);
  assert.match(home.text, /href="\/signup"[^>]*>Sign up</);
  const signup = await req('/signup');
  assert.equal(signup.status, 200);
  assert.match(signup.text, /<h1>Join the flock<\/h1>/);
  assert.match(signup.text, /href="\/signin">Sign in</);
  const signin = await req('/signin');
  assert.match(signin.text, /<h1>Sign in to Agent Parrot<\/h1>/);
  assert.match(signin.text, /href="\/signup">Sign up free</);
});

test('the home page leads with every agent in a ranked table, filterable by category', async (t) => {
  const { req, close } = await start();
  t.after(close);
  const home = await req('/');
  assert.equal(home.status, 200);
  for (const a of allAgents()) assert.ok(home.text.includes(`href="/agents/${a.id}"`), a.id);
  assert.match(home.text, /class="agent-table"/);
  const one = peckingOrder().find((a) => a.category === 'writing');
  const writing = await req('/?category=writing');
  assert.ok(writing.text.includes(`href="/agents/${one.id}"`));
  const notWriting = allAgents().find((a) => a.category !== 'writing' && a.honesty !== 'failed' && !peckingOrder().slice(0, 3).some((x) => x.id === a.id));
  assert.ok(!writing.text.includes(`href="/agents/${notWriting.id}"`));
  assert.ok(home.text.includes('href="https://cheap-first.vercel.app/"'), 'From the makers links Cheap First');
  assert.ok((await req('/agents/cheap-first')).text.includes('Visit the agent'));
  const odd = await req('/?category=%3Cscript%3E');
  assert.equal(odd.status, 200);
});

test('every agent page and article link points at a real agent', async (t) => {
  const s = await start();
  t.after(s.close);
  const ids = new Set(allAgents().map((a) => a.id));
  for (const p of ['/articles/we-tested-33-agents', '/articles/ask-it-something-it-cant-know', '/articles/agents-that-wont-stop-talking',
    '/articles/the-plain-assistant-beat-the-research-agents']) {
    for (const [, id] of (await s.req(p)).text.matchAll(/href="\/agents\/([a-z0-9-]+)"/g)) assert.ok(ids.has(id), `${p} links to ${id}`);
  }
});

test('the Pecking Order shares places on ties and is sorted', () => {
  const rows = peckingOrder();
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].score <= rows[i - 1].score);
    if (rows[i].score === rows[i - 1].score) assert.equal(rows[i].place, rows[i - 1].place);
  }
  assert.ok(peckingOrder('writing').every((a) => a.category === 'writing'));
});

test('the game gives the same three rounds to everyone each day, with the answer on either side', () => {
  const a = roundsFor('2026-11-21');
  assert.equal(a.length, ROUNDS_PER_DAY);
  assert.deepEqual(a, roundsFor('2026-11-21'));
  assert.equal(gameNumber('2026-11-20'), 1);
  for (const r of a) assert.ok([0, 1].includes(r.wrong) && r.answers.length === 2);
  // No round repeats within a cycle.
  const perCycle = Math.floor(poolSize() / ROUNDS_PER_DAY);
  const seen = new Set();
  for (let d = 0; d < perCycle; d++) {
    const day = new Date(Date.parse('2026-11-20T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);
    for (const r of roundsFor(day)) assert.ok(!seen.has(r.id), r.id), seen.add(r.id);
  }
});

test('the game page cannot be broken out of by answer text', async (t) => {
  const s = await start();
  t.after(s.close);
  const html = (await s.req('/game')).text;
  const json = html.match(/<script type="application\/json" id="game-data">([\s\S]*?)<\/script>/)[1];
  assert.ok(!json.includes('<'));
  assert.equal(JSON.parse(json).rounds.length, ROUNDS_PER_DAY);
});

test('satire only keeps known agents for the Polly box', async () => {
  const stories = await writeStories({
    candidates: [{ title: 'a', link: 'https://x/1', source: 'S' }, { title: 'b', link: 'https://x/2', source: 'S' }],
    agents: [{ id: 'coder', name: 'Coder', description: 'codes' }],
    write: async () => ({ stories: [{ pick: 1, headline: 'H1', body: 'B1', agent: 'coder' }, { pick: 2, headline: 'H2', body: 'B2', agent: 'made-up' }, { pick: 2, headline: 'dup', body: 'x', agent: '' }] }),
  });
  assert.equal(stories.length, 2);
  assert.equal(stories[0].agent_id, 'coder');
  assert.equal(stories[1].agent_id, null);
});

test('the daily run starts paused, then writes stories with a Polly box once resumed', async (t) => {
  const s = await start();
  t.after(s.close);
  assert.deepEqual(JSON.parse((await s.req('/api/cron/hallucination')).text), { paused: true, created: 0 });
  assert.equal((await s.req('/admin/news/resume', { method: 'POST', headers: admin })).status, 303);
  assert.equal(JSON.parse((await s.req('/api/cron/hallucination')).text).created, 2);
  // A second call the same day writes nothing.
  assert.equal(JSON.parse((await s.req('/api/cron/hallucination')).text).created, 0);
  const news = (await s.req('/news')).text;
  assert.match(news, /Agent books 400 meetings with itself/);
  assert.match(news, /class="polly-box"[\s\S]*General Assistant/);
  const [story] = await s.db.stories.latest();
  await s.req(`/admin/news/${story.id}/hide`, { method: 'POST', headers: admin });
  assert.doesNotMatch((await s.req('/news')).text, /400 meetings/);
});

test('the Daily Hallucination is split by day, newest first', async (t) => {
  const s = await start();
  t.after(s.close);
  // Before any stories: the real headlines, under Today and Yesterday.
  let news = (await s.req('/news')).text;
  assert.match(news, /class="day-heading"><span>Today<\/span>[\s\S]*books meetings[\s\S]*<span>Yesterday<\/span>[\s\S]*coding assistant ships/);
  // With stories from two days, each day gets its own heading.
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await s.db.stories.replaceDay(yesterday, [{ headline: 'Old parrot news', body: 'Squawk.', source: 'News', source_title: 'T', source_link: 'https://news.example/old' }]);
  await s.req('/admin/news/resume', { method: 'POST', headers: admin });
  await s.req('/api/cron/hallucination');
  news = (await s.req('/news')).text;
  assert.match(news, /<span>Today<\/span>[\s\S]*400 meetings[\s\S]*<span>Yesterday<\/span>[\s\S]*Old parrot news/);
});

test('admin pages need the password', async (t) => {
  const s = await start();
  t.after(s.close);
  for (const p of ['/admin', '/admin/news', '/admin/squawk', '/admin/listings']) {
    assert.equal((await s.req(p)).status, 401, p);
    assert.equal((await s.req(p, { headers: admin })).status, 200, p);
  }
});

test('sign in with GitHub, join, keep a streak, invite, then remove yourself', async (t) => {
  const s = await start();
  t.after(s.close);
  const go = await s.req('/auth/github');
  assert.equal(go.status, 302);
  assert.match(go.location, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  const state = new URL(go.location).searchParams.get('state');
  assert.equal((await s.req(`/auth/github/callback?code=abc&state=wrong`)).status, 400);
  const back = await s.req(`/auth/github/callback?code=abc&state=${state}`);
  assert.equal(back.location, '/join');
  assert.equal((await s.req('/join', { method: 'POST', form: { role: 'builder' } })).status, 400); // no consent
  const done = await s.req('/join', { method: 'POST', form: { role: 'builder', squawk: 'yes', consent: 'yes' } });
  assert.equal(done.location, '/me');
  const member = await s.db.get('github:42');
  assert.equal(member.role, 'builder');
  assert.equal(member.squawk_optin, true);
  assert.equal(member.member_number, 1);
  const me = await s.req('/me');
  assert.match(me.text, /Founding member #1/);
  const res = JSON.parse((await s.req('/api/game', { method: 'POST', json: { correct: 2 } })).text);
  assert.equal(res.streak, 1);
  assert.equal((await s.req('/api/game', { method: 'POST', json: { correct: 9 } })).status, 400);
  // Signing in with Google using the same verified email lands on the same account.
  const g = await s.req('/auth/google');
  const gState = new URL(g.location).searchParams.get('state');
  assert.equal((await s.req(`/auth/google/callback?code=x&state=${gState}`)).location, '/me');
  assert.equal(await s.db.count(), 1);
  assert.equal((await s.req('/remove', { method: 'POST' })).status, 200);
  assert.equal(await s.db.count(), 0);
});

test('signing in from an agent page brings you back to it, after joining if you are new', async (t) => {
  const s = await start();
  t.after(s.close);
  await s.req('/signin?next=%2Fclaim%3Fref%3Dcoder');
  const go = await s.req('/auth/github');
  const state = new URL(go.location).searchParams.get('state');
  assert.equal((await s.req(`/auth/github/callback?code=abc&state=${state}`)).location, '/join');
  const me = await s.req('/me');
  assert.equal(me.location, '/join');
  assert.equal((await s.req('/join', { method: 'POST', form: { consent: 'yes' } })).location, '/claim?ref=coder');
  // Used once: the next sign-in goes to the perch as usual.
  const again = await s.req('/auth/google');
  const gState = new URL(again.location).searchParams.get('state');
  assert.equal((await s.req(`/auth/google/callback?code=x&state=${gState}`)).location, '/me');
  // A perch with no claimed agent shows a builder where to start.
  assert.match((await s.req('/me')).text, /Built an agent\?/);
  // Only paths on this site are followed.
  for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
    await s.req(`/signin?next=${encodeURIComponent(bad)}`);
  }
  assert.equal((await s.req('/signin?next=%2F%2Fevil.example')).location, '/me');
});

test('one person signing in two ways gets one account', async () => {
  const db = await connect();
  const a = await db.recordLogin({ id: 'github:1', name: 'Ada', email: 'ada@example.com', email_verified: true });
  const b = await db.recordLogin({ id: 'google:9', name: 'Ada L', email: 'ADA@example.com', email_verified: true });
  assert.equal(a, 'github:1');
  assert.equal(b, 'github:1');
  assert.equal(await db.memberForEmail('ada@example.com'), 'github:1');
  assert.equal(await db.memberForEmail('new@example.com'), 'email:new@example.com');
});

test('sign in by email: link, confirm, name required for email members', async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.req('/auth/email', { method: 'POST', form: { email: 'nope' } })).status, 400);
  await s.req('/auth/email', { method: 'POST', form: { email: 'bob@example.com' } });
  const token = new URL(s.sent[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  assert.match((await s.req(`/auth/email/verify?token=${token}`)).text, /Sign me in/);
  assert.equal((await s.req('/auth/email/verify', { method: 'POST', form: { token } })).location, '/join');
  assert.equal((await s.req('/auth/email/verify', { method: 'POST', form: { token } })).status, 400); // used up
  assert.equal((await s.req('/join', { method: 'POST', form: { consent: 'yes' } })).status, 400);
  assert.equal((await s.req('/join', { method: 'POST', form: { name: 'Bob Smith', consent: 'yes' } })).location, '/me');
  assert.equal((await s.db.get('email:bob@example.com')).first_name, 'Bob');
});

test('suggesting an agent needs a member, then the organiser lists it', async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.req('/agents/suggest', { method: 'POST', form: { name: 'X', url: 'https://x.example' } })).location, '/signin');
  const go = await s.req('/auth/github');
  await s.req(`/auth/github/callback?code=a&state=${new URL(go.location).searchParams.get('state')}`);
  await s.req('/join', { method: 'POST', form: { consent: 'yes' } });
  assert.equal((await s.req('/agents/suggest', { method: 'POST', form: { name: 'X', url: 'ftp://bad' } })).status, 400);
  assert.equal((await s.req('/agents/suggest', { method: 'POST', form: { name: 'Mystery Agent', url: 'https://mystery.example', category: 'research' } })).status, 303);
  assert.doesNotMatch((await s.req('/agents')).text, /Mystery Agent/);
  const [l] = await s.db.listings.all();
  await s.req(`/admin/listings/${l.id}/list`, { method: 'POST', headers: admin });
  assert.match((await s.req('/agents')).text, /Not Polly Tested yet[\s\S]*Mystery Agent/);
});

test('forms from another site are refused', async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.req('/logout', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
});

test('The Squawk: draft, test send, send once, unsubscribe', async (t) => {
  const s = await start();
  t.after(s.close);
  const go = await s.req('/auth/github');
  await s.req(`/auth/github/callback?code=a&state=${new URL(go.location).searchParams.get('state')}`);
  await s.req('/join', { method: 'POST', form: { consent: 'yes', squawk: 'yes' } });
  const draft = await s.req('/admin/squawk', { method: 'POST', headers: admin });
  const id = draft.location.split('/').pop();
  assert.match((await s.req(`/admin/squawk/${id}`, { headers: admin })).text, /The Pecking Order this week/);
  await s.req(`/admin/squawk/${id}/test`, { method: 'POST', headers: admin });
  assert.match(s.sent.at(-1).subject, /^\[TEST\]/);
  await s.req(`/admin/squawk/${id}/send`, { method: 'POST', headers: admin, form: { confirm: 'yes' } });
  await s.req(`/admin/squawk/${id}/send`, { method: 'POST', headers: admin, form: { confirm: 'yes' } });
  const real = s.sent.filter((m) => m.to === 'ada@example.com');
  assert.equal(real.length, 1);
  const unsub = real[0].headers['List-Unsubscribe'].slice(1, -1).replace('http://localhost', '');
  assert.equal((await s.req(unsub, { method: 'POST' })).status, 200);
  assert.equal((await s.db.get('github:42')).squawk_optin, false);
  assert.equal((await s.req(`/squawk/${id}`)).status, 200);
});

test('the menu and footer reach every part of the site, and the home page says untested agents are listed too', async (t) => {
  const s = await start();
  t.after(s.close);
  const home = await s.req('/');
  const nav = /<nav aria-label="Main">([\s\S]*?)<\/nav>/.exec(home.text)[1];
  for (const href of ['/agents', '/listed', '/pecking-order', '/compare', '/get-polly-tested']) assert.match(nav, new RegExp(`href="${href}"`), href);
  const footer = /<footer[\s\S]*<\/footer>/.exec(home.text)[0];
  for (const href of ['/listed', '/compare', '/request', '/peek']) assert.match(footer, new RegExp(`href="${href}"`), href);
  assert.doesNotMatch(home.text, /Every AI agent here has been/);
  assert.match(home.text, /AI agents, <em>Polly Tested<\/em>/);
});

test('layout: footer columns, the Pecking Order call to action and every tested agent in the Compare picker', async (t) => {
  const s = await start();
  t.after(s.close);
  const home = await s.req('/');
  const footer = /<footer[\s\S]*<\/footer>/.exec(home.text)[0];
  for (const h of ['Agents', 'Get tested', 'Read', 'About']) assert.match(footer, new RegExp(`<h2>${h}</h2>`), h);
  assert.equal((home.text.match(/class="pecking-mini"/g) || []).length, 2);
  const pecking = await s.req('/pecking-order');
  assert.match(pecking.text, /class="card cta-card list-cta"[\s\S]*href="\/get-polly-tested"[\s\S]*href="\/peek"/);
  const pick = (await s.req('/compare?a=coder')).text;
  for (const a of allAgents().filter((x) => x.id !== 'coder')) assert.match(pick, new RegExp(`compare\\?a=coder&amp;b=${a.id}"`), a.id);
  for (const g of new Set(allAgents().map((a) => a.grade))) assert.match(pick, new RegExp(`Grade ${g} `), g);
});

test('signed-out visitors get cached pages; signed-in members never do', async (t) => {
  const s = await start();
  t.after(s.close);
  for (const p of ['/', '/agents', '/agents?category=writing', '/pecking-order']) {
    const r = await s.req(p);
    assert.match(r.headers.get('cache-control'), /^public, s-maxage=\d+/, p);
    // No Vary: Cookie. Vercel's CDN stops caching anything that varies on cookies.
    assert.doesNotMatch(r.headers.get('vary') ?? '', /Cookie/i, p);
  }
  const go = await s.req('/auth/github');
  await s.req(`/auth/github/callback?code=abc&state=${new URL(go.location).searchParams.get('state')}`);
  for (const p of ['/', '/agents', '/pecking-order']) assert.equal((await s.req(p)).headers.get('cache-control'), 'private, no-store', p);
});

test('members get a browser-readable marker and are never served a cacheable page; signed-out copies reload fresh for them', async (t) => {
  const s = await start();
  t.after(s.close);
  const out = await s.req('/listed');
  assert.match(out.text, /<html lang="en" data-signed-in="0">/);
  assert.match(out.text, /_fresh/); // the reload-for-members script is on every page
  const go = await s.req('/auth/github');
  const back = await s.req(`/auth/github/callback?code=abc&state=${new URL(go.location).searchParams.get('state')}`);
  assert.ok(back.headers.getSetCookie().some((c) => /^ap_m=1;/.test(c) && !/HttpOnly/i.test(c)), 'marker set on sign-in');
  for (const p of ['/', '/listed', '/compare', '/digest', '/agents/coder', '/api/grades.json']) {
    const r = await s.req(p);
    assert.equal(r.headers.get('cache-control'), 'private, no-store', p);
  }
  assert.match((await s.req('/agents/coder')).text, /data-signed-in="1"/);
  const bye = await s.req('/logout', { method: 'POST' });
  assert.ok(bye.headers.getSetCookie().some((c) => /^ap_m=;/.test(c)), 'marker cleared on sign-out');
});

test('a stale member marker without a session is cleared', async (t) => {
  const s = await start();
  t.after(s.close);
  const r = await s.req('/agents', { headers: { cookie: 'ap_m=1' } });
  assert.ok(r.headers.getSetCookie().some((c) => /^ap_m=;/.test(c)));
});
