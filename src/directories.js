// Agents listed in other public directories, the way CoinGecko pulls coins in from exchanges.
// They are shown as "not Polly Tested yet", with a link to get tested, and never get a grade here.
// Grades still only come from Agent Report Card (data/agents.json).
//
// Sources:
//   mcp      The Official MCP Registry (registry.modelcontextprotocol.io). Open API, no key. Only hosted
//            servers (ones with a remote address) are kept, since those are the ones that can be tested.
//   erc8004  The ERC-8004 agent registry on-chain, read through The Graph's Agent0 indexes. Needs a free
//            Subgraph Studio key in GRAPH_API_KEY; without it this source is skipped.
import { readFileSync } from 'node:fs';
import { allAgents } from './agents.js';

export const SOURCES = {
  mcp: { name: 'Official MCP Registry', home: 'https://registry.modelcontextprotocol.io' },
  erc8004: { name: 'ERC-8004 registry', home: 'https://eips.ethereum.org/EIPS/eip-8004' },
};

// Hand-kept list of where our own tested agents are registered (Rob's records), for the "Listed on" badges.
// Badges from the synced directories are added on top of these automatically.
const OWN = JSON.parse(readFileSync(new URL('../data/listed-on.json', import.meta.url), 'utf8'));

const MCP_API = 'https://registry.modelcontextprotocol.io/v0/servers';
const MCP_META = 'io.modelcontextprotocol.registry/official';

// The Graph's Agent0 indexes of ERC-8004, one per chain (from thegraph.com/docs, Agent0 subgraphs).
export const ERC8004_CHAINS = {
  ethereum: { id: 1, name: 'Ethereum', subgraph: 'FV6RR6y13rsnCxBAicKuQEwDp8ioEGiNaWaZUmvr1F8k' },
  base: { id: 8453, name: 'Base', subgraph: '43s9hQRurMGjuYnC1r2ZwS6xSQktbFyXMPMqGKUFJojb' },
  bsc: { id: 56, name: 'BNB Chain', subgraph: 'D6aWqowLkWqBgcqmpNKXuNikPkob24ADXCciiP8Hvn1K' },
  polygon: { id: 137, name: 'Polygon', subgraph: '9q16PZv1JudvtnCAf44cBoxg82yK9SSsFvrjCY9xnneF' },
};

const clip = (s, max) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) && u.length <= 500 ? u : null);

async function getJson(fetchFn, url, init) {
  const res = await fetchFn(url, { ...init, headers: { accept: 'application/json', 'user-agent': 'AgentParrot/1.0', ...init?.headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// One registry entry in the shape stored in the listed_agents table.
export function fromMcp(entry) {
  const s = entry?.server;
  const meta = entry?._meta?.[MCP_META] ?? {};
  // Older versions are skipped: only the newest version of each server says what it is now.
  if (!s?.name || meta.isLatest === false) return null;
  const endpoint = httpUrl(s.remotes?.find((r) => httpUrl(r?.url))?.url);
  return {
    source: 'mcp', source_id: clip(s.name, 200),
    name: clip(s.title || s.name.split('/').pop(), 120),
    description: clip(s.description, 300),
    url: httpUrl(s.websiteUrl) || httpUrl(s.repository?.url) || null,
    endpoint, image: httpUrl(s.icons?.[0]?.src),
    // Kept only while it is active and can be called over the internet; otherwise taken out.
    keep: Boolean(endpoint) && (meta.status ?? 'active') === 'active',
    updated_at: meta.updatedAt || meta.publishedAt || null,
  };
}

// Reads one batch of pages from the MCP Registry, starting at `cursor`. Returns the entries and the next cursor.
export async function fetchMcpPages({ fetchFn = fetch, cursor = null, since = null, pages = 20 } = {}) {
  const out = [];
  let next = cursor;
  for (let i = 0; i < pages; i++) {
    const url = new URL(MCP_API);
    url.searchParams.set('limit', '100');
    if (next) url.searchParams.set('cursor', next);
    if (since) url.searchParams.set('updated_since', since);
    const data = await getJson(fetchFn, url.href);
    for (const e of data.servers ?? []) {
      const row = fromMcp(e);
      if (row) out.push(row);
    }
    next = data.metadata?.nextCursor || null;
    if (!next || !(data.servers ?? []).length) return { rows: out, cursor: null };
  }
  return { rows: out, cursor: next };
}

const AGENT0_QUERY = `query ($after: String!, $since: BigInt!) {
  agents(first: 500, orderBy: id, orderDirection: asc, where: { id_gt: $after, updatedAt_gte: $since }) {
    id agentId owner updatedAt totalFeedback
    registrationFile { name description image active mcpEndpoint a2aEndpoint x402Support }
  }
}`;

export function fromErc8004(a, chain) {
  const f = a?.registrationFile;
  const name = clip(f?.name, 120);
  // Skip empty or switched-off registrations: there's nothing to show or test.
  const endpoint = httpUrl(f?.mcpEndpoint) || httpUrl(f?.a2aEndpoint);
  const keep = Boolean(name) && f.active !== false && Boolean(endpoint || f?.description);
  return {
    source: 'erc8004', source_id: `${chain.id}:${a.agentId}`, name: name || `Agent ${a.agentId}`,
    description: clip(f?.description, 300), url: null, endpoint, image: httpUrl(f?.image),
    chain: chain.name, x402: Boolean(f?.x402Support), keep,
    updated_at: a.updatedAt ? new Date(Number(a.updatedAt) * 1000).toISOString() : null,
  };
}

// Reads one batch of ERC-8004 agents on one chain, after the id `after`.
export async function fetchErc8004Page({ fetchFn = fetch, apiKey, chain, after = '', since = 0 }) {
  const url = `https://gateway.thegraph.com/api/${encodeURIComponent(apiKey)}/subgraphs/id/${chain.subgraph}`;
  const data = await getJson(fetchFn, url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: AGENT0_QUERY, variables: { after, since: String(since) } }),
  });
  if (data.errors?.length) throw new Error(`ERC-8004 index (${chain.name}): ${data.errors[0].message}`);
  const agents = data.data?.agents ?? [];
  return { rows: agents.map((a) => fromErc8004(a, chain)), after: agents.length === 500 ? agents.at(-1).id : null };
}

// Marks which listings are our own tested agents, and drops the ones that are never shown.
export const prepare = (rows) => rows.map((r) => ({ ...r, keep: r.keep && !hidden(r), tested_id: testedAgentFor(r)?.id ?? null }));

// One sync run. Works through each source a page batch at a time and remembers where it stopped (in the
// settings table), so a run that hits the time limit carries on next time. Once a source has been read to the
// end, later runs only ask for what changed since then.
// Vercel lets a function run for up to 300 seconds; a run stops starting new batches after budgetMs. The MCP
// Registry gets the first 60% when ERC-8004 is on too, so both make progress on every run.
export async function syncDirectories({ db, config, fetchFn = fetch, budgetMs = 200000, now = () => new Date() }) {
  const started = Date.now();
  const timeLeft = () => Date.now() - started < budgetMs;
  const mcpTimeLeft = () => Date.now() - started < (config.graphApiKey ? budgetMs * 0.6 : budgetMs);
  const report = [];

  // MCP Registry
  {
    const state = JSON.parse((await db.settings.get('sync_mcp')) || '{}');
    let { cursor = null, since = null, runStart = null } = state;
    runStart ??= now().toISOString();
    let saved = 0;
    let removed = 0;
    try {
      // The next batch is fetched while this one is being saved.
      let next = fetchMcpPages({ fetchFn, cursor, since, pages: 10 });
      do {
        const page = await next;
        next = page.cursor && mcpTimeLeft() ? fetchMcpPages({ fetchFn, cursor: page.cursor, since, pages: 10 }) : null;
        next?.catch(() => {}); // a failure is picked up when it is awaited
        const res = await db.listed.save(prepare(page.rows));
        saved += res.saved;
        removed += res.removed;
        cursor = page.cursor;
        // Saved after every batch, so a run that gets cut off still carries on from here next time.
        if (cursor) await db.settings.set('sync_mcp', JSON.stringify({ cursor, since, runStart }));
      } while (cursor && next);
      const done = !cursor;
      await db.settings.set('sync_mcp', JSON.stringify(done ? { since: runStart } : { cursor, since, runStart }));
      if (done) await db.settings.set('sync_mcp_at', now().toISOString());
      report.push({ source: 'mcp', saved, removed, done });
    } catch (err) {
      await db.settings.set('sync_mcp', JSON.stringify({ cursor, since, runStart }));
      report.push({ source: 'mcp', saved, removed, done: false, error: err.message });
    }
  }

  // ERC-8004, chain by chain
  if (!config.graphApiKey) {
    report.push({ source: 'erc8004', saved: 0, removed: 0, done: false, skipped: 'Add GRAPH_API_KEY in Vercel to switch this on.' });
  } else {
    const chains = (config.erc8004Chains?.length ? config.erc8004Chains : Object.keys(ERC8004_CHAINS)).filter((c) => ERC8004_CHAINS[c]);
    let saved = 0;
    let removed = 0;
    let done = true;
    const errors = [];
    for (const key of chains) {
      const chain = ERC8004_CHAINS[key];
      const state = JSON.parse((await db.settings.get(`sync_erc8004_${key}`)) || '{}');
      let { after = '', since = 0, runStart = null } = state;
      runStart ??= Math.floor(now().getTime() / 1000);
      if (!timeLeft()) {
        done = false;
        continue;
      }
      try {
        do {
          const page = await fetchErc8004Page({ fetchFn, apiKey: config.graphApiKey, chain, after, since });
          const res = await db.listed.save(prepare(page.rows));
          saved += res.saved;
          removed += res.removed;
          after = page.after;
          if (after) await db.settings.set(`sync_erc8004_${key}`, JSON.stringify({ after, since, runStart }));
        } while (after && timeLeft());
        await db.settings.set(`sync_erc8004_${key}`, JSON.stringify(after ? { after, since, runStart } : { since: runStart }));
        if (after) done = false;
      } catch (err) {
        done = false;
        errors.push(err.message);
        await db.settings.set(`sync_erc8004_${key}`, JSON.stringify({ after, since, runStart }));
      }
    }
    if (done) await db.settings.set('sync_erc8004_at', now().toISOString());
    report.push({ source: 'erc8004', saved, removed, done, ...(errors.length ? { error: errors.join('; ') } : {}) });
  }
  return report;
}

// ----- Matching our tested agents to their listings elsewhere -----

const host = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return null;
  }
};
const ownFor = (id) => OWN.agents?.[id] ?? {};

// Does a synced listing fit a pattern from data/listed-on.json? "mcp:<server name>", or "erc8004:<chain id>:<agent id>"
// where the chain can be * for any chain.
const fits = (row, pattern) => {
  const [src, ...rest] = pattern.split(':');
  if (src !== row.source) return false;
  const id = rest.join(':');
  return id.startsWith('*:') ? row.source_id.split(':').slice(1).join(':') === id.slice(2) : row.source_id === id;
};

// Entries that are never shown as untested: Agent Report Card itself, which does the grading.
export const hidden = (row) => (OWN.hide ?? []).some((h) => fits(row, h));

// The tested agent a synced listing belongs to, if any: by its registry id or its web address. Names alone are not
// enough, since plenty of different agents share a name like "Coder".
export function testedAgentFor(row) {
  const hosts = [row.url, row.endpoint].map(host).filter(Boolean);
  return allAgents().find((a) => (ownFor(a.id).ids ?? []).some((p) => fits(row, p)) || (ownFor(a.id).sites ?? []).some((u) => hosts.includes(host(u)))) ?? null;
}

// Every place a tested agent is listed: the hand-kept records plus matches from the synced directories.
export function listedOn(agent, syncedRows = []) {
  const list = (ownFor(agent.id).listings ?? []).map((l) => ({ ...l }));
  for (const r of syncedRows) {
    const name = SOURCES[r.source]?.name;
    if (!name || list.some((l) => l.name === name)) continue;
    list.push({ name, url: r.url || SOURCES[r.source].home, detail: r.source === 'erc8004' ? `#${r.source_id.split(':')[1]}${r.chain ? ` on ${r.chain}` : ''}` : null });
  }
  return list;
}
