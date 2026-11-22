// Pages for the free Polly Peek: /lite (the form), /lite/<id> (a result, private to its member) and /admin/lite.
// See src/lite-checks.js.
import { layout, esc, dateLabel } from './views.js';

const BAND = {
  strong: { label: 'Strong', meaning: 'Likely an A or B on a full Polly Test', cls: 'good' },
  mixed: { label: 'Mixed', meaning: 'Likely a C or D on a full Polly Test', cls: 'warn' },
  weak: { label: 'Weak', meaning: 'Likely an F on a full Polly Test, or something broke', cls: 'bad' },
  'couldnt-check': { label: "Couldn't check", meaning: "The Polly Peek couldn't finish, so there's no band", cls: 'muted' },
};
const MARK = { pass: '✓', warn: '!', fail: '✗', skip: '–' };
export const LITE_NOTE = 'A Polly Peek uses 3 tasks and one AI judge. A full Polly Test uses 10 tasks and two independent judges, and is the only thing that gives a grade and a place in the rankings.';

const requestLink = (row) => `/request?${row.agent_ref ? `ref=${encodeURIComponent(row.agent_ref)}` : `agent=${encodeURIComponent(row.agent)}&name=${encodeURIComponent(row.name || '')}`}`;

function field({ name, label, help = '', value = '', bad, textarea = false, required = false, max, rows = 3, placeholder = '' }) {
  const attrs = `name="${name}" id="lite-${name}"${required ? ' required' : ''}${max ? ` maxlength="${max}"` : ''} placeholder="${esc(placeholder)}"${bad ? ' aria-invalid="true" autofocus' : ''}`;
  return `<label class="${bad ? 'field-bad' : ''}" for="lite-${name}"><span>${esc(label)}${required ? ' <span class="muted">(needed)</span>' : ''}</span>
      ${textarea ? `<textarea ${attrs} rows="${rows}">${esc(value)}</textarea>` : `<input ${attrs} value="${esc(value)}">`}
      ${help ? `<small class="muted">${help}</small>` : ''}</label>`;
}

function formFields(form = {}, badField) {
  const bad = (n) => badField === n;
  return `${field({ name: 'agent', label: 'Where can Polly find it?', required: true, max: 500, value: form.agent, bad: bad('agent'),
      placeholder: 'https://your-agent.example/api or https://your-server.example/mcp',
      help: 'A public https address that answers a POST with <code>{"prompt": "..."}</code>, an OpenAI-style <code>/chat/completions</code> address, or an MCP server (write <code>mcp:</code> before it if the address doesn\'t say mcp). It must work without a key.' })}
    ${field({ name: 'model', label: 'Model name (OpenAI-style addresses only)', max: 100, value: form.model, bad: bad('model'), placeholder: 'my-agent-v1' })}
    ${field({ name: 'whatItDoes', label: 'What does it do?', required: true, textarea: true, max: 2000, value: form.whatItDoes, bad: bad('whatItDoes'), placeholder: 'A sentence or two, so Polly can pick a fair task.' })}
    ${field({ name: 'name', label: 'Agent name', max: 80, value: form.name, placeholder: 'My Research Agent' })}
    ${field({ name: 'task', label: 'A real task to try (optional)', textarea: true, rows: 2, max: 1000, value: form.task, placeholder: 'Something your users actually ask it.' })}`;
}

export function myLiteBlock(rows = []) {
  if (!rows.length) return '';
  return `<section class="card section"><h2>Your Polly Peeks</h2>
    <ul class="plain-list">${rows.map((r) => `<li><a href="/lite/${encodeURIComponent(r.id)}">${esc(r.name || r.agent)}</a>
      <span class="muted small">${esc(dateLabel(r.created_at))} · ${r.status === 'done' ? esc(BAND[r.band]?.label ?? '') : r.status === 'failed' ? "didn't finish" : 'not finished'}</span></li>`).join('')}</ul></section>`;
}

export function litePage({ open, member, form = {}, agentRef = '', from = null, error, field: badField, existing = null, retest = null, mine = [], limits }) {
  const head = `<section class="page-head">
      <p class="eyebrow">For builders · free</p>
      <h1>Free Polly Peek</h1>
      <p class="lead">A quick look at your agent in about a minute: a band (Strong, Mixed or Weak), the checks Polly ran and what to fix first. It's free, and it isn't a grade.</p>
    </section>`;
  if (!open) {
    return layout('Free Polly Peek', `${head}
      <section class="card section"><p>Polly Peeks aren't open yet. Polly is still trying them out.</p>
        <p>Want a real grade now? <a href="/request${agentRef ? `?ref=${encodeURIComponent(agentRef)}` : ''}">Request a full Polly Test</a>.</p></section>`);
  }
  const signIn = member
    ? ''
    : '<p class="notice"><a href="/signin">Sign in</a> to run a Polly Peek. It\'s free, and your result stays private to you.</p>';
  return layout('Free Polly Peek', `${head}
    ${from ? `<p class="notice">Checking <a href="${esc(from.path)}"><b>${esc(from.name)}</b></a>.</p>` : ''}
    ${signIn}
    ${error ? `<p class="error" role="alert">${esc(error)}${existing ? ` <a href="/lite/${encodeURIComponent(existing.id)}">See your last one</a>.` : ''}${retest ? ` <a href="/request?ref=${encodeURIComponent(retest.id)}">Request a retest</a>.` : ''}</p>` : ''}
    <form method="post" action="/lite" class="card section stack">
      <input type="hidden" name="agentRef" value="${esc(agentRef)}">
      ${formFields(form, badField)}
      <button type="submit"${member ? '' : ' disabled'}>Run a free Polly Peek</button>
      <p class="muted small">One Polly Peek per agent every ${Number(limits.perAgentDays)} days, and ${Number(limits.perMemberMonth)} per member a month. Your band and findings are only shown to you. ${esc(LITE_NOTE)}</p>
    </form>
    ${myLiteBlock(mine)}`);
}

export function liteResultPage({ row, runUrl, admin = false }) {
  const r = row.result ?? null;
  const name = row.name || row.agent;
  const back = admin ? '<p><a href="/admin/lite">← All Polly Peeks</a></p>' : '';
  if (row.status === 'queued' || row.status === 'running') {
    return layout(`Polly Peek: ${name}`, `${back}
      <section class="card section" id="lite-run" data-run="${esc(runUrl)}" data-start="${row.status === 'queued' ? '1' : '0'}">
        <h1>Checking ${esc(name)}…</h1>
        <p>Polly is trying a few tasks on it. This takes about a minute. Keep this page open.</p>
        <noscript><form method="post" action="${esc(runUrl)}"><button type="submit">Start the check</button></form></noscript>
        <p class="muted small" id="lite-status" role="status" aria-live="polite"></p>
      </section>
      <script src="/lite.js" defer></script>`);
  }
  if (row.status === 'failed' || !r) {
    return layout(`Polly Peek: ${name}`, `${back}
      <section class="card section"><h1>The Polly Peek didn't finish</h1>
        <p>${esc(row.error || 'Something went wrong.')} It doesn't count against your free checks.</p>
        <p><a href="/lite">Try again</a> or <a href="${esc(requestLink(row))}">request a full Polly Test</a>.</p></section>`);
  }
  const b = BAND[r.band] ?? BAND['couldnt-check'];
  return layout(`Polly Peek: ${name}`, `${back}
    <section class="page-head">
      <p class="eyebrow">Polly Peek · ${esc(dateLabel(row.finished_at || row.created_at))}${admin ? '' : ' · only you can see this'}</p>
      <h1>${esc(name)}</h1>
      <p class="lead"><span class="pill ${b.cls}"><b>${esc(b.label)}</b></span>&nbsp; ${esc(b.meaning)}.${r.reason ? ` ${esc(r.reason)}` : ''}${r.band === 'couldnt-check' && !admin ? " It doesn't count against your free checks, so you can fix it and try again." : ''}</p>
    </section>
    ${r.findings?.length ? `<section class="card section"><h2>${r.findings.length === 1 ? 'One thing to fix' : 'Two things to fix'}</h2>
      <ol>${r.findings.map((f) => `<li><b>${esc(f.from)}:</b> ${esc(f.text)}</li>`).join('')}</ol></section>` : ''}
    <section class="card section"><h2>What Polly checked</h2>
      <ul class="plain-list lite-list">${(r.checks ?? []).map((c) => `<li><span class="lite-mark lite-${esc(c.status)}" aria-label="${esc(c.status)}">${MARK[c.status] ?? '–'}</span> <b>${esc(c.label)}:</b> ${esc(c.detail)}</li>`).join('')}
        ${(r.tasks ?? []).map((t) => `<li><span class="lite-mark">◆</span> <b>${esc(t.label)} task:</b> ${esc(t.summary)}</li>`).join('')}</ul></section>
    <section class="card section"><h2>Want a real grade?</h2>
      <p>${esc(LITE_NOTE)}</p>
      <p><a class="button" href="${esc(requestLink(row))}">Get the full Polly Test ($10)</a></p></section>`);
}

export function adminLitePage({ rows, spend, today, budgetUsd, open, paused, switchedOn, limits, error }) {
  const err = error === 'off' ? 'Polly Peeks need LITE_SECRET set in Vercel (the same value as on the grader).' : error;
  const list = rows.map((r) => `<tr>
      <td>${r.member_id ? esc(r.name || r.agent) : `<a href="/admin/lite/${encodeURIComponent(r.id)}">${esc(r.name || r.agent)}</a>`}<br><span class="small muted">${esc(r.agent)}</span></td>
      <td>${r.member_id ? esc(r.member_name || 'member') : 'You'}</td>
      <td>${r.status === 'done' ? esc(BAND[r.band]?.label ?? r.band) : esc(r.status)}${r.error ? `<br><span class="small">${esc(r.error)}</span>` : ''}</td>
      <td class="mono">$${Number(r.est_usd).toFixed(3)}</td>
      <td class="small">${esc(dateLabel(r.created_at))}</td></tr>`).join('');
  return layout('Polly Peeks: admin', `<section class="card">
    <div class="card-head"><h1>Polly Peeks</h1><nav class="tabs inline-tabs"><a href="/admin">Admin</a><a href="/lite">Public page</a></nav></div>
    <p class="muted small">Free quick checks run by the grader (3 tasks, one AI judge, no grade). Results are private to whoever ran them and never
      count in grades, the Pecking Order, the digest or maker reputation. Limits: one per agent every ${Number(limits.perAgentDays)} days,
      ${Number(limits.perMemberMonth)} per member a month, ${Number(limits.perDay)} a day site-wide, and a $${Number(budgetUsd).toFixed(0)} monthly stop.
      Members' results aren't shown here, only their band.</p>
    ${!switchedOn ? '<p class="error">Switched off: set LITE_SECRET in Vercel (the same value as on the grader) to use Polly Peeks.</p>' : ''}
    ${err ? `<p class="error" role="alert">${esc(err)}</p>` : ''}
    <p><b>This month:</b> about $${Number(spend).toFixed(2)} of $${Number(budgetUsd).toFixed(0)} · <b>Today:</b> ${Number(today)} of ${Number(limits.perDay)}</p>
    <form method="post" action="/admin/lite/settings" class="stack">
      <label class="check"><input type="checkbox" name="open" value="1"${open ? ' checked' : ''}> Open to members (signed-in members can run their own from /lite)</label>
      <label class="check"><input type="checkbox" name="paused" value="1"${paused ? ' checked' : ''}> Pause all Polly Peeks</label>
      <button type="submit" class="small">Save</button>
    </form></section>
    <section class="card section"><h2>Try one yourself</h2>
      <form method="post" action="/admin/lite" class="stack">${formFields({})}<button type="submit">Run a Polly Peek</button></form></section>
    <section class="card section"><h2>Recent checks</h2>
      ${rows.length ? `<div class="table-scroll"><table><thead><tr><th>Agent</th><th>By</th><th>Result</th><th>Cost (est.)</th><th>When</th></tr></thead><tbody>${list}</tbody></table></div>` : '<p class="muted">None yet.</p>'}</section>`);
}
