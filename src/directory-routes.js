// Routes for agents pulled in from other directories: the public /listed page, the daily sync and its admin page.
import express from 'express';
import { syncDirectories, SOURCES } from './directories.js';
import { listedPage, listedAgentPage, makerPage, adminDirectoriesPage, PER_PAGE } from './directory-views.js';
import { listedOn } from './directories.js';
import { checkHealth } from './health.js';
import { checkActivity } from './activity.js';
import { makerKeyFrom, makerReputation, testedByMaker } from './makers.js';
import { pageNotFound } from './views.js';

// A maker's reputation, worked out from what we hold about them (see src/makers.js).
export async function reputationFor(db, key) {
  if (!key) return null;
  const stats = await db.listed.makerStats(key);
  const tested = testedByMaker(key, stats.tested ?? []);
  if (!stats.agents && !tested.length) return null;
  const places = Math.max(0, ...await Promise.all(tested.map(async (a) => listedOn(a, await db.listed.forTested(a.id)).length)));
  return { stats, tested, rep: makerReputation({ key, stats, tested, places }) };
}

export function directoryRoutes({ db, config, adminOnly, fetchFn = fetch, lookup }) {
  const app = express.Router();

  app.get('/listed', async (req, res) => {
    const query = String(req.query.q ?? '').trim().slice(0, 80);
    const source = SOURCES[req.query.source] ? req.query.source : '';
    const live = req.query.live === '1';
    const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), 1000);
    const [{ rows, total }, counts] = await Promise.all([
      db.listed.search({ query, source, live, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
      db.listed.counts(),
    ]);
    const makerCounts = await db.listed.makerCounts([...new Set(rows.map((r) => r.maker_key).filter(Boolean))]);
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(listedPage({ rows, total, query, source, live, page, counts, makerCounts }));
  });

  // One listed agent. MCP names have a slash in them, so the id can be several path segments.
  app.get('/listed/:source/*rest', async (req, res) => {
    const id = [].concat(req.params.rest).join('/');
    const r = SOURCES[req.params.source] ? await db.listed.get(req.params.source, id) : null;
    // A tested agent has its own page with the grade.
    if (r?.tested_id) return res.redirect(301, `/agents/${encodeURIComponent(r.tested_id)}`);
    if (!r) return res.status(404).send(pageNotFound());
    const maker = await reputationFor(db, r.maker_key);
    const more = maker ? (await db.listed.byMaker(r.maker_key, 11)).filter((m) => m.source_id !== r.source_id || m.source !== r.source).slice(0, 10) : [];
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(listedAgentPage({ r, rep: maker?.rep, more }));
  });

  app.get('/makers/:kind/:id', async (req, res) => {
    const key = makerKeyFrom(req.params.kind, req.params.id);
    const maker = key ? await reputationFor(db, key) : null;
    if (!maker) return res.status(404).send(pageNotFound());
    const listed = await db.listed.byMaker(key, 100);
    const named = listed.find((r) => r.maker_name);
    const name = named?.maker_name ?? req.params.id;
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(makerPage({ key, name, url: named?.maker_url, rep: maker.rep, tested: maker.tested, listed, total: maker.stats.agents }));
  });

  const adminPage = async (res, report, healthReport) => {
    const state = {};
    for (const id of Object.keys(SOURCES)) state[`sync_${id}_at`] = await db.settings.get(`sync_${id}_at`);
    res.set('Cache-Control', 'private, no-store');
    res.send(adminDirectoriesPage({ counts: await db.listed.counts(), state, hasGraphKey: Boolean(config.graphApiKey), hasGithubToken: Boolean(config.githubToken), report, health: await db.listed.healthCounts(), healthReport }));
  };
  app.get('/admin/directories', adminOnly, (req, res) => adminPage(res));
  app.post('/admin/directories/sync', adminOnly, async (req, res) => adminPage(res, await syncDirectories({ db, config, fetchFn })));

  app.post('/admin/directories/health', adminOnly, async (req, res) => adminPage(res, null, {
    ...await checkHealth({ db, fetchFn, lookup, budgetMs: 50000 }),
    activity: await checkActivity({ db, fetchFn, token: config.githubToken, budgetMs: 15000 }),
  }));

  // Vercel Cron calls this twice a day (see vercel.json).
  app.get('/api/cron/health', async (req, res) => {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'unauthorised' });
    // Health first, then GitHub activity with what's left of the function's 5 minutes.
    const health = await checkHealth({ db, fetchFn, lookup, budgetMs: 180000 });
    res.json({ ...health, activity: await checkActivity({ db, fetchFn, token: config.githubToken, budgetMs: 40000 }) });
  });

  // Vercel Cron calls this every morning (see vercel.json).
  app.get('/api/cron/directories', async (req, res) => {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'unauthorised' });
    const report = await syncDirectories({ db, config, fetchFn });
    for (const r of report) if (r.error) console.error(`Directory sync (${r.source}):`, r.error);
    res.json({ report });
  });

  return app;
}
