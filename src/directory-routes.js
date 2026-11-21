// Routes for agents pulled in from other directories: the public /listed page, the daily sync and its admin page.
import express from 'express';
import { syncDirectories, SOURCES } from './directories.js';
import { listedPage, adminDirectoriesPage, PER_PAGE } from './directory-views.js';

export function directoryRoutes({ db, config, adminOnly, fetchFn = fetch }) {
  const app = express.Router();

  app.get('/listed', async (req, res) => {
    const query = String(req.query.q ?? '').trim().slice(0, 80);
    const source = SOURCES[req.query.source] ? req.query.source : '';
    const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), 1000);
    const [{ rows, total }, counts] = await Promise.all([
      db.listed.search({ query, source, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
      db.listed.counts(),
    ]);
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.send(listedPage({ rows, total, query, source, page, counts }));
  });

  const adminPage = async (res, report) => {
    const state = {};
    for (const id of Object.keys(SOURCES)) state[`sync_${id}_at`] = await db.settings.get(`sync_${id}_at`);
    res.set('Cache-Control', 'private, no-store');
    res.send(adminDirectoriesPage({ counts: await db.listed.counts(), state, hasGraphKey: Boolean(config.graphApiKey), report }));
  };
  app.get('/admin/directories', adminOnly, (req, res) => adminPage(res));
  app.post('/admin/directories/sync', adminOnly, async (req, res) => adminPage(res, await syncDirectories({ db, config, fetchFn })));

  // Vercel Cron calls this every morning (see vercel.json).
  app.get('/api/cron/directories', async (req, res) => {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'unauthorised' });
    const report = await syncDirectories({ db, config, fetchFn });
    for (const r of report) if (r.error) console.error(`Directory sync (${r.source}):`, r.error);
    res.json({ report });
  });

  return app;
}
