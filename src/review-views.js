// HTML for member reviews (see src/reviews.js). Everything members type is escaped with esc().
import { esc, layout, dateLabel, paras } from './views.js';

const ROLE_SHORT = { builder: 'Builds agents', user: 'Uses agents for work', curious: 'Curious' };
export const REPORT_REASONS = [
  ['spam', 'Spam or advertising'],
  ['rude', 'Rude or abusive'],
  ['fake', 'Fake, or by the maker'],
  ['off-topic', 'Not about this agent'],
];
const MAX = 1000;

export const NOTICES = {
  saved: ['notice', 'Thanks! Your review is up.'],
  deleted: ['notice', 'Your review has been deleted.'],
  reported: ['notice', 'Thanks for telling us. Polly will take a look.'],
  own: ['error', "You made this agent, so you can't review it. Ask the people who use it."],
  stars: ['error', 'Please pick from 1 to 5 stars.'],
  long: ['error', `Please keep your review to ${MAX.toLocaleString('en-GB')} characters.`],
  links: ['error', 'Please include no more than two links.'],
  slow: ['error', "You've posted a lot in a short time. Please try again later."],
  busy: ['error', 'Lots of reviews just now. Please try again in an hour.'],
};

// Reads a ?review= code from the address, for the message after posting.
export const noticeFor = (code) => (Object.hasOwn(NOTICES, code) ? code : null);

const fmt = (avg) => (Math.round(avg * 10) / 10).toFixed(1);
const plural = (n, one, many) => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? one : many}`;

// Five stars, filled to the average.
export function stars(avg, { size = '' } = {}) {
  const pct = Math.max(0, Math.min(100, (Number(avg) / 5) * 100));
  return `<span class="stars ${size}" role="img" aria-label="${esc(fmt(avg))} out of 5 stars"><span class="stars-fill" style="width:${pct.toFixed(0)}%"></span></span>`;
}

// The small tag on directory cards. Nothing when there are no reviews yet.
export function ratingTag(s) {
  if (!s?.count) return '';
  return `<span class="tag tag-rating" title="${esc(`Member rating ${fmt(s.avg)} out of 5 from ${plural(s.count, 'review', 'reviews')}. Separate from the Polly grade.`)}">★ ${esc(fmt(s.avg))} <span class="muted">(${Number(s.count).toLocaleString('en-GB')})</span></span>`;
}

// The line under an agent page's headline facts.
export const ratingFact = (s) => (s?.count
  ? `<span>${stars(s.avg)} <a href="#reviews"><b>${esc(fmt(s.avg))}</b> from ${esc(plural(s.count, 'member review', 'member reviews'))}</a></span>`
  : '<span><a href="#reviews">No member reviews yet</a></span>');

// For the compare table.
export const ratingCell = (s) => (s?.count
  ? `${stars(s.avg)} <b>${esc(fmt(s.avg))}</b> <span class="muted small">from ${esc(plural(s.count, 'review', 'reviews'))}</span>`
  : '<span class="muted">No member reviews yet</span>');

export function displayName(m) {
  const parts = String(m.name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (m.first_name || parts[0] || '').trim();
  const last = (m.last_name || (parts.length > 1 ? parts.at(-1) : '') || '').trim();
  return first ? `${first}${last ? ` ${[...last][0].toUpperCase()}.` : ''}` : 'Member';
}

const bodyHtml = (text) => paras(text).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

function reviewItem(r, { canReport }) {
  const edited = new Date(r.updated_at) - new Date(r.created_at) > 60000;
  return `<li class="review${r.mine ? ' mine' : ''}">
      <div class="review-head">${stars(r.stars)} <b>${esc(displayName(r))}</b>${r.mine ? ' <span class="tag">You</span>' : ''}
        <span class="muted small">${ROLE_SHORT[r.role] ? `${esc(ROLE_SHORT[r.role])} · ` : ''}${esc(dateLabel(r.created_at))}${edited ? ` · edited ${esc(dateLabel(r.updated_at))}` : ''}</span></div>
      ${r.mine && r.hidden ? '<p class="error small">Hidden from others while Polly looks at reports about it.</p>' : ''}
      ${r.body ? `<div class="review-body">${bodyHtml(r.body)}</div>` : ''}
      ${canReport && !r.mine ? `<details class="review-report"><summary>Report</summary>
        <form method="post" action="/reviews/${Number(r.id)}/report" class="inline">
          <label class="sr-only" for="reason-${Number(r.id)}">Why are you reporting this review?</label>
          <select id="reason-${Number(r.id)}" name="reason">${REPORT_REASONS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
          <button type="submit" class="small ghost">Send report</button></form></details>` : ''}
    </li>`;
}

function reviewForm({ ref, mine }) {
  const radios = [5, 4, 3, 2, 1].map((n) => `<input type="radio" id="star-${n}" name="stars" value="${n}" required${mine?.stars === n ? ' checked' : ''}>
        <label for="star-${n}" title="${plural(n, 'star', 'stars')}"><span aria-hidden="true">★</span><span class="sr-only">${plural(n, 'star', 'stars')}</span></label>`).join('');
  return `<form method="post" action="/reviews" class="stack review-form">
      <input type="hidden" name="ref" value="${esc(ref)}">
      <fieldset class="star-input"><legend>${mine ? 'Your rating' : 'Your rating (tap a star)'}</legend><div class="star-row">${radios}</div></fieldset>
      <label>Your review <span class="muted small">(optional, up to ${MAX.toLocaleString('en-GB')} characters)</span>
        <textarea name="body" rows="4" maxlength="${MAX}" placeholder="What did you use it for? What worked, and what didn't?">${esc(mine?.body ?? '')}</textarea></label>
      <div class="review-actions"><button type="submit">${mine ? 'Save changes' : 'Post review'}</button></div>
    </form>
    ${mine ? `<form method="post" action="/reviews/delete" class="inline" onsubmit="return confirm('Delete your review?')">
      <input type="hidden" name="ref" value="${esc(ref)}"><button type="submit" class="small ghost danger">Delete my review</button></form>` : ''}`;
}

// The reviews section on a tested or listed agent's page.
export function reviewsBlock(s, { tested = false } = {}) {
  const [cls, msg] = (s.notice && NOTICES[s.notice]) || [];
  const canReport = s.signedIn && s.joined;
  let action;
  if (!s.signedIn) action = `<p><a class="btn" href="/signin">Sign in to review</a> <span class="muted small">Free. One review per member per agent.</span></p>`;
  else if (!s.joined) action = '<p><a href="/join">Finish joining</a> to leave a review.</p>';
  else if (s.own) action = '<p class="muted">You made this agent, so you can\'t review it.</p>';
  else action = `<details class="review-write"${s.mine || s.notice ? ' open' : ''}><summary class="btn ${s.mine ? 'ghost' : ''}">${s.mine ? 'Edit your review' : 'Write a review'}</summary>${reviewForm(s)}</details>`;
  const more = s.summary.count > s.reviews.filter((r) => !r.hidden).length;
  return `<section class="card section reviews" id="reviews">
    <h2>Member reviews</h2>
    <p class="muted small">${tested
      ? 'What signed-in members think. Reviews are opinions and are kept apart from the Polly Tested grade above: they never change the grade, the Pecking Order or the maker\'s reputation score.'
      : 'What signed-in members think. This agent has no Polly grade yet, and reviews are opinions, not a test: they never change a grade or the maker\'s reputation score.'}</p>
    ${msg ? `<p class="${cls}">${esc(msg)}</p>` : ''}
    <div class="review-summary">${s.summary.count
      ? `<span class="review-avg">${esc(fmt(s.summary.avg))}</span>${stars(s.summary.avg, { size: 'lg' })}<span class="muted">${esc(plural(s.summary.count, 'review', 'reviews'))}</span>`
      : `<span class="muted">No reviews yet. ${s.signedIn && s.joined && !s.own ? 'Be the first.' : ''}</span>`}</div>
    ${action}
    ${s.reviews.length ? `<ul class="review-list">${s.reviews.map((r) => reviewItem(r, { canReport })).join('')}</ul>` : ''}
    ${more ? `<p class="muted small">Showing the ${s.reviews.length} newest.</p>` : ''}
  </section>`;
}

// On a maker's page: what members think of their agents, shown apart from the reputation score.
export function makerReviewsLine(s) {
  return `<p class="small">${s?.count
    ? `${stars(s.avg)} <b>${esc(fmt(s.avg))}</b> average from ${esc(plural(s.count, 'member review', 'member reviews'))} of their agents.`
    : '<span class="muted">No member reviews of their agents yet.</span>'}
    <span class="muted">Not counted in the reputation score, which only uses things Polly can check.</span></p>`;
}

const refPath = (ref) => {
  const m = /^(mcp|erc8004):(.+)$/.exec(ref);
  return m ? `/listed/${m[1]}/${m[2].split('/').map(encodeURIComponent).join('/')}` : `/agents/${encodeURIComponent(ref)}`;
};

export function adminReviewsPage({ reviews, hideAt }) {
  const rows = reviews.map((r) => `<tr${r.hidden ? ' class="muted"' : ''}>
      <td><a href="${esc(refPath(r.agent_ref))}#reviews">${esc(r.agent_ref)}</a></td>
      <td>${Number(r.stars)}★</td>
      <td class="review-body">${r.body ? bodyHtml(r.body) : '<span class="muted">(stars only)</span>'}</td>
      <td>${esc(r.name)}<br><span class="small">${esc(r.email ?? '')}</span></td>
      <td>${r.reports ? `<b class="bad">${Number(r.reports)}</b> <span class="small">${esc(r.reasons ?? '')}</span>` : ''}</td>
      <td>${r.hidden ? 'Hidden' : 'Showing'}<br><span class="small">${esc(dateLabel(r.updated_at))}</span></td>
      <td>${[r.hidden ? ['show', 'Show again'] : ['hide', 'Hide'], ['delete', 'Delete']].map(([a, t]) => `<form method="post" action="/admin/reviews/${Number(r.id)}/${a}" class="inline"${a === 'delete' ? " onsubmit=\"return confirm('Delete this review for good?')\"" : ''}><button type="submit" class="small ghost">${t}</button></form>`).join(' ')}</td>
    </tr>`).join('');
  return layout('Reviews: admin', `<section class="card">
    <div class="card-head"><h1>Member reviews</h1><nav class="tabs inline-tabs"><a href="/admin">Admin</a></nav></div>
    <p class="muted small">Reported reviews come first. A review is hidden on its own once ${Number(hideAt)} different members report it;
      "Show again" puts it back and clears its reports. Members can post or change at most 10 reviews an hour and report 20 a day.</p>
    <div class="table-scroll"><table><thead><tr><th>Agent</th><th>Stars</th><th>Review</th><th>By</th><th>Reports</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No reviews yet.</td></tr>'}</tbody></table></div>
  </section>`, { wide: true });
}
