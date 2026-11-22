// Key details about each agent (who made it, links, dates, how it runs) and a simple reputation score for makers.
// Tested agents get their details from data/agents.json, data/agent-facts.json (hand-kept) and their matched directory
// listings. Listed agents get theirs from the directory copy. Nothing is guessed: a missing field is shown as not known.
import { readFileSync } from 'node:fs';
import { allAgents } from './agents.js';

const FACTS = JSON.parse(readFileSync(new URL('../data/agent-facts.json', import.meta.url), 'utf8'));
export const factsFor = (id) => FACTS.agents?.[id] ?? {};

// /makers/<kind>/<id>. Kinds: github (a GitHub login), web (a domain), wallet (an on-chain address).
export const MAKER_KINDS = {
  github: { name: 'GitHub account', checked: true },
  web: { name: 'Web domain', checked: true },
  wallet: { name: 'Wallet', checked: false },
};
export const makerPath = (key) => {
  const [kind, ...rest] = String(key ?? '').split(':');
  return MAKER_KINDS[kind] && rest.length ? `/makers/${kind}/${encodeURIComponent(rest.join(':'))}` : null;
};
export const makerKeyFrom = (kind, id) => (MAKER_KINDS[kind] && /^[\w.@-]{1,100}$/.test(id) ? `${kind}:${id.toLowerCase()}` : null);

// The key details shown on a tested agent's page. `rows` are its matched directory listings.
export function testedDetails(agent, rows = []) {
  const f = factsFor(agent.id);
  const platform = FACTS.platforms?.[agent.adapter] ?? {};
  const mcpRow = rows.find((r) => r.source === 'mcp');
  const chainRows = rows.filter((r) => r.source === 'erc8004');
  const fromRows = rows.find((r) => r.maker_key);
  const maker = f.maker ?? (fromRows ? { name: fromRows.maker_name, url: fromRows.maker_url, key: fromRows.maker_key } : null);
  const firstRow = rows.map((r) => r.first_published_at).filter(Boolean).map((d) => new Date(d).toISOString()).sort()[0];
  return {
    maker, makerNote: maker ? null : platform.makerNote ?? null,
    makerKey: maker?.key ?? null,
    links: [
      agent.marketplaceId ? { name: 'OpenServ marketplace page', url: agent.url } : null,
      f.website ? { name: 'Website', url: f.website } : null,
      f.repo || mcpRow?.details?.repo ? { name: 'Code', url: f.repo || mcpRow.details.repo } : null,
      ...chainRows.map((r) => (r.details?.registration ? { name: `ERC-8004 registration (${r.chain})`, url: r.details.registration } : null)),
    ].filter(Boolean),
    firstListed: f.firstListed || firstRow || null,
    firstListedWhere: f.firstListedWhere || (firstRow ? 'Earliest date in the directories we copy' : null),
    platform: f.platform || platform.platform || null,
    connection: f.connection || platform.connection || null,
    model: f.model || agent.model || null,
    version: mcpRow?.details?.version || null,
    chains: [...new Set([...(f.chains ?? []), ...chainRows.map((r) => r.chain).filter(Boolean)])],
    pricing: f.pricing || null,
    x402: rows.some((r) => r.x402) || /x402/i.test(f.pricing ?? ''),
    note: f.note || null,
    // Licence and privacy facts, only where Rob or the maker confirmed them (src/openness.js shows the rest as not known).
    facts: { licence: f.licence, openSource: f.openSource, privacy: f.privacy, privacyUrl: f.privacyUrl, repo: f.repo },
  };
}

// The tested agents a maker has: matched through the directories, or named in data/agent-facts.json.
export const testedByMaker = (key, testedIds = []) =>
  allAgents().filter((a) => testedIds.includes(a.id) || factsFor(a.id).maker?.key === key);

// Maker reputation, out of 100. A first, simple version for Rob to tune:
//   Track record, up to 70: the average Squawk Score of their Polly Tested agents x 0.7, less 10 for each one that
//     made something up on the honesty check. Only makers with a tested agent can earn these points.
//   Trust signals, up to 30: 10 if a registry checked who they are (a GitHub login or a domain in the MCP Registry),
//     5 for being listed 6 months or more (3 for a month or more), 5 for being listed in 2 or more places, 5 for
//     recent activity (code changed or on-chain activity in the last 90 days, or any on-chain feedback), 5 if at
//     least half their agents answered at their last health check.
//   Bulk warning: 50 or more agents from one maker takes 10 off the trust points. Spam wallets often do this.
// So a maker with nothing tested can reach 30 at most, and is labelled Unproven.
export function makerReputation({ key, stats, tested = [], places = 0, now = new Date() }) {
  const kind = String(key).split(':')[0];
  const lines = [];
  let track = null;
  if (tested.length) {
    const avg = tested.reduce((n, a) => n + a.score, 0) / tested.length;
    const fails = tested.filter((a) => a.honesty === 'failed').length;
    track = Math.max(0, Math.round(avg * 0.7) - fails * 10);
    lines.push({ points: track, of: 70, text: `${tested.length} Polly Tested ${tested.length === 1 ? 'agent' : 'agents'}, average Squawk Score ${Math.round(avg)}${fails ? `, ${fails} made something up` : ''}` });
  } else {
    lines.push({ points: 0, of: 70, text: 'Nothing Polly Tested yet, so no track record' });
  }
  // github and web makers only come from the MCP Registry, which checks them, so they count once a listing is there.
  const checked = Boolean(MAKER_KINDS[kind]?.checked && stats?.agents);
  lines.push({ points: checked ? 10 : 0, of: 10, text: checked ? 'Identity checked by the Official MCP Registry' : 'Identity not checked: anyone can make a wallet' });
  const days = stats?.since ? (now - new Date(stats.since)) / 86400000 : 0;
  const age = days >= 182 ? 5 : days >= 30 ? 3 : 0;
  lines.push({ points: age, of: 5, text: stats?.since ? `Listed for ${days < 1 ? 'less than a day' : `${Math.floor(days)} ${Math.floor(days) === 1 ? 'day' : 'days'}`}` : 'No listing date' });
  const where = Math.max(places, stats?.sources ?? 0);
  lines.push({ points: where >= 2 ? 5 : 0, of: 5, text: `Listed in ${where} ${where === 1 ? 'place' : 'places'}` });
  const fb = stats?.feedback ?? 0;
  const active = stats?.active ?? 0;
  lines.push({ points: fb > 0 || active > 0 ? 5 : 0, of: 5, text: [active ? `${active} ${active === 1 ? 'agent' : 'agents'} active in the last 90 days` : '',
    fb ? `${fb} on-chain feedback ${fb === 1 ? 'entry' : 'entries'}` : ''].filter(Boolean).join(', ') || 'No recent code or on-chain activity seen' });
  const checkedN = stats?.checked ?? 0;
  const upN = stats?.up ?? 0;
  lines.push({ points: checkedN && upN * 2 >= checkedN ? 5 : 0, of: 5, text: checkedN
    ? `${upN} of ${checkedN} ${checkedN === 1 ? 'agent' : 'agents'} answered at the last health check` : 'Not health checked yet' });
  let trust = lines.slice(1).reduce((n, l) => n + l.points, 0);
  const bulk = (stats?.agents ?? 0) >= 50;
  if (bulk) {
    lines.push({ points: -10, of: 0, text: `${stats.agents.toLocaleString('en-GB')} agents from one maker: a common sign of spam` });
    trust = Math.max(0, trust - 10);
  }
  const score = Math.min(100, (track ?? 0) + trust);
  const label = !tested.length ? 'Unproven' : score >= 80 ? 'Trusted' : score >= 60 ? 'Solid' : score >= 40 ? 'Mixed' : 'Risky';
  return { score, label, lines, bulk };
}

