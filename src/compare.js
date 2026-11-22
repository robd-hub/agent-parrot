// Compare two agents side by side: /compare?a=<ref>&b=<ref>.
// A ref is a tested agent's id ("coder") or a listed agent's source and id ("mcp:com.acme/weather", "erc8004:8453:7").
// Everything shown comes from what the agent pages already use: grades from data/agents.json, the rest from the
// directory copy, health checks and hand-kept facts. Nothing new is fetched or guessed.
import express from 'express';
import { agentById, allAgents, peckingOrder } from './agents.js';
import { SOURCES, listedOn } from './directories.js';
import { testedDetails } from './makers.js';
import { reputationFor } from './directory-routes.js';
import { mainRow, listedPath, listedRef } from './directory-views.js';
import { comparePage } from './compare-views.js';

export function parseRef(ref) {
  const s = String(ref ?? '').trim().slice(0, 300);
  if (!s) return null;
  const m = /^(mcp|erc8004):(.+)$/.exec(s);
  return m ? { source: m[1], id: m[2] } : { id: s };
}

// Everything the compare table needs about one agent, tested or listed.
export async function loadProfile(db, ref) {
  const profile = await loadBase(db, ref);
  if (profile) profile.reviews = (await db.reviews.summaries([profile.ref]))[profile.ref] ?? { count: 0, avg: null };
  return profile;
}

async function loadBase(db, ref) {
  const p = parseRef(ref);
  if (!p) return null;
  if (!p.source) {
    const agent = agentById(p.id);
    if (!agent) return null;
    const rows = await db.listed.forTested(agent.id);
    const d = testedDetails(agent, rows);
    const order = peckingOrder();
    return {
      kind: 'tested', ref: agent.id, name: agent.name, description: agent.description, path: `/agents/${encodeURIComponent(agent.id)}`,
      agent, details: d, row: mainRow(rows), rows, place: order.find((a) => a.id === agent.id)?.place, total: order.length,
      places: listedOn(agent, rows), rep: (await reputationFor(db, d.makerKey))?.rep ?? null,
      maker: d.maker ? { name: d.maker.name, key: d.makerKey } : null, makerNote: d.makerNote,
      openserv: Boolean(d.connection?.startsWith('OpenServ')),
    };
  }
  if (!SOURCES[p.source]) return null;
  const r = await db.listed.get(p.source, p.id);
  if (!r) return null;
  if (r.tested_id && agentById(r.tested_id)) return loadBase(db, r.tested_id);
  return {
    kind: 'listed', ref: listedRef(r), name: r.name, description: r.description, path: listedPath(r), row: r, rows: [r],
    places: [{ name: SOURCES[r.source].name, url: r.source === 'mcp' ? SOURCES.mcp.home : null, detail: r.source === 'erc8004' ? `#${r.source_id.split(':')[1]}${r.chain ? ` on ${r.chain}` : ''}` : null }],
    rep: (await reputationFor(db, r.maker_key))?.rep ?? null,
    maker: r.maker_name ? { name: r.maker_name, key: r.maker_key } : null, makerNote: null, openserv: false,
  };
}

// Search both the tested agents and the listed ones, for the "pick an agent" box.
export async function findAgents(db, query, { limit = 12 } = {}) {
  const q = query.toLowerCase();
  const tested = allAgents().filter((a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    .slice(0, q ? limit : 8).map((a) => ({ ref: a.id, name: a.name, grade: a.grade, note: `Polly Tested · Squawk Score ${a.score}` }));
  if (!q) return tested;
  const { rows } = await db.listed.search({ query, limit: Math.max(0, limit - tested.length) || 4 });
  return [...tested, ...rows.map((r) => ({ ref: listedRef(r), name: r.name, grade: null, note: `${SOURCES[r.source]?.name ?? r.source}${r.maker_name ? ` · by ${r.maker_name}` : ''} · not Polly Tested` }))];
}

export function compareRoutes({ db }) {
  const app = express.Router();
  app.get('/compare', async (req, res) => {
    const query = String(req.query.q ?? '').trim().slice(0, 80);
    const [a, b] = await Promise.all([loadProfile(db, req.query.a), loadProfile(db, req.query.b)]);
    const missing = ['a', 'b'].filter((k) => req.query[k] && !(k === 'a' ? a : b));
    // Pick the first agent, then the second. A search only runs while one is still to pick.
    const results = !a || !b ? await findAgents(db, query) : [];
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.status(missing.length && !a && !b ? 404 : 200).send(comparePage({ a, b, query, results, missing: missing.length > 0 }));
  });
  return app;
}
