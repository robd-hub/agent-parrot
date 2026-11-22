// Pages for the weekly top-movers digest: /digest (latest and the archive), /digest/<week>, and /admin/digest.
import { esc, layout, gradeBadge, linkedInShareUrl, dateLabel } from './views.js';
import { stars } from './review-views.js';
import { weekLabel, headline } from './digest.js';

const plural = (n, one, many = `${one}s`) => `${Number(n)} ${n === 1 ? one : many}`;
const agentLink = (a) => `<a href="/agents/${esc(a.id)}"><strong>${esc(a.name)}</strong></a>${a.own ? ' <span class="muted small">(our own agent)</span>' : ''}`;
const more = (shown, total) => (total > shown ? `<p class="muted small">…and ${Number(total - shown)} more.</p>` : '');

function moveRows(list, kind) {
  return `<ul class="mover-list">${list.map((m) => `<li>
      <span class="mover-change ${kind}">${m.change > 0 ? '+' : ''}${Number(m.change)}</span>
      <span class="mover-main">${agentLink(m)}<span class="muted small">${Number(m.from)} → ${Number(m.score)}${m.fromGrade !== m.grade ? ` · ${esc(m.fromGrade)} to ${esc(m.grade)}` : ''}</span></span>
      ${gradeBadge(m.grade, { size: 'sm' })}</li>`).join('')}</ul>`;
}

function healthList(list) {
  return `<ul class="mover-list">${list.map((a) => `<li><span class="mover-main"><a href="${esc(a.path)}"><strong>${esc(a.name)}</strong></a>
      <span class="muted small">${a.tested ? 'Polly Tested · ' : ''}${a.uptime === null ? '' : `answered ${Number(a.uptime)}% of checks so far`}</span></span></li>`).join('')}</ul>`;
}

function section(title, intro, inner) {
  return `<section class="card section digest-section"><h2>${title}</h2>${intro ? `<p class="muted">${intro}</p>` : ''}${inner}</section>`;
}

// The body of one week's digest, shared by its own page and the top of /digest.
export function digestBody(d) {
  const c = d.counts;
  const parts = [];
  parts.push(section('📈 Biggest climbs', c.gains ? `${plural(c.gains, 'agent')} scored higher on a retest.` : '',
    c.gains ? moveRows(d.gains, 'up') + more(d.gains.length, c.gains) : '<p class="muted">Nobody climbed this week.</p>'));
  parts.push(section('📉 Biggest drops', c.drops ? `${plural(c.drops, 'agent')} scored lower on a retest.` : '',
    c.drops ? moveRows(d.drops, 'down') + more(d.drops.length, c.drops) : '<p class="muted">Nobody dropped a feather this week.</p>'));
  if (c.steady) parts.push(section('🔁 Retested, held steady', '', `<p>${d.steady.map((a) => `${agentLink(a)} (${Number(a.score)})`).join(', ')}${c.steady > d.steady.length ? ` and ${Number(c.steady - d.steady.length)} more` : ''}.</p>`));
  parts.push(section('🆕 First Polly Test', '', c.fresh
    ? `<ul class="mover-list">${d.fresh.map((a) => `<li><span class="mover-main">${agentLink(a)}<span class="muted small">Squawk Score ${Number(a.score)}</span></span>${gradeBadge(a.grade, { size: 'sm' })}</li>`).join('')}</ul>${more(d.fresh.length, c.fresh)}`
    : '<p class="muted">No new agents tested this week.</p>'));

  const h = d.health;
  if (h) {
    const intro = `At the latest health check, ${Number(h.up)} of ${Number(h.checked)} checked agents answered.`;
    const down = h.newlyDownCount
      ? `<h3>Went quiet</h3><p class="muted small">Answered at least once before, didn't answer the latest check${h.comparedWithLastWeek ? ', and wasn\'t quiet last week' : ''}.</p>${healthList(h.newlyDown)}${more(h.newlyDown.length, h.newlyDownCount)}`
      : `<p>No agents went quiet${h.comparedWithLastWeek ? ' this week' : ''}.</p>`;
    const back = h.backUpCount ? `<h3>Back up</h3><p class="muted small">Quiet last week, answering again now.</p>${healthList(h.backUp)}${more(h.backUp.length, h.backUpCount)}` : '';
    parts.push(section('📡 Up and down', esc(intro), down + back));
  }

  if (d.reviews.total) {
    parts.push(section('⭐ Member reviews', `${plural(d.reviews.total, 'new review')} across ${plural(d.reviews.agents, 'agent')}. Reviews are members' opinions and never change a grade.`,
      `<ul class="mover-list">${d.reviews.top.map((r) => `<li><span class="mover-main"><a href="${esc(r.path)}"><strong>${esc(r.name)}</strong></a>
        <span class="muted small">${plural(r.count, 'review')} this week</span></span>${stars(r.avg)}</li>`).join('')}</ul>`));
  }
  if (d.newListed) parts.push(section('🗂️ New in the directories', '', `<p>${plural(d.newListed, 'agent')} first appeared in the public directories we follow. <a href="/listed">See what's listed</a>, not Polly Tested yet.</p>`));
  if (d.top.length) {
    parts.push(section('🏆 Top of the Pecking Order', 'Where things stood at the end of the week.',
      `<ol class="digest-top">${d.top.map((a) => `<li>${agentLink(a)} ${gradeBadge(a.grade, { size: 'sm' })} <span class="num">${Number(a.score)}</span></li>`).join('')}</ol>`));
  }
  return parts.join('');
}

export function digestPage({ d, newer, older }) {
  const path = `/digest/${d.week}`;
  return layout(`Top movers: week of ${weekLabel(d.week)}`, `
    <section class="page-head">
      <p class="eyebrow">The weekly digest · week of ${esc(weekLabel(d.week))}</p>
      <h1>${esc(headline(d))}</h1>
      <p class="lead">Who climbed, who dropped and who was Polly Tested for the first time, from ${esc(dateLabel(d.from))} to ${esc(dateLabel(new Date(Date.parse(d.to) - 1).toISOString()))}. Every grade comes from Agent Report Card.</p>
      <p><a class="btn small ghost" href="${esc(linkedInShareUrl(path))}" target="_blank" rel="noopener">Share on LinkedIn</a></p>
    </section>
    ${digestBody(d)}
    ${d.live ? '' : '<p class="muted small">Filled in afterwards from the grade history, so there are no health checks for this week.</p>'}
    <nav class="pager">${newer ? `<a href="/digest/${esc(newer)}">← Week of ${esc(weekLabel(newer))}</a>` : ''}<a href="/digest">All weeks</a>${older ? `<a href="/digest/${esc(older)}">Week of ${esc(weekLabel(older))} →</a>` : ''}</nav>`,
  { description: `Agent Parrot top movers for the week of ${weekLabel(d.week)}: ${headline(d)}.` });
}

const listSummary = (r) => {
  const c = r.counts ?? {};
  const bits = [];
  if (r.gain) bits.push(`${r.gain.name} +${Number(r.gain.change)}`);
  if (r.drop) bits.push(`${r.drop.name} ${Number(r.drop.change)}`);
  if (c.fresh) bits.push(`${plural(c.fresh, 'new agent')}`);
  return bits.join(' · ') || 'Quiet week';
};

export function digestArchivePage({ latest, list }) {
  const archive = list.map((r) => `<li><a href="/digest/${esc(r.week)}">Week of ${esc(weekLabel(r.week))}</a> <span class="muted small">${esc(listSummary(r))}</span></li>`).join('');
  return layout('Top movers', `
    <section class="page-head">
      <p class="eyebrow">The weekly digest</p>
      <h1>Top movers</h1>
      <p class="lead">Every Monday Polly looks back at the week: the biggest grade climbs and drops, agents tested for the first time,
        agents that went quiet, and what members reviewed. Facts from tested results only.</p>
    </section>
    ${latest ? `<section class="card section"><p class="eyebrow">Latest · week of ${esc(weekLabel(latest.week))}</p><h2><a href="/digest/${esc(latest.week)}">${esc(headline(latest.content))}</a></h2></section>${digestBody(latest.content)}` : '<section class="card"><p>The first digest comes out next Monday.</p></section>'}
    ${list.length > 1 ? `<section class="card section"><h2>Past weeks</h2><ul class="issue-list">${archive}</ul></section>` : ''}`,
  { description: 'The Agent Parrot weekly digest: the biggest AI agent grade climbs and drops, new agents and health changes.' });
}

export function adminDigestPage({ digests, notice, preview, nextRun }) {
  const postBox = (id, text, week) => `<div class="post-box">
      <textarea id="${esc(id)}" rows="20" readonly>${esc(text)}</textarea>
      <div class="row"><button type="button" data-copy="${esc(id)}">Copy LinkedIn text</button>
        ${week ? `<a href="/digest/${esc(week)}" target="_blank" rel="noopener">Open the public page</a>` : ''}
        <span class="muted small">${Number(text.length)} of 3,000 characters</span></div></div>`;
  return layout('Weekly digest (admin)', `<section class="card">
    <div class="card-head"><h1>Weekly digest</h1><a href="/admin">Back to admin</a></div>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    <p>Every Monday at 7 AM UTC last week's digest is built and put on <a href="/digest">/digest</a>. Nothing is posted anywhere:
      copy the LinkedIn text below and post it yourself. Next run: Monday ${esc(weekLabel(nextRun))}.</p>
    <form method="post" action="/admin/digest/build" class="inline"><button type="submit">Rebuild last week's digest</button></form>
    <form method="post" action="/admin/digest/preview" class="inline"><button type="submit" class="ghost">Preview this week so far</button></form>
    <p class="muted small">Rebuilding reads today's health checks again. The preview is shown here only and isn't kept or shown on the site.</p>
    ${preview ? `<h2>This week so far (not kept)</h2>${postBox('post-preview', preview.post)}` : ''}
    ${digests.map((r, i) => `<h2>Week of ${esc(weekLabel(r.week))}${r.content.live ? '' : ' <span class="muted small">(filled in from grade history)</span>'}</h2>
      <p class="muted small">Built ${esc(dateLabel(r.updated_at))}.</p>${postBox(`post-${i}`, r.post, r.week)}`).join('') || '<p class="muted">No digests yet. Press "Rebuild last week\'s digest" to make the first one.</p>'}
  </section>
  <script src="/copy.js" defer></script>`, { wide: true });
}
