// Member reviews and ratings: signed-in members give an agent 1 to 5 stars and a short note, one review per member per
// agent, which they can change or delete. Reviews are opinions and live apart from the Polly Tested grade: they never
// change a grade, the Pecking Order or a maker's reputation score.
// An agent is named by the same ref /compare uses: a tested id ("coder") or a listed "source:id" ("mcp:com.acme/weather").
import express from 'express';
import { agentById } from './agents.js';
import { SOURCES } from './directories.js';
import { testedDetails, testedByMaker } from './makers.js';
import { listedPath, listedRef } from './directory-views.js';
import { pageNotFound } from './views.js';
import { parseRef } from './compare.js';
import { adminReviewsPage, REPORT_REASONS } from './review-views.js';

export const REVIEW_MAX = 1000;
export const LIMITS = {
  savesPerHour: 10, // one member, adding or changing reviews
  siteSavesPerHour: 300, // everyone together, so a flood can't swamp the site
  reportsPerDay: 20, // one member
  hideAt: 3, // reports from different members before a review is hidden for the organiser to check
};

// The agent a ref points at: its ref, page, name and maker. A listing that is one of our tested agents is that agent.
export async function resolveAgent(db, refText) {
  const p = parseRef(refText);
  if (!p) return null;
  if (!p.source) {
    const a = agentById(p.id);
    if (!a) return null;
    return { ref: a.id, name: a.name, path: `/agents/${encodeURIComponent(a.id)}`, makerKey: testedDetails(a, await db.listed.forTested(a.id)).makerKey };
  }
  if (!SOURCES[p.source]) return null;
  const r = await db.listed.get(p.source, p.id);
  if (!r) return null;
  if (r.tested_id && agentById(r.tested_id)) return resolveAgent(db, r.tested_id);
  return { ref: listedRef(r), name: r.name, path: listedPath(r), makerKey: r.maker_key };
}

// Makers can't review their own agents. We can only tell for GitHub makers, from the login they signed in with.
export const ownAgent = (member, makerKey) =>
  Boolean(member?.github_login && makerKey && makerKey === `github:${String(member.github_login).toLowerCase()}`);

// Tidy what was typed and check it. Returns { stars, body } or { error } (a code the page turns into words).
export function cleanReview(input = {}) {
  const stars = Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { error: 'stars' };
  const body = String(input.body ?? '')
    .replace(/\r\n?/g, '\n')
    // Control characters and the invisible ones that flip text direction or hide words.
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (body.length > REVIEW_MAX) return { error: 'long' };
  if ((body.match(/https?:\/\/|www\./gi) ?? []).length > 2) return { error: 'links' };
  return { stars, body };
}

// Everything an agent page needs for its reviews section.
export async function reviewSection(db, { agent, member, notice }) {
  const [summaries, reviews, mine] = await Promise.all([
    db.reviews.summaries([agent.ref]),
    db.reviews.list(agent.ref, member?.id, 20),
    member ? db.reviews.mine(agent.ref, member.id) : null,
  ]);
  return {
    ref: agent.ref, name: agent.name, summary: summaries[agent.ref] ?? { count: 0, avg: null }, reviews, mine,
    signedIn: Boolean(member), joined: Boolean(member?.consent_at), own: ownAgent(member, agent.makerKey), notice,
  };
}

// One average across several agents (a maker's), weighting each by its number of reviews.
export function combineSummaries(list) {
  const count = list.reduce((n, s) => n + (s?.count ?? 0), 0);
  return { count, avg: count ? list.reduce((n, s) => n + (s?.count ? s.avg * s.count : 0), 0) / count : null };
}

// What members think of each maker's agents taken together (src/db.js reviews.makerSummaries), by maker key.
// Tested agents named for a maker in data/agent-facts.json count too, as on the maker's page.
export function makerRatings(db, keys) {
  const list = [...new Set(keys.filter(Boolean))];
  return db.reviews.makerSummaries(list, Object.fromEntries(list.map((k) => [k, testedByMaker(k).map((a) => a.id)])));
}

export function reviewRoutes({ db, adminOnly }) {
  const app = express.Router();
  const back = (res, path, code) => res.redirect(303, `${path}?review=${code}#reviews`);
  const member = async (req, res, next) => {
    req.member = (req.session.uid && (await db.get(req.session.uid))) || null;
    if (!req.member) return res.redirect(303, '/signin');
    if (!req.member.consent_at) return res.redirect(303, '/join');
    next();
  };

  app.post('/reviews', member, async (req, res) => {
    const agent = await resolveAgent(db, req.body.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    if (ownAgent(req.member, agent.makerKey)) return back(res, agent.path, 'own');
    const r = cleanReview(req.body);
    if (r.error) return back(res, agent.path, r.error);
    if ((await db.reviews.recentActions(req.member.id, 'save', 3600)) >= LIMITS.savesPerHour) return back(res, agent.path, 'slow');
    if ((await db.reviews.recentActions(null, 'save', 3600)) >= LIMITS.siteSavesPerHour) return back(res, agent.path, 'busy');
    await db.reviews.save(agent.ref, req.member.id, r.stars, r.body);
    back(res, agent.path, 'saved');
  });

  app.post('/reviews/delete', member, async (req, res) => {
    const agent = await resolveAgent(db, req.body.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    await db.reviews.remove(agent.ref, req.member.id);
    back(res, agent.path, 'deleted');
  });

  app.post('/reviews/:id/report', member, async (req, res) => {
    const review = /^\d{1,9}$/.test(req.params.id) ? await db.reviews.get(Number(req.params.id)) : null;
    if (!review || review.hidden) return res.status(404).send(pageNotFound());
    const agent = await resolveAgent(db, review.agent_ref);
    const path = agent?.path ?? '/';
    if (review.member_id === req.member.id) return back(res, path, 'reported');
    if ((await db.reviews.recentActions(req.member.id, 'report', 86400)) >= LIMITS.reportsPerDay) return back(res, path, 'slow');
    const reason = REPORT_REASONS.some(([v]) => v === req.body.reason) ? req.body.reason : 'other';
    await db.reviews.report(review.id, req.member.id, reason, LIMITS.hideAt);
    back(res, path, 'reported');
  });

  // ----- Organiser -----
  app.get('/admin/reviews', adminOnly, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.send(adminReviewsPage({ reviews: await db.reviews.forAdmin(), hideAt: LIMITS.hideAt }));
  });

  app.post('/admin/reviews/:id/:action', adminOnly, async (req, res, next) => {
    const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
    const actions = {
      hide: () => db.reviews.setHidden(id, true),
      show: async () => (await db.reviews.setHidden(id, false), db.reviews.clearReports(id)),
      delete: () => db.reviews.delete(id),
    };
    if (!id || !actions[req.params.action]) return next();
    await actions[req.params.action]();
    res.redirect(303, '/admin/reviews');
  });

  return app;
}
