import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { weekOf, addWeeks, lastFullWeek, isWeek, gradeMoves, buildDigest, linkedinText, headline, runWeekly, quietWeek } from '../src/digest.js';

const DAY = 864e5;
const config = { baseUrl: 'https://agentparrot.example', sessionSecret: 's', adminPassword: 'pw', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };
const admin = { Authorization: `Basic ${Buffer.from('rob:pw').toString('base64')}` };

const run = (date, score, grade, provisional = false) => ({ date: `${date}T09:00:00.000Z`, score, grade, provisional });
const AGENTS = [
  { id: 'climber', name: 'Climber', history: [run('2026-11-05', 80, 'B'), run('2026-11-18', 93, 'A')] },
  { id: 'faller', name: 'Faller', history: [run('2026-11-04', 75, 'C'), run('2026-11-17', 61, 'D')] },
  { id: 'steady', name: 'Steady', history: [run('2026-11-04', 88, 'B'), run('2026-11-20', 88, 'B')] },
  { id: 'newbie', name: 'Newbie', ownAgent: true, history: [run('2026-11-16', 98, 'A'), run('2026-11-18', 98, 'A')] },
  { id: 'old', name: 'Old', history: [run('2026-11-04', 70, 'C')] },
  { id: 'maybe', name: 'Maybe', history: [run('2026-11-04', 70, 'C'), run('2026-11-19', 20, 'F', true)] },
];

test('weeks start on Monday, UTC', () => {
  assert.equal(weekOf('2026-11-22T23:59:00Z'), '2026-11-16'); // a Sunday
  assert.equal(weekOf('2026-11-16T00:00:00Z'), '2026-11-16'); // a Monday
  assert.equal(weekOf('2026-11-15T12:00:00Z'), '2026-11-09');
  assert.equal(addWeeks('2026-11-16', 1), '2026-11-23');
  assert.equal(addWeeks('2026-12-28', 1), '2027-01-04');
  assert.equal(lastFullWeek(new Date('2026-11-23T07:00:00Z')), '2026-11-16');
  assert.equal(isWeek('2026-11-16'), true);
  assert.equal(isWeek('2026-11-17'), false, 'not a Monday');
  assert.equal(isWeek('../etc'), false);
});

test('grade moves come from the history, provisional runs left out', () => {
  const m = gradeMoves(AGENTS, '2026-11-16');
  assert.deepEqual(m.gains.map((a) => [a.id, a.from, a.score, a.change, a.fromGrade, a.grade]), [['climber', 80, 93, 13, 'B', 'A']]);
  assert.deepEqual(m.drops.map((a) => [a.id, a.change]), [['faller', -14]]);
  assert.deepEqual(m.steady.map((a) => a.id), ['steady']);
  assert.deepEqual(m.fresh.map((a) => [a.id, a.score, a.runs, a.own]), [['newbie', 98, 2, true]]);
  assert.deepEqual(m.top.map((a) => a.id), ['newbie', 'climber', 'steady']);
  // The week before: everything was new then, nothing moved.
  const before = gradeMoves(AGENTS, '2026-11-02');
  assert.deepEqual(before.fresh.map((a) => a.id).sort(), ['climber', 'faller', 'maybe', 'old', 'steady']);
  assert.equal(before.gains.length + before.drops.length, 0);
});

test('a digest and its LinkedIn text are built from the facts', async (t) => {
  const db = await connect();
  t.after(() => db.close());
  const d = await buildDigest({ db, week: '2026-11-16', agents: AGENTS, live: true });
  assert.equal(headline(d), 'Faller drops 14 points', 'the bigger move leads');
  assert.deepEqual(d.counts, { gains: 1, drops: 1, steady: 1, fresh: 1, retested: 3 });
  assert.equal(d.health.checked, 0);
  const post = linkedinText(d, { url: 'https://agentparrot.example/digest/2026-11-16' });
  assert.match(post, /week of 16 November 2026/);
  assert.match(post, /Climber: 80 → 93 \(\+13\), B to A/);
  assert.match(post, /Faller: 75 → 61 \(-14\), C to D/);
  assert.match(post, /Newbie: A, 98 \(our own agent, for the record\)/);
  assert.match(post, /Top of the Pecking Order: Newbie \(98\), Climber \(93\), Steady \(88\)/);
  assert.match(post, /Full digest: https:\/\/agentparrot\.example\/digest\/2026-11-16/);
  assert.doesNotMatch(post, /Maybe/, 'provisional runs never make the post');
  assert.ok(post.length < 3000);
  // A week with nothing in it.
  const empty = await buildDigest({ db, week: '2027-03-01', agents: AGENTS, live: false });
  assert.equal(quietWeek(empty), true);
  assert.equal(headline(empty), 'A quiet week on the perch');
});

test('the weekly run keeps last week, fills in earlier weeks, and shows on the site and in admin', async (t) => {
  const db = await connect();
  // "Now" is a week ahead, so last week is the real current week and today's reviews and checks fall in it.
  const now = () => new Date(Date.now() + 7 * DAY);
  const app = createApp({ db, config, now, getHeadlines: async () => [], writeStories: null, sendEmail: null, fetchFn: async () => { throw new Error('no network in tests'); } });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });
  const week = weekOf(new Date());

  // Two listed agents: one that answered once and then didn't, one that has always answered.
  const row = (id, name) => ({ source: 'mcp', source_id: id, name, endpoint: `https://${id}/mcp`, keep: true, first_published_at: new Date().toISOString() });
  await db.listed.save([row('com.quiet/one', 'Quiet One'), row('com.fine/two', 'Fine Two')]);
  await db.listed.saveHealth([{ source: 'mcp', source_id: 'com.quiet/one', up: true }, { source: 'mcp', source_id: 'com.fine/two', up: true }]);
  await db.listed.saveHealth([{ source: 'mcp', source_id: 'com.quiet/one', up: false }]);
  // Two member reviews of a tested agent this week.
  for (const who of ['ada', 'bob']) {
    const id = await db.recordLogin({ id: `github:${who}`, name: who });
    await db.reviews.save('coder', id, who === 'ada' ? 5 : 4, '');
  }

  assert.equal((await get('/api/cron/digest')).status, 200);
  const kept = await db.digest.get(week);
  assert.ok(kept, 'last week is kept');
  assert.equal(kept.content.live, true);
  assert.equal(kept.content.reviews.total, 2);
  assert.equal(kept.content.reviews.top[0].name, 'Coder');
  assert.equal(kept.content.reviews.top[0].avg, 4.5);
  assert.equal(kept.content.newListed, 2);
  assert.deepEqual(kept.content.health.newlyDown.map((a) => a.name), ['Quiet One']);
  assert.equal(kept.content.health.newlyDown[0].uptime, 50);
  // Earlier weeks with grades in them were filled in from the history, without health checks.
  const weeks = await db.digest.weeks();
  assert.ok(weeks.includes('2026-11-16') || week === '2026-11-16');
  assert.ok(weeks.includes('2026-11-09'));
  assert.equal((await db.digest.get('2026-11-09')).content.health, null);

  // A second call the same week does nothing.
  const again = await (await get('/api/cron/digest')).json();
  assert.equal(again.built, false);

  // Next week: Quiet One answers again and shows as back up; nothing new went quiet.
  await db.listed.saveHealth([{ source: 'mcp', source_id: 'com.quiet/one', up: true }]);
  const next = await runWeekly({ db, now: new Date(Date.now() + 14 * DAY) });
  assert.equal(next.built, true);
  const later = (await db.digest.get(addWeeks(week, 1))).content;
  assert.deepEqual(later.health.backUp.map((a) => a.name), ['Quiet One']);
  assert.equal(later.health.newlyDownCount, 0);
  assert.equal(later.health.comparedWithLastWeek, true);

  const archive = await (await get('/digest')).text();
  assert.match(archive, /Top movers/);
  assert.match(archive, /Past weeks/);
  const page = await (await get(`/digest/${week}`)).text();
  assert.match(page, /Member reviews/);
  assert.match(page, /Quiet One/);
  assert.match(page, /Share on LinkedIn/);
  assert.equal((await get('/digest/2026-11-17')).status, 404);
  assert.equal((await get('/digest/nope')).status, 404);
  assert.equal((await get('/digest/2020-01-06')).status, 404);
  assert.match(await (await get('/sitemap.xml')).text(), new RegExp(`/digest/${week}`));

  // Admin: locked, then the LinkedIn text with a copy button. Previews aren't kept.
  assert.equal((await get('/admin/digest')).status, 401);
  const adminPage = await (await get('/admin/digest', admin)).text();
  assert.match(adminPage, /Copy LinkedIn text/);
  assert.match(adminPage, /Agent Parrot top movers: week of/);
  assert.match(adminPage, new RegExp(`Full digest: https://agentparrot.example/digest/${week}`));
  const before = (await db.digest.weeks()).length;
  const preview = await fetch(`${base}/admin/digest/preview`, { method: 'POST', headers: admin });
  assert.match(await preview.text(), /This week so far/);
  assert.equal((await db.digest.weeks()).length, before);
  const rebuilt = await fetch(`${base}/admin/digest/build`, { method: 'POST', headers: admin });
  assert.match(await rebuilt.text(), /Built the digest/);
});
