// Pages for agents pulled in from other directories (src/directories.js).
import { esc, layout, dateLabel } from './views.js';
import { SOURCES } from './directories.js';

const PER_PAGE = 50;
export { PER_PAGE };

const sourceTag = (r) => `<span class="tag">${esc(r.source === 'erc8004' ? `ERC-8004${r.chain ? ` · ${r.chain}` : ''}` : 'MCP Registry')}</span>`;

function listedCard(r) {
  const link = r.url || r.endpoint;
  // Builders order a test on Agent Report Card with the address Polly should call.
  const testWith = r.endpoint || r.url || r.name;
  return `<div class="agent-card untested">
      <span class="grade grade-none" title="Not Polly Tested yet">?</span>
      <span class="agent-main"><strong>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener nofollow">${esc(r.name)}</a>` : esc(r.name)}</strong>
        <span class="muted small">${r.source === 'mcp' ? esc(r.source_id) : `Agent #${esc(r.source_id.split(':')[1])}`} · not Polly Tested yet</span>
        ${r.description ? `<span class="agent-desc">${esc(r.description)}</span>` : ''}</span>
      <span class="agent-tags">${sourceTag(r)}${r.x402 ? '<span class="tag">x402</span>' : ''}
        <a class="btn small" href="/get-polly-tested?agent=${encodeURIComponent(testWith)}">Get it tested</a></span>
    </div>`;
}

export function listedPage({ rows, total, query, source, page, counts }) {
  const all = counts.reduce((n, c) => n + c.untested, 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const link = (p, s = source) => {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (s) qs.set('source', s);
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
      <button type="submit">Search</button>
    </form>
    <p class="muted small">${total ? `${total.toLocaleString('en-GB')} ${total === 1 ? 'agent' : 'agents'}${query ? ` matching "${esc(query)}"` : ''}. Newest first.` : ''}</p>
    <div class="agent-list">${rows.map(listedCard).join('') || `<p class="muted">${all ? 'No agents match that search.' : 'Nothing synced yet. Check back tomorrow.'}</p>`}</div>
    ${pages > 1 ? `<nav class="pager" aria-label="Pages">
      ${page > 1 ? `<a class="btn ghost small" href="${esc(link(page - 1))}">Newer</a>` : ''}
      <span class="muted small">Page ${page} of ${pages.toLocaleString('en-GB')}</span>
      ${page < pages ? `<a class="btn ghost small" href="${esc(link(page + 1))}">Older</a>` : ''}</nav>` : ''}
    <section class="card cta-card section">
      <img src="/parrot.svg" width="56" height="56" alt="">
      <div><h2>Built one of these?</h2>
        <p>Get it Polly Tested and it moves into the directory with a real grade, every answer and a place in the Pecking Order.</p>
        <a class="btn" href="/get-polly-tested">Get Polly Tested</a></div>
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

export function adminDirectoriesPage({ counts, state, hasGraphKey, report }) {
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
  </section>`, { wide: true });
}
