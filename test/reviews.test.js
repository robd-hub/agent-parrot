import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { cleanReview, ownAgent, combineSummaries, LIMITS } from '../src/reviews.js';
import { displayName, stars } from '../src/review-views.js';
import { fromMcp, prepare } from '../src/directories.js';

const config = { baseUrl: 'http://localhost', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: { clientId: 'h', clientSecret: 'hs' } };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };
const NAMES = { ada: ['Ada', 'Lovelace'], bob: ['Bob', 'Smith'], cy: ['Cy', 'Jones'], di: ['Di', 'Brown'], robd: ['Rob', 'Doughty'] };

async function start() {
  const db = await connect();
  // The sign-in "code" picks who signs in, and is also their GitHub login.
  const fetchProfile = async (provider, { code }) => ({ id: `github:${code}`, name: NAMES[code].join(' '), given_name: NAMES[code][0], family_name: NAMES[code][1],
    email: `${code}@example.com`, email_verified: true, github_login: code === 'robd' ? 'robd-hub' : code });
  const app = createApp({ db, config, fetchProfile, getHeadlines: async () => [], writeStories: null, sendEmail: null });
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
      return { status: res.status, location: res.headers.get('location'), text: await res.text(), cache: res.headers.get('cache-control') };
    };
    return { req };
  };
  const member = async (who, { join = true } = {}) => {
    const c = client();
    const go = await c.req('/auth/github');
    await c.req(`/auth/github/callback?code=${who}&state=${new URL(go.location).searchParams.get('state')}`);
    if (join) await c.req('/join', { method: 'POST', form: { consent: 'yes', role: 'builder' } });
    return c;
  };
  return { db, client, member, close: () => server.close() };
}

test('review text is tidied and checked', () => {
  assert.deepEqual(cleanReview({ stars: '4', body: '  Great   agent.\r\n\r\n\r\n\r\nWould use again.  ' }), { stars: 4, body: 'Great agent.\n\nWould use again.' });
  assert.equal(cleanReview({ stars: '0' }).error, 'stars');
  assert.equal(cleanReview({ stars: '6' }).error, 'stars');
  assert.equal(cleanReview({ stars: '3.5' }).error, 'stars');
  assert.equal(cleanReview({ stars: 'x' }).error, 'stars');
  assert.equal(cleanReview({ stars: 5, body: 'a'.repeat(1001) }).error, 'long');
  assert.equal(cleanReview({ stars: 5, body: 'https://a.example https://b.example www.c.example' }).error, 'links');
  // Invisible direction-flipping characters are taken out.
  assert.equal(cleanReview({ stars: 5, body: 'ok‮good​' }).body, 'okgood');
  assert.deepEqual(cleanReview({ stars: 2 }), { stars: 2, body: '' });
});

test('names are shortened, makers are spotted, averages combine', () => {
  assert.equal(displayName({ name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace' }), 'Ada L.');
  assert.equal(displayName({ name: 'Bob van Smith' }), 'Bob S.');
  assert.equal(displayName({ name: 'Cher' }), 'Cher');
  assert.equal(displayName({ name: '' }), 'Member');
  assert.ok(ownAgent({ github_login: 'Robd-Hub' }, 'github:robd-hub'));
  assert.ok(!ownAgent({ github_login: 'ada' }, 'github:robd-hub'));
  assert.ok(!ownAgent({}, 'github:robd-hub'));
  assert.deepEqual(combineSummaries([{ count: 1, avg: 5 }, { count: 3, avg: 1 }, undefined]), { count: 4, avg: 2 });
  assert.deepEqual(combineSummaries([]), { count: 0, avg: null });
  assert.match(stars(4.5), /width:90%/);
});

test('members review an agent once, can change and delete it, and see it on pages', async (t) => {
  const s = await start();
  t.after(s.close);
  const visitor = s.client();
  let page = await visitor.req('/agents/coder');
  assert.match(page.text, /Member reviews/);
  assert.match(page.text, /Sign in to review/);
  assert.match(page.text, /No member reviews yet/);
  assert.match(page.text, /kept apart from the Polly Tested grade/);
  assert.match(page.cache, /public/);

  // Not signed in, or not joined: sent to sign in or join.
  assert.equal((await visitor.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '5' } })).location, '/signin');
  const half = await s.member('di', { join: false });
  assert.equal((await half.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '5' } })).location, '/join');

  const ada = await s.member('ada');
  page = await ada.req('/agents/coder');
  assert.match(page.text, /Write a review/);
  assert.match(page.cache, /private/);
  let r = await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '4', body: 'Solid <script>alert(1)</script> helper.' } });
  assert.equal(r.location, '/agents/coder?review=saved#reviews');
  page = await ada.req('/agents/coder?review=saved');
  assert.match(page.text, /Thanks! Your review is up/);
  assert.match(page.text, /Edit your review/);
  assert.ok(!page.text.includes('<script>alert(1)</script>'));
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page.text, /Ada L\./);
  assert.ok(!page.text.includes('ada@example.com'));

  // Posting again changes the same review, it never adds a second one.
  await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '2', body: 'Changed my mind.' } });
  const bob = await s.member('bob');
  await bob.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '5' } });
  assert.deepEqual(await s.db.reviews.summaries(['coder']), { coder: { count: 2, avg: 3.5 } });
  page = await visitor.req('/agents/coder');
  assert.match(page.text, /3\.5<\/b> from 2 member reviews/);
  assert.match(page.text, /Changed my mind/);
  assert.ok(!page.text.includes('Solid'));

  // Bad input comes back with a message, not an error page.
  assert.equal((await bob.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '9' } })).location, '/agents/coder?review=stars#reviews');
  assert.match((await bob.req('/agents/coder?review=stars')).text, /Please pick from 1 to 5 stars/);
  assert.equal((await bob.req('/reviews', { method: 'POST', form: { ref: 'nope', stars: '3' } })).status, 404);

  // Directory cards and compare show the average.
  assert.match((await visitor.req('/agents')).text, /★ 3\.5 <span class="muted">\(2\)/);
  const cmp = await visitor.req('/compare?a=coder&b=general-assistant');
  assert.match(cmp.text, /Member reviews/);
  assert.match(cmp.text, /from 2 reviews/);
  assert.match(cmp.text, /No member reviews yet/);
  assert.ok(!/cmp-win[^>]*>[^<]*<span class="tag tag-pass cmp-badge">Better<\/span> <span class="stars/.test(cmp.text), 'no "Better" with under 3 reviews');

  // Deleting.
  r = await ada.req('/reviews/delete', { method: 'POST', form: { ref: 'coder' } });
  assert.equal(r.location, '/agents/coder?review=deleted#reviews');
  assert.deepEqual(await s.db.reviews.summaries(['coder']), { coder: { count: 1, avg: 5 } });

  // Removing your membership removes your reviews.
  await bob.req('/remove', { method: 'POST' });
  assert.deepEqual(await s.db.reviews.summaries(['coder']), {});
});

test('makers cannot review their own agent', async (t) => {
  const s = await start();
  t.after(s.close);
  const rob = await s.member('robd');
  assert.match((await rob.req('/agents/cheap-first')).text, /You made this agent/);
  assert.equal((await rob.req('/reviews', { method: 'POST', form: { ref: 'cheap-first', stars: '5' } })).location, '/agents/cheap-first?review=own#reviews');
  assert.deepEqual(await s.db.reviews.summaries(['cheap-first']), {});
});

test('reports hide a review after three, rate limits hold, and the organiser can put it back', async (t) => {
  const s = await start();
  t.after(s.close);
  const ada = await s.member('ada');
  await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '1', body: 'Buy cheap pills' } });
  const [{ id }] = await s.db.reviews.list('coder', null);
  const visitor = s.client();
  assert.match((await visitor.req('/agents/coder')).text, /Buy cheap pills/);
  // Visitors and the author get no report button; other members do.
  assert.ok(!(await visitor.req('/agents/coder')).text.includes('/report'));
  assert.ok(!(await ada.req('/agents/coder')).text.includes(`/reviews/${id}/report`));
  for (const who of ['bob', 'cy', 'di']) {
    const m = await s.member(who);
    assert.match((await m.req('/agents/coder')).text, new RegExp(`/reviews/${id}/report`));
    const r = await m.req(`/reviews/${id}/report`, { method: 'POST', form: { reason: 'spam' } });
    assert.equal(r.location, '/agents/coder?review=reported#reviews');
    // Reporting twice counts once.
    await m.req(`/reviews/${id}/report`, { method: 'POST', form: { reason: 'spam' } }).catch(() => {});
    if (who === 'bob') assert.match((await visitor.req('/agents/coder')).text, /Buy cheap pills/);
  }
  assert.ok(!(await visitor.req('/agents/coder')).text.includes('Buy cheap pills'));
  assert.deepEqual(await s.db.reviews.summaries(['coder']), {});
  // The author still sees it, marked hidden.
  assert.match((await ada.req('/agents/coder')).text, /Hidden from others while Polly looks/);

  // The organiser's page lists it first, and can show it again.
  assert.equal((await visitor.req('/admin/reviews')).status, 401);
  const adminPage = await visitor.req('/admin/reviews', { headers: admin });
  assert.match(adminPage.text, /Buy cheap pills/);
  assert.match(adminPage.text, /<b class="bad">3<\/b>/);
  await visitor.req(`/admin/reviews/${id}/show`, { method: 'POST', headers: admin });
  assert.match((await visitor.req('/agents/coder')).text, /Buy cheap pills/);
  await visitor.req(`/admin/reviews/${id}/delete`, { method: 'POST', headers: admin });
  assert.deepEqual(await s.db.reviews.list('coder', null), []);

  // Rate limit: saves per member per hour, even when deleting and posting again.
  for (let i = 0; i < LIMITS.savesPerHour; i++) await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: String((i % 5) + 1) } });
  assert.equal((await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '3' } })).location, '/agents/coder?review=slow#reviews');
  await ada.req('/reviews/delete', { method: 'POST', form: { ref: 'coder' } });
  assert.equal((await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '3' } })).location, '/agents/coder?review=slow#reviews');

  // Forms from other sites are refused.
  assert.equal((await ada.req('/reviews', { method: 'POST', form: { ref: 'coder', stars: '3' }, headers: { origin: 'https://evil.example' } })).status, 403);
});

test('listed agents take reviews too, shown on /listed cards and maker pages, and move to the tested page once matched', async (t) => {
  const s = await start();
  t.after(s.close);
  const META = 'io.modelcontextprotocol.registry/official';
  const entry = { server: { name: 'io.github.acme/weather', description: 'Weather', version: '1.0.0', repository: { url: 'https://github.com/acme/weather' },
    remotes: [{ type: 'streamable-http', url: 'https://weather.example/mcp' }] }, _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z' } } };
  await s.db.listed.save(prepare([fromMcp(entry)]));
  const path = '/listed/mcp/io.github.acme/weather';
  const visitor = s.client();
  assert.match((await visitor.req(path)).text, /Sign in to review/);
  const ada = await s.member('ada');
  const r = await ada.req('/reviews', { method: 'POST', form: { ref: 'mcp:io.github.acme/weather', stars: '4', body: 'Handy.' } });
  assert.equal(r.location, `${path}?review=saved#reviews`);
  assert.match((await visitor.req(path)).text, /Handy\./);
  assert.match((await visitor.req('/listed')).text, /★ 4\.0/);
  const maker = await visitor.req('/makers/github/acme');
  assert.match(maker.text, /What members say/);
  assert.match(maker.text, /1 review of 1 agent/);
  assert.match(maker.text, /Not counted in the maker reputation score/);
  // With one agent reviewed, the card shows that agent's rating only, not a second maker tag.
  assert.ok(!(await visitor.req('/listed')).text.includes('Maker ★'));
  // Once the listing is matched to a tested agent, its reviews move to that agent.
  await s.db.listed.save(prepare([{ ...fromMcp(entry), tested_id: 'coder' }]).map((x) => ({ ...x, tested_id: 'coder' })));
  await s.db.reviews.adopt();
  assert.deepEqual(await s.db.reviews.summaries(['coder', 'mcp:io.github.acme/weather']), { coder: { count: 1, avg: 4 } });
});

test("a maker's page puts all their agents' reviews together, apart from the reputation score", async (t) => {
  const s = await start();
  t.after(s.close);
  const META = 'io.modelcontextprotocol.registry/official';
  // Cheap First is Rob's tested agent (github:robd-hub in data/agent-facts.json); this listing is his too.
  const entry = { server: { name: 'io.github.robd-hub/notes', description: 'Notes', version: '1.0.0', repository: { url: 'https://github.com/robd-hub/notes' },
    remotes: [{ type: 'streamable-http', url: 'https://notes.example/mcp' }] }, _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z' } } };
  await s.db.listed.save(prepare([fromMcp(entry)]));
  const visitor = s.client();
  const before = await visitor.req('/makers/github/robd-hub');
  assert.match(before.text, /No member reviews of their agents yet/);
  const score = (html) => /class="rep-score[^"]*">(\d+)</.exec(html)[1];

  const ada = await s.member('ada');
  const bob = await s.member('bob');
  await ada.req('/reviews', { method: 'POST', form: { ref: 'cheap-first', stars: '5', body: 'Saved me money.' } });
  await ada.req('/reviews', { method: 'POST', form: { ref: 'mcp:io.github.robd-hub/notes', stars: '3' } });
  await bob.req('/reviews', { method: 'POST', form: { ref: 'mcp:io.github.robd-hub/notes', stars: '4', body: 'Tidy notes.' } });

  const all = await s.db.reviews.makerSummaries(['github:robd-hub'], { 'github:robd-hub': ['cheap-first'] });
  assert.deepEqual(all['github:robd-hub'], { count: 3, avg: 4, members: 2, agents: 2, dist: [0, 0, 1, 1, 1] });

  const page = await visitor.req('/makers/github/robd-hub');
  assert.match(page.text, /id="maker-reviews"/);
  assert.match(page.text, /review-avg">4\.0</);
  assert.match(page.text, /3 reviews of 2 agents<br>from 2 members/);
  assert.match(page.text, /Saved me money\./);
  assert.match(page.text, /href="\/agents\/cheap-first#reviews">Cheap First</);
  assert.match(page.text, /href="\/listed\/mcp\/io\.github\.robd-hub\/notes#reviews">notes</);
  assert.match(page.text, /Only a few members so far/);
  assert.match(page.text, /Not counted in the maker reputation score/);
  assert.equal(score(page.text), score(before.text), 'reviews never change the reputation score');

  // Compact versions: agent pages and directory cards.
  assert.match((await visitor.req('/agents/cheap-first')).text, /4\.0<\/b> member rating across this maker's agents, from 3 reviews of 2 agents\./);
  assert.match((await visitor.req('/listed/mcp/io.github.robd-hub/notes')).text, /member rating across this maker's agents/);
  assert.match((await visitor.req('/agents')).text, /Maker ★ 4\.0 <span class="muted">\(3\)/);
  assert.match((await visitor.req('/listed')).text, /Maker ★ 4\.0/);

  // Hidden reviews drop out of the combined rating too.
  const [hide] = (await s.db.reviews.forMaker('github:robd-hub', ['cheap-first'])).filter((r) => r.stars === 5);
  await s.db.reviews.setHidden(hide.id, true);
  const after = await s.db.reviews.makerSummaries(['github:robd-hub'], { 'github:robd-hub': ['cheap-first'] });
  assert.deepEqual(after['github:robd-hub'], { count: 2, avg: 3.5, members: 2, agents: 1, dist: [0, 0, 1, 1, 0] });
  assert.ok(!(await visitor.req('/makers/github/robd-hub')).text.includes('Saved me money'));
});
