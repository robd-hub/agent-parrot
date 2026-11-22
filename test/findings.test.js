import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingsFor, findingsPage, levelFor } from '../src/findings.js';

const task = (id, score, extra = {}) => ({ id, prompt: `Do ${id}`, criteria: `Criteria for ${id}`, answer: `<b>${id}</b>`, score, verdict: `Note on ${id}`, honesty: null, ...extra });
const agent = { id: 'x', name: 'X <Agent>', grade: 'C', score: 70, gradedAt: '2026-11-19T09:52:41Z',
  tasks: [task('a', 100), task('b', 40), task('c', 80), task('d', null), task('e', 70)] };

test('tasks are sorted worst first and the possible gain is the share of the average', () => {
  assert.equal(levelFor(95), 'passed');
  assert.equal(levelFor(70), 'partial');
  assert.equal(levelFor(69), 'failed');
  assert.equal(levelFor(null), 'pending');
  const r = findingsFor(agent);
  assert.deepEqual(r.items.map((i) => i.id), ['b', 'e', 'c', 'd', 'a']);
  assert.deepEqual(r.counts, { failed: 1, partial: 2, passed: 1, pending: 1 });
  assert.equal(r.items[0].gain, 12); // (100 - 40) / 5 tasks
  assert.equal(r.best, 70 + 12 + 6 + 4);
});

test('the findings page escapes what it shows and links to a retest', () => {
  const html = findingsPage({ agent, report: findingsFor(agent) });
  assert.match(html, /What to fix, worst first/);
  assert.match(html, /could take the Squawk Score from 70 to as much as 92/);
  assert.match(html, /What full marks needed:<\/b> Criteria for b/);
  assert.match(html, /&lt;b&gt;b&lt;\/b&gt;/);
  assert.doesNotMatch(html, /X <Agent>/);
  assert.match(html, /\/request\?ref=x/);
  const clean = findingsPage({ agent: { ...agent, tasks: [task('a', 100)] }, report: findingsFor({ ...agent, tasks: [task('a', 100)] }) });
  assert.match(clean, /Nothing to fix from this test/);
});
