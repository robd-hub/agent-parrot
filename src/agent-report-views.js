// HTML for "Report an agent" (see src/agent-reports.js). Everything members type is escaped with esc().
import { esc, layout, dateLabel, paras } from './views.js';

export const REASONS = {
  scam: { label: 'Scam or fraud', flag: 'a scam or fraud', level: 'bad' },
  broken: { label: 'Broken: it does not work', flag: 'broken', level: 'warn' },
  misleading: { label: 'Misleading: does not do what it says', flag: 'misleading', level: 'warn' },
  permissions: { label: 'Asks for unsafe permissions', flag: 'asking for unsafe permissions', level: 'bad' },
  other: { label: 'Something else', flag: 'having another problem', level: 'warn' },
};
export const NOTE_MAX = 500;
export const PUBLIC_NOTE_MAX = 200;
export const LIMITS = {
  perDay: 5, // one member, across all agents
  sitePerHour: 100, // everyone together, so a flood can't swamp the organiser
  pendingAt: 3, // different members with open reports before the page says "being checked"
};

export const REPORT_NOTICES = {
  sent: ['notice', 'Thanks for telling us. Polly will check this agent. Nothing shows on the page unless Polly confirms it.'],
  already: ['notice', 'You have already reported this agent. Polly will look at it.'],
  reason: ['error', 'Please pick what is wrong with the agent.'],
  note: ['error', 'Please say a little about what is wrong (at least 10 characters).'],
  long: ['error', `Please keep your note to ${NOTE_MAX} characters.`],
  links: ['error', 'Please include no more than three links.'],
  slow: ['error', `You can report up to ${LIMITS.perDay} agents a day. Please try again tomorrow.`],
  busy: ['error', 'Lots of reports just now. Please try again in an hour.'],
};

export const reportNoticeFor = (code) => (Object.hasOwn(REPORT_NOTICES, code) ? code : null);

const ICON = { good: '✓', info: 'i', warn: '!', bad: '✕' };
export const flagItem = (f) => `<li class="flag flag-${esc(f.level)}${f.community ? ' flag-community' : ''}"><span class="flag-icon" aria-hidden="true">${ICON[f.level]}</span> ${esc(f.text)}</li>`;

// The report button and form, at the foot of an agent's Security section.
export function reportBox(s) {
  if (!s) return '';
  const [cls, msg] = (s.notice && REPORT_NOTICES[s.notice]) || [];
  let body;
  if (!s.signedIn) body = '<p class="small"><a href="/signin">Sign in to report this agent</a> <span class="muted">if it looks like a scam, is broken or misleading, or asks for unsafe permissions.</span></p>';
  else if (!s.joined) body = '<p class="small"><a href="/join">Finish joining</a> to report this agent.</p>';
  else if (s.mine) body = `<p class="small muted">You reported this agent (${esc(REASONS[s.mine.reason]?.label ?? s.mine.reason)}) on ${esc(dateLabel(s.mine.created_at))}. Polly will look at it.</p>`;
  else {
    body = `<details class="agent-report"${s.notice && cls === 'error' ? ' open' : ''}><summary class="btn small ghost danger">Report this agent</summary>
      <form method="post" action="/agent-reports" class="stack">
        <input type="hidden" name="ref" value="${esc(s.ref)}">
        <fieldset><legend>What's wrong?</legend>
          ${Object.entries(REASONS).map(([v, r]) => `<label class="radio"><input type="radio" name="reason" value="${esc(v)}" required> ${esc(r.label)}</label>`).join('')}
        </fieldset>
        <label>What happened? <span class="muted small">(needed for "Something else", up to ${NOTE_MAX} characters)</span>
          <textarea name="note" rows="3" maxlength="${NOTE_MAX}" placeholder="What did you see? Links to proof help Polly check."></textarea></label>
        <p class="muted small">Only Polly sees your report and your name. Polly checks every report before anything shows on this page, and agents are never hidden because of one.</p>
        <div><button type="submit" class="small">Send report</button></div>
      </form></details>`;
  }
  return `<div class="report-box">${msg ? `<p class="${cls}">${esc(msg)}</p>` : ''}${body}</div>`;
}

const refPath = (ref) => {
  const m = /^(mcp|erc8004):(.+)$/.exec(ref);
  return m ? `/listed/${m[1]}/${m[2].split('/').map(encodeURIComponent).join('/')}` : `/agents/${encodeURIComponent(ref)}`;
};

const STATUS = { open: 'Open', confirmed: 'Confirmed', dismissed: 'Dismissed' };

export function adminReportsPage({ reports, notice }) {
  const rows = reports.map((r) => {
    const actions = r.status === 'open'
      ? `<form method="post" action="/admin/reports/${Number(r.id)}/confirm" class="stack">
          <input type="text" name="public_note" maxlength="${PUBLIC_NOTE_MAX}" placeholder="Optional note shown on the page">
          <button type="submit" class="small">Confirm</button></form>
        <form method="post" action="/admin/reports/${Number(r.id)}/dismiss" class="inline"><button type="submit" class="small ghost">Dismiss</button></form>`
      : `<form method="post" action="/admin/reports/${Number(r.id)}/reopen" class="inline"><button type="submit" class="small ghost">${r.status === 'confirmed' ? 'Take down flag' : 'Reopen'}</button></form>`;
    return `<tr${r.status === 'dismissed' ? ' class="muted"' : ''}>
      <td><a href="${esc(refPath(r.agent_ref))}#security">${esc(r.agent_ref)}</a>${r.status === 'open' && r.others > 1 ? `<br><span class="small"><b>${Number(r.others)}</b> members reporting</span>` : ''}</td>
      <td>${esc(REASONS[r.reason]?.label ?? r.reason)}</td>
      <td class="review-body">${r.note ? paras(r.note).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '<span class="muted">(no note)</span>'}
        ${r.public_note ? `<p class="small"><b>Shown on page:</b> ${esc(r.public_note)}</p>` : ''}</td>
      <td>${esc(r.name)}<br><span class="small">${esc(r.email ?? '')}</span></td>
      <td>${STATUS[r.status] ?? esc(r.status)}<br><span class="small">${esc(dateLabel(r.created_at))}</span></td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  return layout('Agent reports: admin', `<section class="card">
    <div class="card-head"><h1>Agent reports</h1><nav class="tabs inline-tabs"><a href="/admin">Admin</a><a href="/admin/reviews">Reviews</a></nav></div>
    <p class="muted small">Members report agents that look like scams, are broken or misleading, or ask for unsafe permissions. Open reports come first.
      Nothing shows on the agent's page until you confirm a report: it then shows as a community flag in the agent's Security section, saying it comes
      from members and not from a Polly test. Once ${Number(LIMITS.pendingAt)} different members have open reports on one agent, the page says a problem
      is being checked. Agents are never hidden. "Take down flag" moves a confirmed report back to open. Each member can report ${Number(LIMITS.perDay)} agents a day.</p>
    ${notice === 'clash' ? '<p class="error">That member has sent a newer report on the same agent, so this one can\'t be reopened. Check the newer one instead.</p>' : ''}
    <div class="table-scroll"><table><thead><tr><th>Agent</th><th>Reason</th><th>What they said</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">No reports yet.</td></tr>'}</tbody></table></div>
  </section>`, { wide: true });
}
