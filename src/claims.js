// Claim your listing: a builder proves they own an agent listed here, and gets a "Claimed by its maker" tick, a free
// basic check (does it answer, what tools, how fast) and a badge for their README or website that links back here.
// Claiming never changes a grade: only the paid Polly Test does that, and every claimed page nudges towards it.
//
// How a builder proves it (we never judge who is telling the truth ourselves):
//   GitHub: they signed in with the GitHub account the registry already checked (MCP names io.github.<login>/…),
//     or the one Rob confirmed in data/agent-facts.json.
//   Website file: a code we give them, at https://<host>/.well-known/agent-parrot.txt, on a web address the listing
//     itself names (its endpoint, its website, or the domain the registry checked).
//   Repo file: the same code in agent-parrot.txt at the root of the code repo the listing names.
// One owner per agent. Rob can remove a claim at /admin/claims.
import express from 'express';
import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { agentById } from './agents.js';
import { SOURCES } from './directories.js';
import { testedDetails, factsFor } from './makers.js';
import { listedPath, listedRef, mainRow } from './directory-views.js';
import { parseRef } from './compare.js';
import { publicUrl, checkAgent } from './health.js';
import { pageNotFound } from './views.js';
import { claimPage, adminClaimsPage, badgeSvg, CLAIM_NOTICES } from './claim-views.js';

export const CHECK_EVERY_MINUTES = 10; // an owner can run the free check this often
const FETCH_MS = 8000;
const MAX_BODY = 8 * 1024;
// Hosts nobody but the platform can put a file on, so they are no use as proof (the repo file covers code hosts).
const SHARED_HOSTS = new Set(['github.com', 'www.github.com', 'gitlab.com', 'npmjs.com', 'www.npmjs.com', 'pypi.org', 'registry.modelcontextprotocol.io']);

const hostOf = (url) => {
  try {
    const u = new URL(url);
    return ['https:', 'http:'].includes(u.protocol) ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};
export const githubRepo = (url) => {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([\w.-]{1,100}?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` } : null;
};
const uniq = (list) => [...new Set(list.filter(Boolean))];

// What proves ownership of one agent: the GitHub logins, web hosts and code repos its listing names.
export function proofTargets({ makerKeys = [], urls = [], repos = [] }) {
  const logins = uniq(makerKeys.map((k) => (/^github:(.+)$/.exec(k ?? '') ?? [])[1]));
  const domains = makerKeys.map((k) => (/^web:(.+)$/.exec(k ?? '') ?? [])[1]);
  return {
    logins,
    hosts: uniq([...domains, ...urls.map(hostOf)]).filter((h) => !SHARED_HOSTS.has(h)),
    repos: uniq(repos.map((r) => githubRepo(r)?.url)),
  };
}

// The agent a ref points at, with everything a claim needs. A listing that is one of our tested agents is that agent.
export async function claimable(db, refText) {
  const p = parseRef(refText);
  if (!p) return null;
  if (!p.source) {
    const agent = agentById(p.id);
    if (!agent) return null;
    const rows = await db.listed.forTested(agent.id);
    const d = testedDetails(agent, rows);
    const f = factsFor(agent.id);
    return {
      ref: agent.id, name: agent.name, path: `/agents/${encodeURIComponent(agent.id)}`, tested: agent, row: mainRow(rows),
      makerKey: d.makerKey,
      targets: proofTargets({
        makerKeys: [d.makerKey, ...rows.map((r) => r.maker_key)],
        // A marketplace page's address belongs to the marketplace, not the maker.
        urls: [f.website, agent.marketplaceId ? null : agent.url, ...rows.flatMap((r) => [r.endpoint, r.url])],
        repos: [f.repo, ...rows.map((r) => r.details?.repo)],
      }),
    };
  }
  if (!SOURCES[p.source]) return null;
  const r = await db.listed.get(p.source, p.id);
  if (!r) return null;
  if (r.tested_id && agentById(r.tested_id)) return claimable(db, r.tested_id);
  return {
    ref: listedRef(r), name: r.name, path: listedPath(r), tested: null, row: r, makerKey: r.maker_key,
    targets: proofTargets({ makerKeys: [r.maker_key], urls: [r.endpoint, r.url], repos: [r.details?.repo] }),
  };
}

// The code a member puts on their site or repo. The same member always gets the same code for the same agent,
// and nobody can work it out without the site's secret, so there's nothing to store.
export const claimToken = (secret, memberId, ref) =>
  `agent-parrot-verify=${createHmac('sha256', String(secret)).update(`claim|${memberId}|${ref}`).digest('hex').slice(0, 32)}`;

// Reads a small text file from a public address. No redirects, a time limit and a size cap. Never throws.
async function readSmall(url, { fetchFn, lookup }) {
  const safe = await publicUrl(url, lookup);
  if (safe.error) return null;
  try {
    const res = await fetchFn(safe.url.href, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS), headers: { 'user-agent': 'AgentParrot/1.0 (claim check)' } });
    if (res.status !== 200) return null;
    if (!res.body?.getReader) return (await res.text()).slice(0, MAX_BODY);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    while (text.length < MAX_BODY) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return text.slice(0, MAX_BODY);
  } catch {
    return null;
  }
}

// Looks for the member's code on each host and repo the listing names. Returns what matched, or null.
export async function findToken(targets, token, { fetchFn = fetch, lookup = dnsLookup } = {}) {
  const places = [
    ...targets.hosts.map((h) => ({ proof: `https://${h}/.well-known/agent-parrot.txt`, url: `https://${h}/.well-known/agent-parrot.txt`, method: 'file' })),
    ...targets.repos.flatMap((r) => {
      const g = githubRepo(r);
      const raw = `https://raw.githubusercontent.com/${g.owner}/${g.repo}/HEAD`;
      return [{ proof: `${g.url} (agent-parrot.txt)`, url: `${raw}/agent-parrot.txt`, method: 'repo' },
        { proof: `${g.url} (.well-known/agent-parrot.txt)`, url: `${raw}/.well-known/agent-parrot.txt`, method: 'repo' }];
    }),
  ].slice(0, 10);
  for (const p of places) {
    const text = await readSmall(p.url, { fetchFn, lookup });
    if (text && text.includes(token)) return p;
  }
  return null;
}

export const ownsByGithub = (member, targets) =>
  Boolean(member?.github_login && targets.logins.includes(String(member.github_login).toLowerCase()));

// The free basic check's latest result for an agent: from its directory listing's health check.
export const checkResult = (row) => (row?.checked_at
  ? { up: Boolean(row.up), latency: row.latency_ms, tools: row.health?.tools?.length ?? 0, toolsMore: Boolean(row.health?.toolsMore), note: row.health?.note, at: row.checked_at }
  : null);

// The tick on agent pages: claimed, or an invitation to claim.
export async function claimInfo(db, ref) {
  return { ref, claim: (await db.claims.get(ref)) ?? null };
}

export function claimRoutes({ db, config, adminOnly, fetchFn = fetch, lookup = dnsLookup }) {
  const app = express.Router();
  const back = (res, ref, code) => res.redirect(303, `/claim?ref=${encodeURIComponent(ref)}&claim=${code}`);
  const memberOf = async (req) => (req.session.uid && (await db.get(req.session.uid))) || null;
  const member = async (req, res, next) => {
    req.member = await memberOf(req);
    if (!req.member) return res.redirect(303, '/signin');
    if (!req.member.consent_at) return res.redirect(303, '/join');
    next();
  };

  app.get('/claim', async (req, res) => {
    const agent = await claimable(db, req.query.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    const m = await memberOf(req);
    const claim = (await db.claims.get(agent.ref)) ?? null;
    res.set('Cache-Control', 'private, no-store');
    res.send(claimPage({
      agent, claim, member: m, joined: Boolean(m?.consent_at),
      mine: Boolean(m && claim?.member_id === m.id),
      byGithub: ownsByGithub(m, agent.targets),
      token: m ? claimToken(config.sessionSecret, m.id, agent.ref) : null,
      check: checkResult(agent.row), canCheck: Boolean(agent.row?.endpoint),
      notice: CLAIM_NOTICES[req.query.claim] ? req.query.claim : null,
      contactEmail: config.contactEmail,
    }));
  });

  app.post('/claim', member, async (req, res) => {
    const agent = await claimable(db, req.body.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    const held = await db.claims.get(agent.ref);
    if (held) return back(res, agent.ref, held.member_id === req.member.id ? 'claimed' : 'taken');
    let proof = null;
    if (req.body.method === 'github') {
      if (ownsByGithub(req.member, agent.targets)) proof = { method: 'github', proof: `GitHub sign-in as ${req.member.github_login}` };
      else return back(res, agent.ref, 'github');
    } else {
      proof = await findToken(agent.targets, claimToken(config.sessionSecret, req.member.id, agent.ref), { fetchFn, lookup });
      if (!proof) return back(res, agent.ref, 'notfound');
    }
    const saved = await db.claims.save(agent.ref, req.member.id, proof.method, proof.proof);
    back(res, agent.ref, saved.member_id === req.member.id ? 'claimed' : 'taken');
  });

  // The owner runs the free basic check now, instead of waiting for the next regular one.
  app.post('/claim/check', member, async (req, res) => {
    const agent = await claimable(db, req.body.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    const claim = await db.claims.get(agent.ref);
    if (claim?.member_id !== req.member.id) return back(res, agent.ref, 'notyours');
    if (!agent.row?.endpoint) return back(res, agent.ref, 'noaddress');
    if (claim.checked_at && Date.now() - new Date(claim.checked_at) < CHECK_EVERY_MINUTES * 60000) return back(res, agent.ref, 'slow');
    await db.claims.markChecked(agent.ref);
    const result = await checkAgent(agent.row, { fetchFn, lookup });
    await db.listed.saveHealth([{ source: agent.row.source, source_id: agent.row.source_id, ...result }]);
    back(res, agent.ref, 'checked');
  });

  app.post('/claim/release', member, async (req, res) => {
    const agent = await claimable(db, req.body.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    await db.claims.release(agent.ref, req.member.id);
    back(res, agent.ref, 'released');
  });

  // The badge. Only claimed agents get one, and it only says what we measured.
  app.get('/badge.svg', async (req, res) => {
    const agent = await claimable(db, req.query.ref);
    const claim = agent ? await db.claims.get(agent.ref) : null;
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    if (!claim) return res.status(404).send(badgeSvg({ message: 'not claimed', colour: 'grey' }));
    db.claims.badgeSeen(agent.ref).catch(() => {});
    res.send(badgeSvg(badgeFor(agent)));
  });

  // ----- Organiser -----
  app.get('/admin/claims', adminOnly, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.send(adminClaimsPage({ claims: await db.claims.forAdmin() }));
  });
  app.post('/admin/claims/remove', adminOnly, async (req, res) => {
    await db.claims.remove(String(req.body.ref ?? ''));
    res.redirect(303, '/admin/claims');
  });

  return app;
}

const FRESH_DAYS = 8;
const GRADE_COLOURS = { A: 'green', B: 'green', C: 'yellow', D: 'red', F: 'red' };
// What the badge says. A grade only for a Polly Tested agent; "Up" only if the last check was recent and it answered.
export function badgeFor(agent, now = new Date()) {
  if (agent.tested) return { message: `Polly Tested · ${agent.tested.grade} · Squawk ${Number(agent.tested.score)}`, colour: GRADE_COLOURS[agent.tested.grade] ?? 'grey' };
  const c = checkResult(agent.row);
  if (c && now - new Date(c.at) < FRESH_DAYS * 864e5) {
    const day = new Date(c.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return c.up ? { message: `Claimed · Up · checked ${day}`, colour: 'green' } : { message: `Claimed · Down · checked ${day}`, colour: 'red' };
  }
  return { message: 'Claimed', colour: 'blue' };
}

// Sign-in matching: listings that look like this member's (the registry-checked GitHub login they signed in with).
export async function claimsForMember(db, m) {
  const mine = await db.claims.mine(m.id);
  const found = m.github_login ? await db.claims.unclaimedFor(`github:${String(m.github_login).toLowerCase()}`) : [];
  const names = await Promise.all(mine.map(async (c) => ({ ...c, agent: await claimable(db, c.agent_ref) })));
  return { mine: names.filter((c) => c.agent), found };
}
