import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
import { createApp } from '../src/routes.js';
import { allAgents } from '../src/agents.js';

const config = { baseUrl: 'https://agentparrot.example', sessionSecret: 's', graderUrl: 'https://grader.example', linkedin: {}, google: {}, github: {} };

async function start() {
  const db = await connect();
  const server = createApp({ db, config, getHeadlines: async () => [], writeStories: null, sendEmail: null }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const res = await fetch(base + path);
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, cors: res.headers.get('access-control-allow-origin'), body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { get, close: () => server.close() };
}

test('the feed lists every grade, credited to Agent Report Card', async (t) => {
  const s = await start();
  t.after(s.close);
  const { status, cors, body } = await s.get('/api/grades.json');
  assert.equal(status, 200);
  assert.equal(cors, '*', 'any website can read it');
  assert.equal(body.source.name, 'Agent Report Card');
  assert.doesNotMatch(JSON.stringify(body), /Polly|Parrot|Squawk/, 'parrot names stay on this site');
  assert.equal(body.count, allAgents().length);
  const cf = body.agents.find((a) => a.id === 'cheap-first');
  const real = allAgents().find((a) => a.id === 'cheap-first');
  assert.equal(cf.grade, real.grade);
  assert.equal(cf.score, real.score);
  assert.equal(cf.report, 'https://grader.example/agents/cheap-first/');
  assert.equal(cf.page, 'https://agentparrot.example/agents/cheap-first');
  assert.ok(cf.registries.includes('mcp:io.github.robd-hub/cheap-first'));
  assert.equal(cf.tasks, real.tasks.length);
  assert.equal(cf.answers, undefined, 'answers stay on the report card');
});

test('one agent, and a lookup by registry entry or website', async (t) => {
  const s = await start();
  t.after(s.close);
  assert.equal((await s.get('/api/grades/coder.json')).body.agent.name, 'Coder');
  assert.equal((await s.get('/api/grades/nope.json')).status, 404);
  for (const q of ['mcp=io.github.robd-hub/cheap-first', 'erc8004=8453:1202503', 'url=https://cheap-first.vercel.app/mcp']) {
    const r = await s.get(`/api/grades/lookup?${q}`);
    assert.equal(r.body.graded, true, q);
    assert.equal(r.body.agent.id, 'cheap-first', q);
  }
  const miss = await s.get('/api/grades/lookup?mcp=com.example/unknown');
  assert.equal(miss.body.graded, false);
  assert.match(miss.body.test, /get-polly-tested/);
  assert.equal((await s.get('/api/grades/lookup')).status, 400);
  const page = await s.get('/feed');
  assert.equal(page.status, 200);
  assert.match(page.body, /api\/grades\.json/);
  assert.match((await s.get('/')).body, /href="\/feed"/);
});
