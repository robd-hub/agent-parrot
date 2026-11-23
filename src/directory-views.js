// Pages for agents pulled in from other directories (src/directories.js).
import { esc, layout, dateLabel, gradeBadge } from './views.js';
import { ratingTag, ratingFact, reviewsBlock, makerReviewsBlock, makerRatingLine, makerRatingTag } from './review-views.js';
import { SOURCES, EXPLORERS } from './directories.js';
import { MAKER_KINDS, makerPath } from './makers.js';
import { securityFlags, cardFlags, toolPowers, POWERS } from './security.js';
import { reportBox, flagItem } from './agent-report-views.js';
import { communityTag } from './agent-reports.js';
import { licenceInfo, privacyInfo } from './openness.js';

// A listed agent's own page: /listed/<source>/<id>. MCP ids have slashes, kept as path segments.
export const listedPath = (r) => `/listed/${encodeURIComponent(r.source)}/${String(r.source_id).split('/').map(encodeURIComponent).join('/')}`;

// One "label: value" line in a key details list. A blank shows as not known, with the reason when we have one.
const ext = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(text)}</a>`;
const row = (label, value, missing = 'Not given by the source') => `<div><dt>${esc(label)}</dt><dd>${value || `<span class="muted">${esc(missing)}</span>`}</dd></div>`;
const tags = (items) => (items?.length ? items.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') : '');
const linkList = (links) => links.filter(Boolean).filter((l) => l?.url).map((l) => ext(l.url, l.name)).join(' · ');
const day = (iso) => (iso ? esc(dateLabel(iso)) : '');
const makerLink = (name, key, url) => {
  const path = makerPath(key);
  const shown = url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  return `${path ? `<a href="${esc(path)}">${esc(name)}</a>` : esc(name)}${url && shown !== name ? ` <span class="muted small">(${ext(url, shown)})</span>` : ''}`;
};
export const detailsList = (rows) => `<dl class="details">${rows.join('')}</dl>`;

// Health check results (src/health.js) for one listed agent.
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} seconds` : `${Number(n)} ms`);
export const healthTag = (r) => (!r.checked_at ? '' : r.up ? '<span class="tag tag-pass" title="Answered at the last health check">Up</span>'
  : '<span class="tag tag-fail" title="Did not answer at the last health check">Down</span>');
const toolsOf = (r) => r.health?.tools ?? null;
export function healthRows(r) {
  if (!r.endpoint) return [row('Health check', '', 'No address to check')];
  if (!r.checked_at) return [row('Health check', '', 'Not checked yet: Polly works through every listed agent, tested and claimed ones first')];
  const h = r.health ?? {};
  const uptime = r.checks ? Math.round((100 * r.up_checks) / r.checks) : null;
  return [
    row('Last health check', `${r.up ? '<b class="ok">Answered</b>' : '<b class="bad">No answer</b>'} on ${day(r.checked_at)}${h.note ? ` <span class="muted small">(${esc(h.note)})</span>` : ''}`),
    row('Response time', r.up && r.latency_ms != null ? esc(ms(r.latency_ms)) : '', 'Not measured'),
    row('Uptime', uptime == null ? '' : `${uptime}% <span class="muted small">of ${Number(r.checks)} ${r.checks === 1 ? 'check' : 'checks'}</span>`),
    h.server?.name ? row('Says it is', `${esc(h.server.name)}${h.server.version ? ` ${esc(h.server.version)}` : ''}${h.server.protocol ? ` <span class="muted small">protocol ${esc(h.server.protocol)}</span>` : ''}`) : '',
  ];
}
// Price per call, from the agent's own x402 offer at its last health check.
export function priceText(r) {
  const p = r?.health?.price;
  if (p?.display) return `${esc(p.display)} <span class="muted small">(the agent's own asking price at its last check; we never pay)</span>`;
  return '';
}
export const priceMissing = (r) => (r.x402 && !r.checked_at ? 'Takes x402 payments; the price is read at its first health check' : r.x402 ? 'Takes x402 payments, but did not name a price when asked without paying (it may only ask once a tool is used)'
  : r.source === 'mcp' ? 'Not stated' : 'No x402');
export const shortPrice = (r) => (Number.isFinite(r?.health?.price?.usd) ? `$${r.health.price.usd < 0.01 ? Number(r.health.price.usd.toFixed(6)) : r.health.price.usd.toFixed(2)}/call` : '');

// Code and on-chain activity rows.
export const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`;
};
export function activityRows(r) {
  const d = r.details ?? {};
  const out = [];
  if (d.repo && /^https:\/\/github\.com\//.test(d.repo)) {
    const a = r.activity;
    out.push(row('Code activity', !a ? '' : !a.found ? '<span class="muted">Repository not found on GitHub (private, moved or deleted)</span>'
      : `${a.pushedAt ? `Last change ${esc(ago(a.pushedAt))} <span class="muted small">(${day(a.pushedAt)})</span>` : 'No changes recorded'}${a.archived ? ' · <b class="bad">Archived</b>' : ''}<br>
        <span class="muted small">${Number(a.stars).toLocaleString('en-GB')} ${a.stars === 1 ? 'star' : 'stars'} · ${Number(a.openIssues).toLocaleString('en-GB')} open issues and pull requests · ${Number(a.forks).toLocaleString('en-GB')} forks${a.language ? ` · ${esc(a.language)}` : ''}${a.license && a.license !== 'NOASSERTION' ? ` · ${esc(a.license)} licence` : ''}</span>`,
    'Not read yet: GitHub is checked for each repo once a week'));
  } else if (r.source === 'mcp') {
    out.push(row('Code activity', '', d.repo ? 'Code is not on GitHub, so not tracked' : 'No public code listed'));
  }
  if (r.source === 'erc8004') {
    out.push(row('Last on-chain activity', d.lastActivity ? `${esc(ago(d.lastActivity))} <span class="muted small">(${day(d.lastActivity)}, on the ERC-8004 registry)</span>` : '', 'Not recorded by the registry index'));
    out.push(row('Paid jobs', '', 'Not tracked: no public source counts them yet'));
  }
  return out;
}

// Licence and data-privacy rows (src/openness.js).
export const licenceHtml = (l) => (l.known ? `${l.open === true ? '<b class="ok">' : '<b>'}${esc(l.text)}</b>` : `<span class="muted">${esc(l.text)}</span>`)
  + (l.note ? ` <span class="muted small">(${esc(l.note)})</span>` : '');
export const privacyHtml = (p) => `${p.policy ? (p.policy.url ? ext(p.policy.url, p.policy.text) : esc(p.policy.text))
  : '<span class="muted">Privacy policy not known: the maker hasn\'t given us one</span>'}${p.lines.map((x) => `<br><span class="small">${esc(x)}</span>`).join('')}`;
const opennessRows = (l, p) => [row('Licence', licenceHtml(l)), row('Data privacy', privacyHtml(p))];

// The directory listing we health check for a tested agent: one with an address, MCP first.
export const mainRow = (rows = []) => rows.filter((r) => r.endpoint).sort((a, b) => (a.source === 'mcp' ? -1 : 1) - (b.source === 'mcp' ? -1 : 1))[0] ?? null;
export const compareHref = (ref) => `/compare?a=${encodeURIComponent(ref)}`;
export const listedRef = (r) => `${r.source}:${r.source_id}`;

export function toolsBlock(r) {
  const tools = toolsOf(r);
  if (!tools?.length) return '';
  const a2a = r.source === 'erc8004' && !r.details?.mcp;
  return `<section class="card section"><h2>What it can do: ${tools.length}${r.health?.toolsMore ? '+' : ''} ${a2a ? 'skills' : 'tools'}</h2>
    <p class="muted small">Read from the agent itself at its last health check.</p>
    <ul class="tool-list">${tools.map((t) => `<li><code>${esc(t.name)}</code>${toolPowers(t).map((p) => ` <span class="tag tag-mid">${esc(POWERS[p].label)}</span>`).join('')}${t.description ? ` <span class="muted">${esc(t.description)}</span>` : ''}</li>`).join('')}</ul></section>`;
}

// Security flags (src/security.js) for an agent with a public address.
// `report` (from src/agent-reports.js reportSection) adds confirmed community reports to the flags, and the report button.
export function securityBlock(r, { intro = '', report = null } = {}) {
  const flags = [...(report?.flags ?? []), ...securityFlags(r)];
  return `<section class="card section" id="security"><h2>Security</h2>
    ${intro}<ul class="flags">${flags.map(flagItem).join('')}</ul>
    <p class="muted small">From the agent's address, its registry entry and the tools it listed at its last health check. Tool powers come from each tool's own safety notes where it gives them, otherwise from its name, so treat them as a guide, not a security audit.${report?.flags.length ? ' Community reports come from members and are shown only after Polly has checked them.' : ''}</p>
    ${reportBox(report)}</section>`;
}

// The reputation box on a maker's page and, smaller, on agent pages.
export function reputationBlock(rep, { compact = false, path } = {}) {
  if (!rep) return '';
  const cls = rep.label === 'Unproven' ? 'none' : rep.score >= 80 ? 'A' : rep.score >= 60 ? 'B' : rep.score >= 40 ? 'C' : 'F';
  const head = `<div class="rep-head"><span class="rep-score rep-${cls}">${Number(rep.score)}</span>
      <div><strong>Maker reputation: ${esc(rep.label)}</strong><br><span class="muted small">out of 100${path ? ` · <a href="${esc(path)}">See the maker</a>` : ''}</span></div></div>`;
  if (compact) return `<div class="rep compact">${head}</div>`;
  return `<div class="rep">${head}<ul class="rep-lines">${rep.lines.map((l) => `<li><b>${l.points > 0 ? '+' : ''}${Number(l.points)}</b>${l.of ? `<span class="muted">/${Number(l.of)}</span>` : ''} ${esc(l.text)}</li>`).join('')}</ul>
    <p class="muted small">Up to 70 points come from the grades of this maker's Polly Tested agents and up to 30 from trust signals. Makers with nothing tested can reach 30 at most.</p></div>`;
}

// Key details for a tested agent (from src/makers.js testedDetails).
export function testedDetailsBlock(d, { gradedAt, rep, rows = [], report = null, makerRating = null } = {}) {
  const checked = mainRow(rows);
  const openserv = Boolean(d.connection?.startsWith('OpenServ'));
  const licence = licenceInfo({ row: checked ?? rows.find((r) => r.details?.repo), facts: d.facts, openserv });
  const privacy = privacyInfo({ row: checked, facts: d.facts, openserv, x402: d.x402 });
  return `<section class="card section"><h2>Key details</h2>
    ${detailsList([
      row('Made by', d.maker ? makerLink(d.maker.name, d.makerKey, d.maker.url) : '', d.makerNote || 'Not known yet'),
      row('Links', linkList(d.links), 'No public links yet'),
      row('First listed', d.firstListed ? `${day(d.firstListed)}${d.firstListedWhere ? ` <span class="muted small">(${esc(d.firstListedWhere)})</span>` : ''}` : '', 'Not known: no source gives a launch date'),
      row('Polly Tested', day(gradedAt)),
      row('Runs on', esc(d.platform ?? '')),
      row('How to connect', esc(d.connection ?? '')),
      row('AI model', esc(d.model ?? ''), 'Not published by the maker or the marketplace'),
      d.version ? row('Version', esc(d.version)) : '',
      row('Chains', tags(d.chains), 'None'),
      row('Pricing', [esc(d.pricing ?? ''), checked ? priceText(checked) : ''].filter(Boolean).join('<br>') || (d.x402 ? 'Pay per call over x402' : ''), 'Not published'),
      ...(checked ? [...healthRows(checked), ...activityRows(checked)] : [row('Health check', '', d.connection?.startsWith('OpenServ') ? 'Reached through OpenServ, so not checked directly' : 'Not listed with a public address yet')]),
      ...opennessRows(licence, privacy),
    ])}
    ${d.note ? `<p class="muted small">${esc(d.note)}</p>` : ''}
    ${rep ? reputationBlock(rep, { compact: true, path: makerPath(d.makerKey) }) + makerRatingLine(makerRating, makerPath(d.makerKey)) : ''}
  </section>
  ${checked ? securityBlock(checked, { report }) + toolsBlock(checked)
    : `<section class="card section" id="security"><h2>Security</h2>${report?.flags.length ? `<ul class="flags">${report.flags.map(flagItem).join('')}</ul>` : ''}
      <p class="muted">${d.connection?.startsWith('OpenServ') ? 'Reached through the OpenServ marketplace, which handles access and payment, so there is no public address of its own to check.' : 'No public address listed yet, so nothing to check.'}</p>${reportBox(report)}</section>`}`;
}

const PER_PAGE = 50;
export { PER_PAGE };

const sourceTag = (r) => `<span class="tag">${esc(r.source === 'erc8004' ? `ERC-8004${r.chain ? ` · ${r.chain}` : ''}` : 'MCP Registry')}</span>`;

function listedCard(r, makerCounts = {}, rating = null, reports = null, makerRating = null) {
  const link = listedPath(r);
  const others = (makerCounts[r.maker_key] ?? 0) - 1;
  return `<div class="agent-card untested">
      <span class="grade grade-none" title="Not Polly Tested yet">?</span>
      <span class="agent-main"><strong><a href="${esc(link)}">${esc(r.name)}</a></strong>
        <span class="muted small">${r.maker_name ? `by ${makerPath(r.maker_key) ? `<a href="${esc(makerPath(r.maker_key))}">${esc(r.maker_name)}</a>` : esc(r.maker_name)}${others > 0 ? ` (+${others.toLocaleString('en-GB')} more)` : ''}` : r.source === 'mcp' ? esc(r.source_id) : `Agent #${esc(r.source_id.split(':')[1])}`} · not Polly Tested yet</span>
        ${r.description ? `<span class="agent-desc">${esc(r.description)}</span>` : ''}</span>
      <span class="agent-tags">${ratingTag(rating)}${makerRatingTag(makerRating)}${healthTag(r)}${toolsOf(r)?.length ? `<span class="tag">${toolsOf(r).length}${r.health?.toolsMore ? '+' : ''} ${r.source === 'erc8004' && !r.details?.mcp ? 'skills' : 'tools'}</span>` : ''}${shortPrice(r) ? `<span class="tag">${esc(shortPrice(r))}</span>` : ''}${[communityTag(reports), ...cardFlags(r)].filter(Boolean).slice(0, 2).map((f) => `<span class="tag ${f.level === 'bad' ? 'tag-fail' : 'tag-mid'}">${esc(f.text)}</span>`).join('')}${sourceTag(r)}${r.x402 ? '<span class="tag">x402</span>' : ''}
        <a class="btn small ghost" href="${esc(compareHref(listedRef(r)))}">Compare</a>
        <a class="btn small" href="/request?ref=${encodeURIComponent(listedRef(r))}">Test this agent</a></span>
    </div>`;
}

export function listedPage({ rows, total, query, source, live = false, page, counts, makerCounts = {}, ratings = {}, reports = {}, makerRatings = {} }) {
  const all = counts.reduce((n, c) => n + c.untested, 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const link = (p, s = source, l = live) => {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (s) qs.set('source', s);
    if (l) qs.set('live', '1');
    if (p > 1) qs.set('page', String(p));
    return `/listed${qs.size ? `?${qs}` : ''}`;
  };
  const tabs = [['', `All (${all.toLocaleString('en-GB')})`],
    ...Object.entries(SOURCES).map(([id, s]) => [id, `${s.name} (${(counts.find((c) => c.source === id)?.untested ?? 0).toLocaleString('en-GB')})`])];
  return layout('Agents listed elsewhere', `
    <section class="page-head">
      <p class="eyebrow">The wider flock</p>
      <h1>Listed elsewhere, not Polly Tested yet</h1>
      <p class="lead">Agents from public directories: the Official MCP Registry and the on-chain ERC-8004 registry.
        They're here so you can find them, but Polly hasn't checked their work, so none of them has a grade.
        For graded agents, see the <a href="/agents">directory</a>.</p>
    </section>
    <nav class="tabs" aria-label="Directories">${tabs.map(([id, name]) => `<a href="${esc(link(1, id))}"${(source || '') === id ? ' aria-current="page"' : ''}>${esc(name)}</a>`).join('')}</nav>
    <form method="get" action="/listed" class="listed-search" role="search">
      ${source ? `<input type="hidden" name="source" value="${esc(source)}">` : ''}
      <label class="sr-only" for="listed-q">Search agents</label>
      <input id="listed-q" name="q" value="${esc(query)}" maxlength="80" placeholder="Search by name or what it does">
      ${live ? '<input type="hidden" name="live" value="1">' : ''}
      <button type="submit">Search</button>
    </form>
    <p class="small"><a href="/compare">Compare two agents side by side</a> · <a href="${esc(link(1, source, !live))}">${live ? 'Show all agents' : 'Only show agents that answered their last health check'}</a></p>
    <p class="muted small">${total ? `${total.toLocaleString('en-GB')} ${total === 1 ? 'agent' : 'agents'}${query ? ` matching "${esc(query)}"` : ''}${live ? ' that answered their last health check' : ''}. Newest first.` : ''}</p>
    <div class="agent-list">${rows.map((r) => listedCard(r, makerCounts, ratings[listedRef(r)], reports[listedRef(r)], makerRatings[r.maker_key])).join('') || `<p class="muted">${all ? 'No agents match that search.' : 'Nothing synced yet. Check back tomorrow.'}</p>`}</div>
    ${pages > 1 ? `<nav class="pager" aria-label="Pages">
      ${page > 1 ? `<a class="btn ghost small" href="${esc(link(page - 1))}">Newer</a>` : ''}
      <span class="muted small">Page ${page} of ${pages.toLocaleString('en-GB')}</span>
      ${page < pages ? `<a class="btn ghost small" href="${esc(link(page + 1))}">Older</a>` : ''}</nav>` : ''}
    <section class="card cta-card section">
      <img src="/parrot.svg" width="56" height="56" alt="">
      <div><h2>Built one of these?</h2>
        <p>Get it Polly Tested and it moves into the directory with a real grade, every answer and a place in the Pecking Order.</p>
        <a class="btn" href="/request">Request a Polly Test</a></div>
    </section>`, { description: 'AI agents from the Official MCP Registry and the ERC-8004 registry that have not been Polly Tested yet.' });
}

// "Listed on" badges for a tested agent's page.
export function listedOnBlock(list) {
  if (!list.length) return '';
  return `<div class="listed-on"><span class="muted small">Also listed on</span>
    ${list.map((l) => {
      const label = `${esc(l.name)}${l.detail ? ` <span class="muted">${esc(l.detail)}</span>` : ''}`;
      return l.url ? `<a class="tag" href="${esc(l.url)}" target="_blank" rel="noopener">${label}</a>` : `<span class="tag">${label}</span>`;
    }).join('')}</div>`;
}

export function adminDirectoriesPage({ counts, state, hasGraphKey, hasGithubToken = false, report, health, healthReport }) {
  const line = (id) => {
    const c = counts.find((x) => x.source === id);
    const at = state[`sync_${id}_at`];
    return `<tr><td>${esc(SOURCES[id].name)}</td><td>${Number(c?.total ?? 0).toLocaleString('en-GB')}</td><td>${Number(c?.untested ?? 0).toLocaleString('en-GB')}</td>
      <td>${at ? esc(dateLabel(at)) : '<span class="muted">not finished yet</span>'}</td></tr>`;
  };
  return layout('Directories', `<section class="card">
    <div class="card-head"><h1>Other directories</h1><nav class="tabs inline-tabs"><a href="/admin">Admin</a><a href="/listed">See the page</a></nav></div>
    <p>Agents are copied in every morning at 05:00 UTC. A big first copy can take a few runs: each run carries on where the last stopped, and one run can take up to 3 minutes.
      Press the button to run one now.</p>
    ${report ? `<div class="notice"><ul>${report.map((r) => `<li><b>${esc(SOURCES[r.source].name)}:</b> ${r.skipped ? esc(r.skipped)
      : `${Number(r.saved)} saved, ${Number(r.removed)} taken out. ${r.done ? 'Up to date.' : 'More to copy: run it again.'}`}${r.error ? ` <span class="error">${esc(r.error)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${hasGraphKey ? '' : '<p class="muted">ERC-8004 is off until GRAPH_API_KEY is set in Vercel (a free key from thegraph.com/studio).</p>'}
    <div class="table-scroll"><table><thead><tr><th>Directory</th><th>Agents</th><th>Not tested</th><th>Last full copy</th></tr></thead>
      <tbody>${Object.keys(SOURCES).map(line).join('')}</tbody></table></div>
    <form method="post" action="/admin/directories/sync"><button type="submit">Copy now</button></form>
  </section>
  <section class="card">
    <h2>Health checks</h2>
    <p>Each agent with an address gets one short visit at most once a day, to see if it answers and what tools it lists. Runs twice a day; each run checks the ones checked longest ago.</p>
    ${healthReport ? `<div class="notice">Checked ${Number(healthReport.checked)}; ${Number(healthReport.up)} answered.${healthReport.activity
      ? ` GitHub activity read for ${Number(healthReport.activity.checked)} ${healthReport.activity.checked === 1 ? 'repo' : 'repos'}.${healthReport.activity.stopped ? ` ${esc(healthReport.activity.stopped)}.` : ''}` : ''}</div>` : ''}
    ${hasGithubToken ? '' : '<p class="muted small">Code activity is read from GitHub without a key, so only about 25 repos a run. Add a GITHUB_TOKEN in Vercel (a fine-grained token with no extra permissions) to read up to 400.</p>'}
    ${health ? `<p><b>${Number(health.checked).toLocaleString('en-GB')}</b> of ${Number(health.checkable).toLocaleString('en-GB')} checked so far, <b>${Number(health.up).toLocaleString('en-GB')}</b> answered last time.</p>` : ''}
    <form method="post" action="/admin/directories/health"><button type="submit">Check a batch now</button></form>
  </section>`, { wide: true });
}

// One listed agent's page, with everything its directory says about it.
export function listedAgentPage({ r, rep, more = [], reviews = null, report = null, claim = '', makerRating = null }) {
  const d = r.details ?? {};
  const isMcp = r.source === 'mcp';
  const kind = MAKER_KINDS[String(r.maker_key).split(':')[0]];
  const connect = isMcp
    ? [d.transports?.length ? `MCP over ${d.transports.join(', ')}` : 'MCP', d.needsKey ? 'needs a key or payment' : ''].filter(Boolean).join(', ')
    : [d.mcp ? `MCP${d.mcp.version ? ` ${d.mcp.version}` : ''}` : '', d.a2a ? `A2A${d.a2a.version ? ` ${d.a2a.version}` : ''}` : ''].filter(Boolean).join(' and ');
  const links = [
    r.url && r.url !== d.repo ? { name: 'Website', url: r.url } : null,
    d.repo ? { name: 'Code', url: d.repo } : null,
    r.endpoint ? { name: 'Agent address', url: r.endpoint } : null,
    d.registration ? { name: 'Registration file', url: d.registration } : null,
    isMcp ? { name: 'Registry entry (raw data)', url: `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(r.source_id)}` } : null,
    !isMcp && d.owner && EXPLORERS[r.source_id.split(':')[0]] ? { name: 'Owner on the block explorer', url: r.maker_url } : null,
  ];
  return layout(`${r.name}: not Polly Tested yet`, `
    <section class="agent-hero">
      <span class="grade grade-none xl" title="Not Polly Tested yet">?</span>
      <div>
        <p class="eyebrow">${esc(SOURCES[r.source]?.name ?? r.source)}${r.chain ? ` · ${esc(r.chain)}` : ''} · not Polly Tested yet</p>
        ${healthTag(r)} ${claim}
        <h1>${esc(r.name)}</h1>
        ${r.description ? `<p class="lead">${esc(r.description)}</p>` : '<p class="lead muted">No description given.</p>'}
        <p class="meaning">Polly hasn't checked this agent's work, so it has no grade. The details below are what its directory says.</p>
        ${reviews ? `<div class="facts">${ratingFact(reviews.summary)}</div>` : ''}
        <div class="hero-actions">
          ${r.url || r.endpoint ? `<a class="btn" href="${esc(r.url || r.endpoint)}" target="_blank" rel="noopener nofollow">Visit the agent</a>` : ''}
          <a class="btn ghost" href="/request?ref=${encodeURIComponent(listedRef(r))}">Test this agent</a>
          <a class="btn ghost" href="${esc(compareHref(listedRef(r)))}">Compare</a>
        </div>
      </div>
    </section>
    <section class="card section"><h2>Key details</h2>
      ${detailsList([
        row('Made by', r.maker_name ? `${makerLink(r.maker_name, r.maker_key, isMcp ? r.maker_url : null)}${kind ? ` <span class="muted small">${esc(kind.name)}${kind.checked ? ', checked by the registry' : ''}</span>` : ''}` : ''),
        row('Links', linkList(links)),
        row(isMcp ? 'First published' : 'Registered on chain', day(r.first_published_at)),
        row('Last updated', day(r.updated_at)),
        row(isMcp ? 'Registry name' : 'Agent number', esc(isMcp ? r.source_id : `#${r.source_id.split(':')[1]}`)),
        isMcp ? row('Version', esc(d.version ?? '')) : row('Chain', esc(r.chain ?? '')),
        row('How to connect', esc(connect)),
        isMcp ? row('Packages', tags((d.packages ?? []).map((p) => `${p.type}: ${p.id}`)), 'None: hosted only') : '',
        !isMcp ? row('ENS name', esc(d.ens ?? ''), 'None') : '',
        !isMcp ? row('Skills', tags(d.skills), 'None listed') : '',
        !isMcp ? row('Trust methods', tags(d.trusts), 'None listed') : '',
        !isMcp ? row('On-chain feedback', d.feedback ? `${Number(d.feedback).toLocaleString('en-GB')} ${d.feedback === 1 ? 'entry' : 'entries'}` : '', 'None yet') : '',
        row('Price per call', priceText(r), priceMissing(r)),
        row('AI model', '', 'Not published: neither registry asks for it'),
        ...healthRows(r),
        ...activityRows(r),
        ...opennessRows(licenceInfo({ row: r }), privacyInfo({ row: r })),
      ])}
    </section>
    ${securityBlock(r, { report })}
    ${toolsBlock(r)}
    ${reviews ? reviewsBlock(reviews) : ''}
    ${rep ? `<section class="card section"><h2>Who made it</h2>${reputationBlock(rep, { path: makerPath(r.maker_key) })}${makerRatingLine(makerRating, makerPath(r.maker_key))}
      ${more.length ? `<h3>More from ${esc(r.maker_name)}</h3><ul class="plain-list">${more.map((m) => `<li><a href="${esc(listedPath(m))}">${esc(m.name)}</a></li>`).join('')}</ul>` : ''}</section>` : ''}
    <section class="card cta-card section">
      <img src="/parrot.svg" width="56" height="56" alt="">
      <div><h2>Did you build ${esc(r.name)}?</h2>
        <p>Get it Polly Tested and it moves into the directory with a real grade, and your maker reputation goes up with it.</p>
        <a class="btn" href="/request?ref=${encodeURIComponent(listedRef(r))}">Request a Polly Test</a></div>
    </section>`, { description: `${r.name}${r.maker_name ? ` by ${r.maker_name}` : ''}: ${r.description || 'an AI agent'} Listed on ${SOURCES[r.source]?.name ?? r.source}, not Polly Tested yet.` });
}

// A maker's page: their reputation, their tested agents and everything else they have listed.
export function makerPage({ key, name, url, rep, tested, listed, total, ratings = {}, memberRating = null, recentReviews = [] }) {
  const [kindId] = key.split(':');
  const kind = MAKER_KINDS[kindId];
  return layout(`${name}: maker reputation`, `
    <section class="page-head">
      <p class="eyebrow">Maker · ${esc(kind.name)}${kind.checked ? ', checked by the Official MCP Registry' : ''}</p>
      <h1>${esc(name)}</h1>
      ${url ? `<p>${ext(url, url.replace(/^https?:\/\//, ''))}</p>` : ''}
      ${kindId === 'wallet' ? '<p class="muted small">A wallet shows who controls these registrations, not who they are.</p>' : ''}
    </section>
    <section class="card section">${reputationBlock(rep)}</section>
    ${makerReviewsBlock({ summary: memberRating, recent: recentReviews, name, names: Object.fromEntries(tested.map((a) => [a.id, a.name])) })}
    <section class="section"><h2>Polly Tested</h2>
      <div class="agent-list">${tested.map((a) => `<a class="agent-card" href="/agents/${esc(a.id)}">${gradeBadge(a.grade)}<span class="agent-main"><strong>${esc(a.name)}</strong>
        <span class="muted small">Squawk Score ${Number(a.score)}</span><span class="agent-desc">${esc(a.description)}</span></span><span class="agent-tags">${ratingTag(ratings[a.id])}</span></a>`).join('') || '<p class="muted">Nothing tested yet.</p>'}</div></section>
    <section class="section"><h2>Listed elsewhere${total ? ` (${Number(total).toLocaleString('en-GB')})` : ''}</h2>
      <div class="agent-list">${listed.filter((r) => !r.tested_id).map((r) => listedCard(r, {}, ratings[listedRef(r)])).join('') || '<p class="muted">Nothing else listed.</p>'}</div>
      ${total > listed.length ? `<p class="muted small">Showing the newest ${listed.length}.</p>` : ''}</section>`,
  { description: `${name}: maker reputation ${rep.score}/100 (${rep.label}) on Agent Parrot, from the grades of their agents and trust signals.` });
}
