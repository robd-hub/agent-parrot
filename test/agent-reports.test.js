import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { cleanReport, communityFlags, communityTag, LIMITS } from '../src/agent-reports.js';
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

test('report text is tidied and checked', () => {
  assert.deepEqual(cleanReport({ reason: 'scam', note: '  Took my   money.\r\n\r\n\r\nGone.  ' }), { reason: 'scam', note: 'Took my money.\n\nGone.' });
  assert.deepEqual(cleanReport({ reason: 'broken' }), { reason: 'broken', note: '' });
  assert.equal(cleanReport({ reason: 'nope' }).error, 'reason');
  assert.equal(cleanReport({}).error, 'reason');
  assert.equal(cleanReport({ reason: '__proto__' }).error, 'reason');
  assert.equal(cleanReport({ reason: 'other', note: 'bad' }).error, 'note');
  assert.equal(cleanReport({ reason: 'other', note: 'It deletes files it should not touch' }).reason, 'other');
  assert.equal(cleanReport({ reason: 'scam', note: 'a'.repeat(501) }).error, 'long');
  assert.equal(cleanReport({ reason: 'scam', note: 'https://a.x https://b.x https://c.x www.d.x' }).error, 'links');
  assert.equal(cleanReport({ reason: 'scam', note: 'ok\u202egood\u200b' }).note, 'okgood');
});

test('community flags say they come from members, worst first, and only once checked', () => {
  assert.deepEqual(communityFlags(undefined), []);
  assert.deepEqual(communityFlags({ confirmed: [], open: 2 }), []);
  const f = communityFlags({ confirmed: [{ reason: 'broken', members: 1, last_at: '2026-11-22T10:00:00Z', public_note: '' },
    { reason: 'scam', members: 2, last_at: '2026-11-22T10:00:00Z', public_note: 'Asks for a seed phrase.' }], open: 3 });
  assert.equal(f.length, 3);
  assert.equal(f[0].level, 'bad');
  assert.match(f[0].text, /2 members reported it as a scam or fraud, and Polly checked and agreed .* Asks for a seed phrase\. This comes from members, not from a Polly test\./);
  assert.match(f[1].text, /1 member reported it as broken/);
  assert.equal(f[2].level, 'info');
  assert.match(f[2].text, /3 members have reported a problem that Polly is still checking\. Not confirmed yet\./);
  assert.equal(communityTag({ confirmed: [], open: 9 }), null);
  assert.deepEqual(communityTag({ confirmed: [{ reason: 'broken' }, { reason: 'scam' }] }), { level: 'bad', text: 'Reported: scam' });
});

test('members report an agent once; nothing shows until the organiser confirms; agents are never hidden', async (t) => {
  const s = await start();
  t.after(s.close);
  const visitor = s.client();
  let page = await visitor.req('/agents/coder');
  assert.match(page.text, /id="security"/);
  assert.match(page.text, /Sign in to report this agent/);
  assert.ok(!page.text.includes('action="/agent-reports"'));

  // Not signed in, or not joined.
  assert.equal((await visitor.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'scam' } })).location, '/signin');
  const half = await s.member('di', { join: false });
  assert.equal((await half.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'scam' } })).location, '/join');

  const ada = await s.member('ada');
  page = await ada.req('/agents/coder');
  assert.match(page.text, /Report this agent/);
  assert.match(page.text, /action="\/agent-reports"/);
  assert.match(page.cache, /private/);
  // Bad input comes back with a message.
  assert.equal((await ada.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'other', note: 'hm' } })).location, '/agents/coder?report=note#security');
  assert.match((await ada.req('/agents/coder?report=note')).text, /at least 10 characters/);
  assert.equal((await ada.req('/agent-reports', { method: 'POST', form: { ref: 'nope', reason: 'scam' } })).status, 404);

  let r = await ada.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'scam', note: 'Asked me for my <b>seed</b> phrase' } });
  assert.equal(r.location, '/agents/coder?report=sent#security');
  page = await ada.req('/agents/coder?report=sent');
  assert.match(page.text, /Polly will check this agent/);
  assert.match(page.text, /You reported this agent \(Scam or fraud\)/);
  // One open report per member per agent.
  assert.equal((await ada.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'broken' } })).location, '/agents/coder?report=already#security');
  // Nothing public yet, and the agent is still listed.
  page = await visitor.req('/agents/coder');
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('Community report'));
  assert.match((await visitor.req('/agents')).text, /href="\/agents\/coder"/);

  // The organiser sees it, escaped, with who sent it.
  assert.equal((await visitor.req('/admin/reports')).status, 401);
  let admin1 = await visitor.req('/admin/reports', { headers: admin });
  assert.match(admin1.text, /Asked me for my &lt;b&gt;seed&lt;\/b&gt; phrase/);
  assert.match(admin1.text, /ada@example\.com/);
  assert.match((await visitor.req('/admin', { headers: admin })).text, /Agent reports \(1 open\)/);
  const [{ id }] = await s.db.agentReports.forAdmin();

  // Confirming shows a community flag in Security, on the agent page and in compare.
  await visitor.req(`/admin/reports/${id}/confirm`, { method: 'POST', headers: admin, form: { public_note: 'Confirmed <script>x</script> with the maker.' } });
  page = await visitor.req('/agents/coder');
  assert.match(page.text, /flag-community/);
  assert.match(page.text, /Community report: 1 member reported it as a scam or fraud, and Polly checked and agreed/);
  assert.match(page.text, /This comes from members, not from a Polly test/);
  assert.match(page.text, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.ok(!page.text.includes('<script>x</script>'));
  assert.match((await visitor.req('/compare?a=coder&b=general-assistant')).text, /Community report: 1 member/);
  // Ada can report it again now her first report is closed.
  assert.ok(!(await ada.req('/agents/coder')).text.includes('You reported this agent'));

  // Taking the flag down moves it back to open; dismissing keeps it off the page.
  await visitor.req(`/admin/reports/${id}/reopen`, { method: 'POST', headers: admin });
  assert.ok(!(await visitor.req('/agents/coder')).text.includes('Community report'));
  await visitor.req(`/admin/reports/${id}/dismiss`, { method: 'POST', headers: admin });
  assert.ok(!(await visitor.req('/agents/coder')).text.includes('Community report'));
  admin1 = await visitor.req('/admin/reports', { headers: admin });
  assert.match(admin1.text, /Dismissed/);
  assert.equal((await visitor.req('/admin/reports/999/confirm', { method: 'POST', headers: admin })).status, 404);

  // Reopening a dismissed report is refused when the member has sent a newer open one.
  await ada.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'broken' } });
  r = await visitor.req(`/admin/reports/${id}/reopen`, { method: 'POST', headers: admin });
  assert.equal(r.location, '/admin/reports?done=clash');

  // Forms from other sites are refused.
  assert.equal((await ada.req('/agent-reports', { method: 'POST', form: { ref: 'general-assistant', reason: 'scam' }, headers: { origin: 'https://evil.example' } })).status, 403);
});

test('several open reports say a problem is being checked, and rate limits hold', async (t) => {
  const s = await start();
  t.after(s.close);
  const visitor = s.client();
  for (const who of ['ada', 'bob', 'cy']) {
    const m = await s.member(who);
    await m.req('/agent-reports', { method: 'POST', form: { ref: 'coder', reason: 'broken' } });
    const shown = (await visitor.req('/agents/coder')).text.includes('Polly is still checking');
    assert.equal(shown, who === 'cy', `only shown at ${LIMITS.pendingAt} reporters`);
  }
  assert.match((await visitor.req('/agents/coder')).text, /3 members have reported a problem that Polly is still checking/);

  // A member can report a few agents a day.
  const di = await s.member('di');
  const ids = ['general-assistant', 'cheap-first', 'coder'];
  for (const ref of ids) assert.match((await di.req('/agent-reports', { method: 'POST', form: { ref, reason: 'broken' } })).location, /report=sent/);
  // Fill the rest of today's allowance directly, then the next report is refused.
  const diId = (await s.db.agentReports.forAdmin()).find((x) => x.name.startsWith('Di')).member_id;
  for (let i = ids.length; i < LIMITS.perDay; i++) await s.db.agentReports.add(`made-up-${i}`, diId, 'broken', '');
  await s.db.agentReports.setStatus((await s.db.agentReports.mine('general-assistant', diId)).id, 'dismissed');
  const r = await di.req('/agent-reports', { method: 'POST', form: { ref: 'general-assistant', reason: 'scam' } });
  assert.equal(r.location, '/agents/general-assistant?report=slow#security');
});

test('listed agents can be reported, show a tag on /listed once confirmed, and reports move to the tested page once matched', async (t) => {
  const s = await start();
  t.after(s.close);
  const META = 'io.modelcontextprotocol.registry/official';
  const entry = { server: { name: 'io.github.acme/weather', description: 'Weather', version: '1.0.0', repository: { url: 'https://github.com/acme/weather' },
    remotes: [{ type: 'streamable-http', url: 'https://weather.example/mcp' }] }, _meta: { [META]: { status: 'active', isLatest: true, publishedAt: '2026-11-10T00:00:00Z' } } };
  await s.db.listed.save(prepare([fromMcp(entry)]));
  const path = '/listed/mcp/io.github.acme/weather';
  const visitor = s.client();
  assert.match((await visitor.req(path)).text, /Sign in to report this agent/);
  const ada = await s.member('ada');
  const r = await ada.req('/agent-reports', { method: 'POST', form: { ref: 'mcp:io.github.acme/weather', reason: 'permissions', note: 'Wants my whole inbox' } });
  assert.equal(r.location, `${path}?report=sent#security`);
  assert.ok(!(await visitor.req('/listed')).text.includes('Reported: unsafe'));
  const [{ id }] = await s.db.agentReports.forAdmin();
  await visitor.req(`/admin/reports/${id}/confirm`, { method: 'POST', headers: admin });
  assert.match((await visitor.req(path)).text, /reported it as asking for unsafe permissions/);
  assert.match((await visitor.req('/listed')).text, /Reported: unsafe/);
  // Still listed: reports never hide an agent.
  assert.match((await visitor.req('/listed')).text, /io\.github\.acme\/weather|Weather/);
  // Once matched to a tested agent, the report moves with it.
  await s.db.listed.save(prepare([{ ...fromMcp(entry), tested_id: 'coder' }]).map((x) => ({ ...x, tested_id: 'coder' })));
  await s.db.agentReports.adopt();
  assert.equal((await s.db.agentReports.summaries(['coder'])).coder.confirmed[0].reason, 'permissions');
});
