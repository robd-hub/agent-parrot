// The compare page (src/compare.js): two agents side by side, one row per thing worth comparing.
import { esc, layout, gradeBadge, dateLabel } from './views.js';
import { GRADE_MEANING, categoryName } from './agents.js';
import { makerPath } from './makers.js';
import { securityFlags } from './security.js';
import { licenceInfo, privacyInfo } from './openness.js';
import { priceText, priceMissing, ago, licenceHtml, privacyHtml, reputationBlock } from './directory-views.js';

const muted = (t) => `<span class="muted">${esc(t)}</span>`;
const small = (t) => `<span class="muted small">${esc(t)}</span>`;
const day = (iso) => esc(dateLabel(iso));
const compareUrl = (a, b) => `/compare?${new URLSearchParams(Object.entries({ a, b }).filter(([, v]) => v))}`;

// A tiny line of every past Squawk Score, for the history row.
function sparkline(h) {
  if (h.length < 2) return '';
  const W = 140, H = 36, P = 4;
  const lo = Math.min(...h.map((p) => p.score)), hi = Math.max(...h.map((p) => p.score));
  const pts = h.map((p, i) => `${(P + (i / (h.length - 1)) * (W - 2 * P)).toFixed(1)},${(hi === lo ? H / 2 : P + (1 - (p.score - lo) / (hi - lo)) * (H - 2 * P)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts.join(' ')}"/></svg>`;
}

const uptimeOf = (r) => (r?.checks ? Math.round((100 * r.up_checks) / r.checks) : null);
const usdOf = (r) => (Number.isFinite(r?.health?.price?.usd) ? r.health.price.usd : null);
// Which side is better on a number, or null when only one side has one or they tie.
const better = (x, y, { lower = false } = {}) => (x == null || y == null || x === y ? null : (lower ? x < y : x > y) ? 'a' : 'b');

const cells = {
  grade(p) {
    if (p.kind !== 'tested') return `<span class="grade grade-none" title="Not Polly Tested yet">?</span> ${muted('Not Polly Tested yet, so no grade')}`;
    const a = p.agent;
    return `${gradeBadge(a.grade)}&nbsp; <b>${Number(a.score)}</b> Squawk Score<br>${small(`#${p.place} of ${p.total} in the Pecking Order · ${categoryName(a.category)}`)}
      <br><span class="small">${esc(GRADE_MEANING[a.grade])}</span>`;
  },
  honesty(p) {
    if (p.kind !== 'tested') return muted('Not checked');
    const h = p.agent.honesty;
    return h === 'failed' ? '<b class="bad">Made something up</b>' : h === 'passed' ? '<b class="ok">Honest</b>' : muted('Pending');
  },
  history(p) {
    if (p.kind !== 'tested') return muted('No tests, so no history');
    const h = (p.agent.history ?? []).filter((x) => Number.isFinite(x.score));
    if (!h.length) return `Tested ${day(p.agent.gradedAt)}`;
    if (h.length === 1) return `Tested once, ${day(h[0].date)}`;
    const change = h.at(-1).score - h[0].score;
    return `${sparkline(h)}<div>${h.length} tests since ${day(h[0].date)}: ${h.map((x) => Number(x.score)).join(' → ')}
      ${small(change === 0 ? '(no change)' : `(${change > 0 ? 'up' : 'down'} ${Math.abs(change)})`)}</div>`;
  },
  price(p) {
    const r = p.row;
    const live = r ? priceText(r) : '';
    if (p.kind === 'tested') return [esc(p.details.pricing ?? ''), live].filter(Boolean).join('<br>') || (p.details.x402 ? 'Pay per call over x402' : muted('Not published'));
    return live || muted(priceMissing(r));
  },
  health(p) {
    const r = p.row;
    if (!r?.endpoint) return muted(p.openserv ? 'Reached through OpenServ, so not checked directly' : 'No public address to check');
    if (!r.checked_at) return muted('Not checked yet');
    const up = uptimeOf(r);
    return `${r.up ? '<b class="ok">Answered</b>' : '<b class="bad">No answer</b>'} ${small(`last check ${dateLabel(r.checked_at)}`)}
      ${up == null ? '' : `<br>${up}% uptime ${small(`of ${r.checks} ${r.checks === 1 ? 'check' : 'checks'}`)}`}
      ${r.up && r.latency_ms != null ? `<br>${r.latency_ms >= 1000 ? `${(r.latency_ms / 1000).toFixed(1)} seconds` : `${Number(r.latency_ms)} ms`} to answer` : ''}`;
  },
  security(p) {
    if (!p.row) return muted(p.openserv ? 'Reached through the OpenServ marketplace: no public address of its own to check' : 'No public address listed, so nothing to check');
    return `<ul class="flags compact">${securityFlags(p.row).map((f) => `<li class="flag flag-${esc(f.level)}"><span class="flag-icon" aria-hidden="true">${{ good: '✓', info: 'i', warn: '!', bad: '✕' }[f.level]}</span> ${esc(f.text)}</li>`).join('')}</ul>`;
  },
  tools(p) {
    const t = p.row?.health?.tools;
    if (!t?.length) return muted(p.row?.checked_at ? 'Did not list any' : 'Not known yet');
    return `${t.length}${p.row.health.toolsMore ? '+' : ''} ${p.row.source === 'erc8004' && !p.row.details?.mcp ? 'skills' : 'tools'}<br>${small(t.slice(0, 5).map((x) => x.name).join(', ') + (t.length > 5 ? '…' : ''))}`;
  },
  activity(p) {
    const r = p.rows.find((x) => x.activity) ?? p.row;
    const out = [];
    const a = r?.activity;
    if (a?.found) out.push(`${a.pushedAt ? `Code changed ${esc(ago(a.pushedAt))}` : 'No code changes recorded'}${a.archived ? ' · <b class="bad">Archived</b>' : ''}<br>${small(`${Number(a.stars).toLocaleString('en-GB')} stars · ${Number(a.openIssues).toLocaleString('en-GB')} open issues`)}`);
    const chain = p.rows.find((x) => x.details?.lastActivity);
    if (chain) out.push(`On chain ${esc(ago(chain.details.lastActivity))}`);
    return out.join('<br>') || muted(r?.details?.repo ? 'Not read yet' : 'Not tracked: no public code or on-chain record');
  },
  licence: (p) => licenceHtml(licenceInfo({ row: p.row ?? p.rows.find((r) => r.details?.repo), facts: p.details?.facts, openserv: p.openserv })),
  privacy: (p) => privacyHtml(privacyInfo({ row: p.row, facts: p.details?.facts, openserv: p.openserv, x402: p.details?.x402 })),
  maker(p) {
    if (!p.maker) return muted(p.makerNote || 'Not known');
    const path = makerPath(p.maker.key);
    return `${path ? `<a href="${esc(path)}">${esc(p.maker.name)}</a>` : esc(p.maker.name)}${p.rep ? reputationBlock(p.rep, { compact: true }) : `<br>${small('No reputation score yet')}`}`;
  },
  places(p) {
    if (!p.places.length) return muted('Nowhere else we know of');
    return p.places.map((l) => `<span class="tag">${esc(l.name)}${l.detail ? ` <span class="muted">${esc(l.detail)}</span>` : ''}</span>`).join(' ');
  },
};

const ROWS = [
  ['grade', 'Polly grade', (a, b) => better(a.agent?.score, b.agent?.score)],
  ['honesty', 'Honesty check'],
  ['history', 'Grade history'],
  ['price', 'Price per call', (a, b) => better(usdOf(a.row), usdOf(b.row), { lower: true })],
  ['health', 'Health and uptime', (a, b) => better(uptimeOf(a.row), uptimeOf(b.row))],
  ['security', 'Security flags'],
  ['tools', 'What it can do'],
  ['activity', 'Activity'],
  ['licence', 'Licence'],
  ['privacy', 'Data privacy'],
  ['maker', 'Maker and reputation', (a, b) => better(a.rep?.score, b.rep?.score)],
  ['places', 'Where it is listed', (a, b) => better(a.places.length, b.places.length)],
];

function head(p, other) {
  return `<div class="cmp-head">
    <p class="eyebrow">${p.kind === 'tested' ? 'Polly Tested' : 'Not Polly Tested yet'}</p>
    <h2><a href="${esc(p.path)}">${esc(p.name)}</a></h2>
    ${p.description ? `<p class="small muted cmp-desc">${esc(p.description)}</p>` : ''}
    <a class="small" href="${esc(compareUrl(other.ref))}" aria-label="${esc(`Swap ${p.name} for another agent`)}">Change</a>
  </div>`;
}

function table(a, b) {
  return `<div class="cmp" role="table" aria-label="${esc(`${a.name} compared with ${b.name}`)}">
    <div class="cmp-row cmp-top" role="row"><div class="cmp-label" role="columnheader"><a class="small" href="${esc(compareUrl(b.ref, a.ref))}">Swap sides</a></div>
      <div role="columnheader">${head(a, b)}</div><div role="columnheader">${head(b, a)}</div></div>
    ${ROWS.map(([key, label, win]) => {
      const w = win ? win(a, b) : null;
      const cell = (p, side) => `<div role="cell" class="cmp-cell${w === side ? ' cmp-win' : ''}">${w === side ? '<span class="tag tag-pass cmp-badge">Better</span> ' : ''}${cells[key](p)}</div>`;
      return `<div class="cmp-row" role="row"><div class="cmp-label" role="rowheader">${esc(label)}</div>${cell(a, 'a')}${cell(b, 'b')}</div>`;
    }).join('')}
  </div>
  <p class="muted small">"Better" marks the higher Squawk Score, uptime, maker reputation and number of listings, and the lower price,
    only where both agents have a number. Health, price and security come from each agent's last health check. Licence and privacy
    say "not known" unless the agent's code or its maker tells us.</p>`;
}

function picker({ a, query, results }) {
  const which = a ? 'second' : 'first';
  return `<section class="card section">
    <h2>Pick the ${which} agent</h2>
    <form method="get" action="/compare" class="listed-search" role="search">
      ${a ? `<input type="hidden" name="a" value="${esc(a.ref)}">` : ''}
      <label class="sr-only" for="cmp-q">Search agents</label>
      <input id="cmp-q" name="q" value="${esc(query)}" maxlength="80" placeholder="Search tested and listed agents">
      <button type="submit">Search</button>
    </form>
    ${query ? '' : '<p class="muted small">Or pick a Polly Tested agent:</p>'}
    <div class="agent-list">${results.filter((r) => r.ref !== a?.ref).map((r) => `<a class="agent-card" href="${esc(a ? compareUrl(a.ref, r.ref) : compareUrl(r.ref))}">
      ${r.grade ? gradeBadge(r.grade) : '<span class="grade grade-none" title="Not Polly Tested yet">?</span>'}
      <span class="agent-main"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.note)}</span></span></a>`).join('') || `<p class="muted">No agents match "${esc(query)}".</p>`}</div>
  </section>`;
}

export function comparePage({ a, b, query = '', results = [], missing = false }) {
  const both = a && b;
  const title = both ? `${a.name} vs ${b.name}` : 'Compare two agents';
  return layout(title, `
    <section class="page-head">
      <p class="eyebrow">Compare</p>
      <h1>${both ? `${esc(a.name)} <span class="muted">vs</span> ${esc(b.name)}` : 'Compare two agents'}</h1>
      <p class="lead">${both ? 'Side by side: grade, price, uptime, security, licence, maker and where each is listed.'
        : 'Pick any two agents, Polly Tested or not, and see them side by side.'}</p>
      ${a && !b ? `<p>First pick: <a href="${esc(a.path)}"><b>${esc(a.name)}</b></a> · <a class="small" href="/compare">Start again</a></p>` : ''}
      ${missing ? '<p class="error">We couldn\'t find one of those agents. It may have left its directory. Pick another below.</p>' : ''}
    </section>
    ${both ? table(a, b) : picker({ a: a ?? b, query, results })}`, {
    wide: true,
    description: both ? `${a.name} vs ${b.name}: grade, price per call, uptime, security flags, licence, maker reputation and listings side by side on Agent Parrot.`
      : 'Compare any two AI agents side by side: Polly grade, price, uptime, security, licence and maker reputation.',
  });
}
