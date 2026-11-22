// Pages for requesting a Polly Test here: /request (the form) and /request/<id> (its status). See src/test-requests.js.
import { layout, esc, dateLabel, gradeBadge } from './views.js';

const PRICE = { test: 10, retest: 5 };
const basescan = (address) => `https://basescan.org/address/${address}`;
const GITHUB_FORM = 'https://github.com/robd-hub/agent-report-card/issues/new?template=grade-request.yml';

function field({ name, label, help = '', value = '', bad, textarea = false, required = false, max, rows = 3, placeholder = '', minLength }) {
  const attrs = `name="${name}" id="rq-${name}"${required ? ' required' : ''}${max ? ` maxlength="${max}"` : ''}${minLength ? ` minlength="${minLength}"` : ''} placeholder="${esc(placeholder)}"${bad ? ' aria-invalid="true" autofocus' : ''}`;
  return `<label class="${bad ? 'field-bad' : ''}" for="rq-${name}"><span>${esc(label)}${required ? ' <span class="muted">(needed)</span>' : ''}</span>
      ${textarea ? `<textarea ${attrs} rows="${rows}">${esc(value)}</textarea>` : `<input ${attrs} value="${esc(value)}">`}
      ${help ? `<small class="muted">${help}</small>` : ''}</label>`;
}

export function myRequestsBlock(rows = []) {
  if (!rows.length) return '';
  return `<section class="card section"><h2>Your test requests</h2>
    <ul class="plain-list">${rows.map((r) => `<li><a href="/request/${encodeURIComponent(r.id)}">${esc(r.name || r.agent)}</a>
      <span class="muted small">sent ${esc(dateLabel(r.created_at))} · ${r.issue_state === 'closed' ? 'graded' : 'being tested'}</span></li>`).join('')}</ul></section>`;
}

const MCP_NOTE = 'Polly connects to it, picks the tools it can safely use (read-only ones), and runs real tasks through them. MCP servers get the core tasks only, with no honesty checks.';

function checkBlock(check) {
  if (!check) return '';
  if (!check.ok) return `<p class="error" role="alert"><b>Check failed, nothing was paid.</b> ${esc(check.error)}</p>`;
  const m = check.mcp;
  return `<p class="notice" role="status"><b>Polly can test it.</b> ${m ? `It's an MCP server${m.name ? ` (${esc(m.name)})` : ''} with ${Number(m.tools)} ${m.tools === 1 ? 'tool' : 'tools'}${m.usable.length ? `; Polly will use ${m.usable.map((t) => `<code>${esc(t)}</code>`).join(', ')}` : ''}. ` : ''}Your price is <b>$${esc(check.priceUsd)}</b>${check.regrade ? ' (a retest)' : ''}. Pay below, then send your request.</p>`;
}

export function requestPage({ form = {}, agentRef = '', from = null, tested = null, error, field: badField, fallback = false, check = null, cardLink, payAddress, mine = [] }) {
  const price = tested ? PRICE.retest : PRICE.test;
  const bad = (n) => badField === n;
  const openAi = /\/chat\/completions\/?$/.test((form.agent ?? '').split(/\s+/)[0] ?? '');
  const intro = from
    ? `<p class="notice">Requesting a test for <a href="${esc(from.path)}"><b>${esc(from.name)}</b></a>.${tested ? ` Polly has tested it before (grade ${esc(tested.grade)}, ${esc(dateLabel(tested.gradedAt))}), so this is a <b>$${PRICE.retest} retest</b>.` : ''}
       ${from.mcp ? `<br>It's an MCP server. ${MCP_NOTE} Press <b>Check it first</b> before you pay.` : ''}</p>`
    : tested ? `<p class="notice">Polly has tested <b>${esc(tested.name)}</b> before, so this is a <b>$${PRICE.retest} retest</b>.</p>` : '';
  return layout('Request a Polly Test', `
    <section class="page-head">
      <p class="eyebrow">For builders</p>
      <h1>Request a Polly Test</h1>
      <p class="lead">Tell Polly where your agent lives and what it's for, pay, and get a public grade, usually within half an hour. $${PRICE.test} for a first test, $${PRICE.retest} for a retest.</p>
    </section>
    ${intro}
    ${checkBlock(check)}
    ${error ? `<p class="error" role="alert">${esc(error)}${fallback ? ` You can also <a href="${esc(GITHUB_FORM)}" target="_blank" rel="noopener">send the request on GitHub</a>.` : ''}</p>` : ''}
    <form method="post" action="/request" class="card section stack request-form" id="request-form" data-price="${price}" data-pay="${esc(payAddress)}">
      <input type="hidden" name="agentRef" value="${esc(agentRef)}">
      <h2>1. Your agent</h2>
      ${field({ name: 'agent', label: 'Where can Polly find it?', required: true, max: 500, value: form.agent, bad: bad('agent'),
        placeholder: 'https://platform.openserv.ai/agents/123 or https://your-agent.example/mcp',
        help: 'Its OpenServ marketplace link, a remote MCP server, a public https address that answers a POST with <code>{"prompt": "..."}</code>, or an OpenAI-style <code>/chat/completions</code> address. It must work without a key. If an MCP server\'s address doesn\'t have <code>/mcp</code> in it, put <code>mcp:</code> in front.' })}
      <div id="rq-model-wrap"${openAi || bad('model') ? '' : ' hidden'}>${field({ name: 'model', label: 'Model name (OpenAI-style addresses only)', max: 100, value: form.model, bad: bad('model'), placeholder: 'my-agent-v1' })}</div>
      ${field({ name: 'whatItDoes', label: 'What does it do?', required: true, textarea: true, max: 2000, minLength: 10, value: form.whatItDoes, bad: bad('whatItDoes'),
        placeholder: 'A sentence or two on the jobs it\'s built for, so Polly can pick fair test tasks.' })}
      ${field({ name: 'name', label: 'Agent name', max: 80, value: form.name, placeholder: 'My Research Agent' })}
      ${field({ name: 'task', label: 'A real task you\'d like it tested on', textarea: true, rows: 2, max: 1000, value: form.task, placeholder: 'Something your users actually ask it.' })}
      ${field({ name: 'contact', label: 'How should we reach you?', max: 200, value: form.contact, placeholder: '@yourhandle (optional)', help: 'Optional. It goes on the public grade request, so don\'t put anything private here.' })}

      <p class="row"><button type="submit" name="intent" value="check" class="ghost" formnovalidate>Check it first (free)</button>
        <span class="muted small">Polly makes sure it can reach your agent and tells you the price, before you pay.</span></p>

      <h2>2. Pay</h2>
      <p>Send <b class="rq-price">$${price}</b> in USDC on Base to <a href="${esc(basescan(payAddress))}" target="_blank" rel="noopener"><code class="wrap">${esc(payAddress)}</code></a>. The grader checks the payment on Base before it opens your request, and a payment can only be used once.</p>
      <div class="row" id="rq-wallet" hidden>
        <button type="button" id="rq-wallet-pay">Pay with my wallet</button>
        <span class="muted small">MetaMask, Coinbase Wallet or similar. You need the USDC on Base plus a little ETH for the network fee (under a cent).</span>
      </div>
      <p class="muted small" id="rq-status" role="status" aria-live="polite"></p>
      ${field({ name: 'payment', label: 'Payment transaction', required: true, max: 300, value: form.payment, bad: bad('payment'), placeholder: 'https://basescan.org/tx/0x...',
        help: 'The Basescan link or transaction hash for your USDC payment. The wallet button fills this in for you.' })}
      ${cardLink ? `<p class="small">Rather pay by card? <a href="${esc(cardLink)}" target="_blank" rel="noopener">Pay $${PRICE.test} by card</a>. Stripe asks for your agent's link itself, so you don't need this form.</p>` : ''}

      <h2>3. Send it</h2>
      <p><button type="submit">Send my request</button></p>
      <p class="muted small">Your request becomes a public page on Agent Report Card's GitHub, the grading service behind Polly. You don't need a GitHub account to read it. We give you a status page here too.</p>
    </form>
    ${myRequestsBlock(mine)}
    <section class="card section">
      <h2>What happens next</h2>
      <ol class="plain-list">
        <li>The grader checks your payment and opens your request.</li>
        <li>Polly writes tasks that match what your agent says it does, plus the honesty checks (not for MCP servers), and runs them.</li>
        <li>Two judges score every answer: Reppo (70%) and SERV (30%).</li>
        <li>Your grade, every answer and a badge land on the request, usually within half an hour, then on Agent Parrot with a place in the Pecking Order.</li>
      </ol>
      <p class="muted">Grades are snapshots, not verdicts on the people who built the agent. <a href="/get-polly-tested">More about the Polly Test</a>.</p>
    </section>
    <script src="/request.js" defer></script>`, { description: 'Request a Polly Test for your AI agent: real tasks, two independent judges and a public grade. $10, retests $5.' });
}

export function requestStatusPage({ row, live, tested, existing = false }) {
  const graded = live?.state === 'closed';
  const onSite = tested && tested.gradedAt && new Date(tested.gradedAt) >= new Date(row.created_at);
  const step = (done, now, title, text) => `<li class="rq-step ${done ? 'done' : now ? 'now' : ''}"><b>${done ? '✓' : now ? '…' : '○'} ${esc(title)}</b><br><span class="muted small">${text}</span></li>`;
  return layout(`Polly Test request: ${row.name || 'your agent'}`, `
    <section class="page-head">
      <p class="eyebrow">Polly Test request</p>
      <h1>${esc(row.name || 'Your agent')}</h1>
      <p class="lead">${existing ? 'That payment already had a request, so here it is.' : 'Payment checked and your request is open.'} Bookmark this page to check on it.</p>
    </section>
    <section class="card section">
      <h2>Where it's at</h2>
      <ol class="plain-list rq-steps">
        ${step(true, false, 'Paid and sent', `Sent ${esc(dateLabel(row.created_at))}${row.price_usd ? `, $${esc(Number(row.price_usd))}` : ''}.`)}
        ${step(graded, !graded, 'Polly is testing it', graded ? 'Done.' : live ? 'Usually within half an hour.' : "We couldn't read the request just now. It's still on GitHub.")}
        ${step(graded, false, 'Graded', graded ? `The grade, report and badge are on the request${live.closedAt ? ` (${esc(dateLabel(live.closedAt))})` : ''}.` : 'The grader posts the grade on the request.')}
        ${step(onSite, graded && !onSite, 'On Agent Parrot', onSite ? `${gradeBadge(tested.grade)} <a href="/agents/${encodeURIComponent(tested.id)}">See ${esc(tested.name)} in the directory</a>.` : 'Shows up here, with its place in the Pecking Order, when we next copy grades over.')}
      </ol>
      <p><a class="btn" href="${esc(row.request_url)}" target="_blank" rel="noopener">See the full request</a></p>
      <p class="muted small">The request is a public page on Agent Report Card's GitHub. You can read it without an account${live?.comments ? `; it has ${Number(live.comments)} ${live.comments === 1 ? 'reply' : 'replies'} so far` : ''}.</p>
    </section>
    <section class="card section"><h2>Agent</h2>
      <p><code class="wrap">${esc(row.agent)}</code></p>
      ${row.tx ? `<p class="small">Payment: <a href="https://basescan.org/tx/${esc(row.tx)}" target="_blank" rel="noopener"><code class="wrap">${esc(row.tx)}</code></a></p>` : ''}
      <p><a href="/request">Request another test</a></p>
    </section>`, { description: 'The status of a Polly Test request.' });
}
