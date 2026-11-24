// Pages for grades API keys: /api-keys (a member's own keys) and /admin/api. See src/api-keys.js.
import { layout, esc, dateLabel } from './views.js';

const upgradeLink = (link, key) => `${link}${link.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(key.id)}`;

function keyCard(k, { plans, planOf, links, contactEmail }) {
  const plan = planOf(k);
  const p = plans[plan];
  const paid = plan === 'developer' || plan === 'business';
  const upgrades = ['developer', 'business'].filter((x) => x !== plan);
  const upgradeHtml = upgrades.map((x) => (links[x]
    ? `<a class="btn ghost" href="${esc(upgradeLink(links[x], k))}" target="_blank" rel="noopener">${paid ? 'Switch' : 'Upgrade'} to ${esc(plans[x].name)} (${esc(plans[x].price)})</a>`
    : '')).join(' ');
  const contact = !upgrades.some((x) => links[x]) && !paid
    ? `<p class="muted small">Paid plans: ${contactEmail ? `email <a href="mailto:${esc(contactEmail)}?subject=${encodeURIComponent(`Grades API plan for key ${k.prefix}`)}">${esc(contactEmail)}</a>` : 'opening soon'}.</p>` : '';
  return `<article class="card section" id="key-${esc(k.id)}">
    <div class="card-head"><h2>${esc(k.label || 'API key')} <code>${esc(k.prefix)}…</code></h2>
      <form method="post" action="/api-keys/${encodeURIComponent(k.id)}/revoke" class="inline"><button class="small danger">Revoke</button></form></div>
    <p><strong>${esc(p.name)}</strong>${paid && k.paid_until ? ` · paid until ${esc(dateLabel(k.paid_until))}` : ''} ·
      ${Number(k.today)} of ${Number(p.perDay).toLocaleString('en-US')} calls today (UTC)${k.last_used_at ? ` · last used ${esc(dateLabel(k.last_used_at))}` : ''}</p>
    ${upgradeHtml ? `<p>${upgradeHtml}</p><p class="muted small">After paying, your plan is switched on by hand, usually within a day.</p>` : ''}${contact}
    ${p.webhooks ? `<h3>Webhook</h3>
      <form method="post" action="/api-keys/${encodeURIComponent(k.id)}/webhook" class="stack">
        <label><span>https address to tell when grades change</span><input name="url" type="url" maxlength="500" value="${esc(k.webhook_url ?? '')}" placeholder="https://your-app.example/hooks/grades"></label>
        <button>Save webhook</button></form>
      ${k.webhook_url ? `<p class="muted small">Secret for checking the <code>X-Signature-256</code> header: <code>${esc(k.webhook_secret ?? '')}</code></p>
        <form method="post" action="/api-keys/${encodeURIComponent(k.id)}/webhook/test" class="inline"><button class="ghost small">Send a test</button></form>
        ${k.webhook_status ? `<p class="muted small">Last send: ${esc(k.webhook_status)}${k.webhook_at ? `, ${esc(dateLabel(k.webhook_at))}` : ''}</p>` : ''}` : ''}` : ''}
  </article>`;
}

export function apiKeysPage({ keys, plans, planOf, links, contactEmail, newKey, notice, error, max }) {
  return layout('Your API keys', `
    <section class="page-head">
      <p class="eyebrow">Grades API</p>
      <h1>Your API keys</h1>
      <p class="lead">The grades feed is free without a key. A key gives you a known daily limit, and the paid plans add grade history and webhooks.
        <a href="/feed#plans">Compare plans</a>.</p>
    </section>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    ${newKey ? `<section class="card section"><h2>Your new key</h2>
      <p>Copy it now. For your safety it is only shown once.</p><pre class="answer">${esc(newKey)}</pre>
      <p class="muted small">Send it as <code>Authorization: Bearer ${esc(newKey.slice(0, 10))}…</code>. Keep it out of public code.</p></section>` : ''}
    ${keys.map((k) => keyCard(k, { plans, planOf, links, contactEmail })).join('')}
    ${keys.length < max ? `<section class="card section"><h2>Make a key</h2>
      <form method="post" action="/api-keys" class="stack">
        <label><span>Name it (optional)</span><input name="label" maxlength="60" placeholder="My directory"></label>
        <button>Make a free key</button></form>
      <p class="muted small">Up to ${Number(max)} keys. Paying for a plan never changes a grade or a ranking.</p></section>` : ''}`,
  { description: 'Your Agent Report Card grades API keys.' });
}

export function adminApiPage({ keys, payments, month, planOf, plans, notice }) {
  const rows = keys.map((k) => `<tr${k.revoked_at ? ' class="muted"' : ''}><td><code>${esc(k.prefix)}…</code><br><span class="small muted">${esc(k.id)}</span></td>
      <td>${esc(k.member_name ?? '')}<br><span class="small muted">${esc(k.label)}</span></td>
      <td>${k.revoked_at ? 'revoked' : esc(plans[planOf(k)].name)}${k.paid_until ? `<br><span class="small muted">paid until ${esc(dateLabel(k.paid_until))}</span>` : ''}</td>
      <td>${Number(k.today)}</td><td>${k.webhook_url ? esc(k.webhook_status ?? 'set') : ''}</td>
      <td>${k.revoked_at ? '' : `<form method="post" action="/admin/api/${encodeURIComponent(k.id)}/plan" class="inline">
        <select name="plan">${['starter', 'developer', 'business'].map((p) => `<option value="${p}"${planOf(k) === p ? ' selected' : ''}>${esc(plans[p].name)}</option>`).join('')}</select>
        <select name="months">${[1, 3, 12].map((m) => `<option value="${m}">+${m} month${m > 1 ? 's' : ''}</option>`).join('')}</select>
        <button>Save</button></form>`}</td></tr>`).join('');
  const pays = payments.map((p) => `<tr><td>${esc(dateLabel(p.created_at))}</td><td>$${esc(String(Number(p.usd)))}</td><td class="small">${esc(p.payer ?? '')}</td>
      <td class="small">${p.tx ? `<a href="https://basescan.org/tx/${esc(p.tx)}" target="_blank" rel="noopener">${esc(p.tx.slice(0, 12))}…</a>` : ''}</td><td class="small">${esc(p.resource)}</td></tr>`).join('');
  return layout('Grades API admin', `<section class="card">
    <div class="card-head"><h1>Grades API</h1><a href="/admin">Back to admin</a></div>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    <p>When a Stripe payment for a plan comes in, its reference is the key id below. Pick the plan and how many months it paid for.
      Extending a plan that's still running adds to its end date. "Starter" takes a key back to free.</p>
    <div class="table-scroll"><table><thead><tr><th>Key</th><th>Member</th><th>Plan</th><th>Calls today</th><th>Webhook</th><th>Set plan</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">No keys yet.</td></tr>'}</tbody></table></div>
    <h2>Pay-per-call (x402)</h2>
    <p>This month: ${Number(month.n)} paid calls, $${esc(Number(month.usd).toFixed(3))}.</p>
    <div class="table-scroll"><table><thead><tr><th>When</th><th>Paid</th><th>Payer</th><th>Transaction</th><th>What</th></tr></thead>
      <tbody>${pays || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}</tbody></table></div>
  </section>`, { wide: true });
}
