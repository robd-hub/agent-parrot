// Organiser pages, behind ADMIN_PASSWORD.
import { esc, layout, dateLabel, paras, ROLES } from './views.js';
import { CATEGORIES, categoryName } from './agents.js';

const roleLabel = (r) => ROLES.find(([v]) => v === r)?.[1] ?? '';
const provider = (id) => id.split(':')[0];

export function adminHome({ o, members, syncedAt }) {
  const rows = members.map((m) => `<tr><td>${m.member_number ? `#${Number(m.member_number)}` : ''}</td><td>${esc(m.name)}</td>
      <td>${esc(m.email ?? '')}</td><td>${esc(provider(m.id))}</td><td>${esc(roleLabel(m.role))}</td><td>${m.squawk_optin ? 'Yes' : ''}</td>
      <td>${esc(m.joined_from ?? '')}</td><td>${esc(dateLabel(m.consent_at))}</td></tr>`).join('');
  return layout('Admin', `<section class="card">
    <div class="card-head"><h1>Admin</h1><nav class="tabs inline-tabs"><a href="/admin/news">Daily Hallucination</a><a href="/admin/squawk">The Squawk</a><a href="/admin/listings">Listings${o.suggestions ? ` (${Number(o.suggestions)} new)` : ''}</a><a href="/admin/directories">Directories</a><a href="/admin/reviews">Reviews</a><a href="/admin/reports">Agent reports${o.openReports ? ` (${Number(o.openReports)} open)` : ''}</a></nav></div>
    <div class="stat-strip small">
      <div><strong>${Number(o.members.joined)}</strong><span>members</span></div>
      <div><strong>${Number(o.members.joined_7d)}</strong><span>joined this week</span></div>
      <div><strong>${Number(o.members.squawk)}</strong><span>get The Squawk</span></div>
      <div><strong>${Number(o.players7d)}</strong><span>played the game this week</span></div>
    </div>
    <div class="grid2">
      <div><h2>Where members came from</h2><p class="muted small">Add <code>?from=a-name</code> to links you post to count them here.</p>
        <ul>${o.sources.map((s) => `<li>${esc(s.source || '(no tag)')}: ${Number(s.n)}</li>`).join('') || '<li class="muted">Nobody yet.</li>'}</ul></div>
      <div><h2>Who they are</h2><ul>${o.roles.map((r) => `<li>${esc(roleLabel(r.role) || '(didn\'t say)')}: ${Number(r.n)}</li>`).join('') || '<li class="muted">Nobody yet.</li>'}</ul>
        <h2>Top inviters</h2><ul>${o.inviters.map((i) => `<li>${esc(i.name)}: ${Number(i.n)}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul></div>
    </div>
    <p class="muted small">Grades last copied from Agent Report Card on ${esc(dateLabel(syncedAt))}.</p>
    <h2>Members</h2>
    <div class="table-scroll"><table><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Signed in with</th><th>Role</th><th>Squawk</th><th>Came from</th><th>Joined</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="muted">No members yet.</td></tr>'}</tbody></table></div>
  </section>`, { wide: true });
}

export function adminNewsPage({ stories, notice, error, hasKey, paused, agentFor }) {
  const items = stories.map((s) => {
    const agent = agentFor(s.agent_id);
    return `<article class="admin-story${s.hidden ? ' is-hidden' : ''}" id="story-${Number(s.id)}">
      <p class="eyebrow">${esc(s.day)} · #${Number(s.position)}${s.hidden ? ' · hidden' : ''}${agent ? ` · box: ${esc(agent.name)} (${esc(agent.grade)})` : ''}</p>
      <h3>${esc(s.headline)}</h3>${paras(s.body).map((p) => `<p>${esc(p)}</p>`).join('')}
      <p class="muted small">Based on <a href="${esc(s.source_link)}" target="_blank" rel="noopener">${esc(s.source)}: ${esc(s.source_title)}</a></p>
      <div class="row">${['regenerate', s.hidden ? 'show' : 'hide'].map((a) => `<form method="post" action="/admin/news/${Number(s.id)}/${a}" class="inline">
        <button type="submit" class="${a === 'hide' ? 'danger' : 'ghost'} small">${a === 'regenerate' ? 'Rewrite' : a === 'hide' ? 'Hide' : 'Show again'}</button></form>`).join('')}</div>
    </article>`;
  }).join('');
  return layout('The Daily Hallucination (admin)', `<section class="card">
    <div class="card-head"><h1>The Daily Hallucination</h1><a href="/admin">Back to admin</a></div>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}${error ? `<p class="error">${esc(error)}</p>` : ''}
    ${hasKey ? '' : '<p class="error">ANTHROPIC_API_KEY is not set, so no stories can be written.</p>'}
    <p>${paused ? '<strong>Paused.</strong> The 6 AM (UTC) run writes nothing until you resume it. You can still write today\'s stories by hand below.'
      : 'Running. Five new stories are written every day at 6 AM UTC.'}</p>
    <form method="post" action="/admin/news/${paused ? 'resume' : 'pause'}" class="inline"><button type="submit" class="ghost">${paused ? 'Resume the daily run' : 'Pause the daily run'}</button></form>
    <form method="post" action="/admin/news/generate" class="inline"><button type="submit">Write today's stories now</button></form>
    <p class="muted small">Hidden stories disappear from the site within about five minutes. "Rewrite" asks for a new take on the same news story.</p>
    ${items || '<p class="muted">No stories yet.</p>'}
  </section>`, { wide: true });
}

export function adminListingsPage({ listings, error, draft = {} }) {
  const cats = (sel) => CATEGORIES.map((c) => `<option value="${c.id}"${sel === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const rows = listings.map((l) => `<tr><td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a><br><span class="muted small">${esc(l.description)}</span></td>
      <td>${esc(categoryName(l.category))}</td><td>${l.status === 'listed' ? 'Listed' : '<strong>Suggested</strong>'}</td>
      <td>${l.status === 'listed' ? '' : `<form method="post" action="/admin/listings/${Number(l.id)}/list" class="inline"><button type="submit" class="small">List it</button></form>`}
        <form method="post" action="/admin/listings/${Number(l.id)}/delete" class="inline"><button type="submit" class="danger small">Remove</button></form></td></tr>`).join('');
  return layout('Listings (admin)', `<section class="card">
    <div class="card-head"><h1>Not-yet-tested listings</h1><a href="/admin">Back to admin</a></div>
    <p class="muted">Agents shown in the directory under "Not Polly Tested yet". Members suggest them; you decide what's listed.</p>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <form method="post" action="/admin/listings" class="stack">
      <div class="grid2"><label>Name<input name="name" required maxlength="80" value="${esc(draft.name)}"></label><label>Link<input name="url" type="url" required maxlength="300" value="${esc(draft.url)}"></label></div>
      <div class="grid2"><label>What it does<input name="description" maxlength="200" value="${esc(draft.description)}"></label><label>Category<select name="category">${cats(draft.category)}</select></label></div>
      <button type="submit">Add listing</button>
    </form>
    <div class="table-scroll"><table><thead><tr><th>Agent</th><th>Category</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">None yet.</td></tr>'}</tbody></table></div>
  </section>`, { wide: true });
}
