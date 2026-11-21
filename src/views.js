// Page HTML, built from template strings. Escape everything that isn't written here by hand with esc().
import { AsyncLocalStorage } from 'node:async_hooks';
import { CATEGORIES, categoryName, GRADE_MEANING, verdict } from './agents.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const BRAND = 'Agent Parrot';
export const TAGLINE = 'Every agent here has been Polly Tested.';
export const SLOGAN = 'Polly wants a grade';
export const DEFAULT_DESCRIPTION = 'The AI agent community where every listed agent has been tested. Graded agents, the Pecking Order, daily satire and a daily game.';

// Set for each request by the routes: who is signed in, the site address and the page path.
export const pageContext = new AsyncLocalStorage();
export const siteUrl = (path = '/') => `${(pageContext.getStore()?.baseUrl ?? '').replace(/\/$/, '')}${path}`;
const graderUrl = () => pageContext.getStore()?.graderUrl ?? 'https://grader.designimp.com';
export const linkedInShareUrl = (path) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(siteUrl(path))}`;
export const xShareUrl = (path, text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(siteUrl(path))}`;

export const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const paras = (text) => String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

function previewTags({ title, description, type, image = '/og.png' }) {
  const ctx = pageContext.getStore();
  if (!ctx?.baseUrl) return '';
  const url = siteUrl(ctx.path ?? '/');
  return `
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl(image))}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">`;
}

const NAV = [
  ['/agents', 'Directory'], ['/pecking-order', 'Pecking Order'], ['/news', 'News'], ['/game', 'Game'], ['/articles', 'Articles'], ['/get-polly-tested', 'Get tested'],
];

export function layout(title, body, { wide = false, description = DEFAULT_DESCRIPTION, ogType = 'website', ogImage, fullTitle = false } = {}) {
  const ctx = pageContext.getStore();
  const path = ctx?.path ?? '';
  const nav = NAV.map(([href, label]) => `<a href="${href}"${path === href || path.startsWith(`${href}/`) ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle ? esc(title) : `${esc(title)} · ${BRAND}`}</title>${previewTags({ title, description, type: ogType, image: ogImage })}
  <link rel="icon" href="/parrot.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-48.png" sizes="48x48" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap">
  <meta name="theme-color" content="#ffffff">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/" class="brand"><img src="/parrot.svg" class="mark" width="40" height="40" alt=""><span class="logo">Agent<b>Parrot</b></span></a>
      <nav aria-label="Main">${nav}${ctx?.signedIn
        ? '<a href="/me" class="nav-signin">My perch</a>'
        : '<a href="/signin" class="nav-signin">Join</a>'}</nav>
    </div>
  </header>
  <main class="wrap${wide ? ' wide' : ''}">${body}</main>
  <footer class="footer">
    <div class="footer-inner">
      <div><img src="/parrot.svg" width="36" height="36" alt=""> <strong>${SLOGAN}.</strong></div>
      <p>Grades come from <a href="${esc(graderUrl())}">Agent Report Card</a>, two independent judges per answer.
        The Daily Hallucination is satire: the stories are made up on purpose and link to the real news they poke fun at.</p>
      <p><a href="/squawk">The Squawk</a> · <a href="/articles">Articles</a> · <a href="/get-polly-tested">Get Polly Tested</a> · <a href="/feed">Grades feed</a> · <a href="/privacy">Privacy</a></p>
    </div>
  </footer>
</body>
</html>`;
}

// ----- Small pieces -----

export const gradeBadge = (grade, { size = '' } = {}) => `<span class="grade grade-${esc(grade)} ${size}" title="Polly Tested: ${esc(grade)}">${esc(grade)}</span>`;
const verdictTag = (grade) => {
  const v = verdict(grade);
  return v === 'cracker' ? '<span class="tag tag-pass">Cracker</span>' : v === 'feather' ? '<span class="tag tag-fail">Plucked</span>' : '<span class="tag tag-mid">Mixed</span>';
};
const honestyTag = (h) => (h === 'passed' ? '<span class="tag tag-pass">Honest</span>' : h === 'failed' ? '<span class="tag tag-fail">Made it up</span>' : '');

export function agentCard(a) {
  return `<a class="agent-card" href="/agents/${esc(a.id)}">
      ${gradeBadge(a.grade)}
      <span class="agent-main"><strong>${esc(a.name)}</strong><span class="muted small">${esc(categoryName(a.category))} · Squawk Score ${Number(a.score)}</span>
        <span class="agent-desc">${esc(a.description)}</span></span>
      <span class="agent-tags">${verdictTag(a.grade)}${honestyTag(a.honesty)}</span>
    </a>`;
}

function categoryTabs(base, current) {
  const tabs = [['', 'All'], ...CATEGORIES.map((c) => [c.id, c.name])];
  return `<nav class="tabs" aria-label="Categories">${tabs.map(([id, name]) =>
    `<a href="${base}${id ? `?category=${id}` : ''}"${(current || '') === id ? ' aria-current="page"' : ''}>${esc(name)}</a>`).join('')}</nav>`;
}

// Sign-in buttons for every provider that is set up.
export function signInButtons(providers, { compact = false } = {}) {
  const btn = (id, label, icon) => `<a class="btn-provider btn-${id}" href="/auth/${id}">${icon}<span>${compact ? label : `Continue with ${label}`}</span></a>`;
  const icons = {
    linkedin: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5A2.5 2.5 0 1 1 5 8.5a2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3zM9.5 9.75h3.8v1.6h.06c.53-1 1.84-2.06 3.79-2.06 4.05 0 4.8 2.67 4.8 6.13V21h-4v-4.9c0-1.17-.02-2.67-1.63-2.67-1.63 0-1.88 1.27-1.88 2.59V21h-4z"/></svg>',
    google: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.2 3.3v2.75h3.55c2.08-1.92 3.25-4.74 3.25-8.08z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.75c-.98.66-2.24 1.05-3.73 1.05-2.87 0-5.3-1.94-6.16-4.54H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.7 7.32 9.13 5.38 12 5.38z"/></svg>',
    github: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
  };
  const labels = { linkedin: 'LinkedIn', google: 'Google', github: 'GitHub' };
  return `<div class="providers">${providers.filter((p) => labels[p]).map((p) => btn(p, labels[p], icons[p])).join('')}</div>`;
}

export function emailLoginForm({ email = '', label = 'Or get a sign-in link by email', id = 'login-email' } = {}) {
  return `<form class="email-login" method="post" action="/auth/email">
      <label for="${id}">${esc(label)}</label>
      <div class="email-row">
        <input id="${id}" type="email" name="email" required maxlength="254" autocomplete="email" value="${esc(email)}" placeholder="you@example.com">
        <button type="submit">Email me a link</button>
      </div>
    </form>`;
}

function ticker(stories) {
  if (!stories.length) return '';
  const items = stories.map((s) => `<a href="/news/${Number(s.id)}"><b>The Daily Hallucination</b> ${esc(s.headline)}</a>`).join('');
  return `<div class="ticker" aria-label="Today's Daily Hallucination"><div class="ticker-run">${items}<span aria-hidden="true" class="ticker-copy">${items.replaceAll('<a ', '<a tabindex="-1" ')}</span></div></div>`;
}

// The "Polly Tested" box under a satire story: plain facts about one real tested agent, never part of the joke.
export function pollyBox(agent) {
  if (!agent) return '';
  return `<aside class="polly-box">
      <img src="/parrot.svg" width="32" height="32" alt="">
      <div><p class="eyebrow">Meanwhile, in real life · Polly Tested</p>
        <p><a href="/agents/${esc(agent.id)}"><strong>${esc(agent.name)}</strong></a> got ${gradeBadge(agent.grade, { size: 'sm' })} (Squawk Score ${Number(agent.score)}) on real ${esc(categoryName(agent.category).toLowerCase())} tasks.
          <a href="/agents/${esc(agent.id)}">See what it got right and wrong</a>.</p></div>
    </aside>`;
}

// ----- Home -----

// A row of small bars, one per task, like a price sparkline: how the agent scored on each answer.
function taskBars(tasks) {
  const bars = tasks.map((t) => (t.score === null
    ? '<span class="bar none" title="Not scored"></span>'
    : `<span class="bar ${t.score >= 80 ? 'hi' : t.score >= 50 ? 'mid' : 'lo'}" style="height:${Math.max(8, Number(t.score))}%" title="${Number(t.score)}"></span>`)).join('');
  return `<span class="task-bars" aria-label="Task scores: ${tasks.map((t) => (t.score === null ? 'not scored' : Number(t.score))).join(', ')}">${bars}</span>`;
}

const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// The ranked table of every agent: the centre of the home page.
export function agentTable(rows) {
  const body = rows.map((a) => `<tr>
      <td class="place">${Number(a.place)}</td>
      <td class="agent-cell"><a href="/agents/${esc(a.id)}"><img src="/parrot.svg" width="24" height="24" alt=""><span><strong>${esc(a.name)}</strong><span class="muted small">${esc(a.description)}</span></span></a></td>
      <td>${gradeBadge(a.grade, { size: 'sm' })}</td>
      <td class="num">${Number(a.score)}</td>
      <td class="hide-sm">${taskBars(a.tasks)}</td>
      <td class="hide-sm">${honestyTag(a.honesty) || '<span class="muted small">Not asked</span>'}</td>
      <td class="hide-md muted small">${esc(categoryName(a.category))}</td>
      <td class="hide-md muted small num-plain">${esc(shortDate(a.gradedAt))}</td></tr>`).join('');
  return `<div class="table-card table-scroll"><table class="agent-table">
      <thead><tr><th>#</th><th>Agent</th><th>Grade</th><th class="num">Squawk Score</th><th class="hide-sm">Task scores</th><th class="hide-sm">Honesty</th><th class="hide-md">Category</th><th class="hide-md">Tested</th></tr></thead>
      <tbody>${body || '<tr><td colspan="8" class="muted">No agents in this category yet.</td></tr>'}</tbody>
    </table></div>`;
}

export function homePage({ member, memberCount, stats, rows, category, honestyFails, makers, stories, articles, gameNo, providers, emailLogin, inviter, error }) {
  const firstName = esc(member?.first_name || member?.name || '');
  const join = member
    ? (member.consent_at
      ? `<p class="notice">Welcome back${firstName ? `, ${firstName}` : ''}. <a href="/me">Your perch</a></p>`
      : `<p class="notice">You're signed in but haven't finished joining. <a href="/join">Finish joining</a></p>`)
    : `${signInButtons(providers)}${emailLogin ? emailLoginForm() : ''}`;
  const miniRow = (a, right) => `<li><a href="/agents/${esc(a.id)}">${gradeBadge(a.grade, { size: 'sm' })}<span class="pname">${esc(a.name)}</span><span class="pscore">${right}</span></a></li>`;
  const top3 = rows.length && !category ? stats.top3 : rows.slice(0, 3);
  return layout(`${BRAND}: the AI agent directory where every agent is tested`, `
    <section class="market-head">
      <h1>Every AI agent here has been <em>Polly Tested</em></h1>
      <p class="market-line">There are <strong>${Number(stats.count)}</strong> tested agents. <strong>${Number(stats.grades.A)}</strong> got an A,
        <strong>${Number(stats.honestyFailed.length)}</strong> made something up, and every one of the <strong>${Number(stats.tasks)}</strong> answers was scored by two independent judges.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${inviter ? `<p class="invited">${esc(inviter.first_name)} invited you to the flock.</p>` : ''}
    </section>
    ${ticker(stories)}
    <section class="highlights" aria-label="Highlights">
      <div class="hl-card">
        <div class="card-head"><h2>Top of the Pecking Order</h2><a href="/pecking-order">More</a></div>
        <ol class="pecking-mini">${top3.map((a) => miniRow(a, Number(a.score))).join('')}</ol>
      </div>
      <div class="hl-card">
        <div class="card-head"><h2>Made something up</h2><a href="/articles/ask-it-something-it-cant-know">Why</a></div>
        <ol class="pecking-mini">${honestyFails.slice(0, 3).map((a) => miniRow(a, '<span class="tag tag-fail">Made it up</span>')).join('') || '<li class="muted small">Nobody yet.</li>'}</ol>
      </div>
      <div class="hl-card hl-stack">
        <a class="daily-teaser" href="/game"><span class="eyebrow">Spot the Hallucination #${Number(gameNo)}</span>
          <strong>Two answers. One is making it up. Can you tell which?</strong><span class="go">Play</span></a>
        <a class="daily-teaser" href="/news"><span class="eyebrow">The Daily Hallucination</span>
          <strong>${stories[0] ? esc(stories[0].headline) : "Today's AI news, made slightly less believable."}</strong><span class="go">Read</span></a>
      </div>
    </section>
    <section class="market">
      <div class="card-head"><h2>AI agents by Squawk Score</h2><a href="/get-polly-tested">Get your agent tested</a></div>
      ${categoryTabs('/', category)}
      ${agentTable(rows)}
    </section>
    ${makers ? `<section class="makers" aria-label="From the makers">
      <p class="eyebrow">From the makers of Agent Parrot</p>
      <div class="makers-grid">
        <a class="maker-card" href="https://cheap-first.vercel.app/" rel="noopener">
          ${gradeBadge(makers.grade, { size: 'sm' })}<span><strong>Cheap First</strong>
          <span class="muted small">Answers with a cheap model first, has the answer checked, and only pays for a premium model when the check fails. Polly Tested: ${esc(makers.grade)}, Squawk Score ${Number(makers.score)}.</span></span><span class="go">Try it</span></a>
        <a class="maker-card" href="${esc(graderUrl())}" rel="noopener">
          <img src="/parrot.svg" width="32" height="32" alt=""><span><strong>Agent Report Card</strong>
          <span class="muted small">The grader behind every Polly Test. Real tasks, a question your agent can't know, and two independent judges.</span></span><span class="go">Grade your agent</span></a>
      </div>
      <p class="fine">We built these, so we've said so. Cheap First was graded by the same test as every other agent.</p>
    </section>` : ''}
    <section class="two-col">
      ${member ? `<div class="card">${join}</div>` : `<div class="card join-card"><h2>Join the flock. It's free.</h2>
        <p class="muted">Play the daily game with a streak, get The Squawk every week, and suggest agents for Polly to test.</p>${join}
        <p class="fine">${memberCount >= 5 ? `${Number(memberCount)} people have joined. ` : 'Be one of the first members. '}We only get your name, email and photo, and never post for you.</p></div>`}
      <a class="daily-teaser accent" href="/get-polly-tested"><span class="eyebrow">Built an agent?</span>
        <strong>Get it Polly Tested and earn your place in the Pecking Order.</strong><span class="go">Get tested</span></a>
    </section>
    <section class="section">
      <div class="card-head"><h2>From the perch</h2><a href="/articles">All articles</a></div>
      <div class="article-grid">${articles.map(articleCard).join('')}</div>
    </section>
    <section class="section">
      <h2>How the Polly Test works</h2>
      <div class="steps">
        <div class="step"><span class="num">1</span><h3>Real tasks</h3><p>Each agent gets the kind of work it says it can do, with criteria written before it answers.</p></div>
        <div class="step"><span class="num">2</span><h3>A question it can't know</h3><p>The honest answer is "I don't know". Making something up costs it dearly.</p></div>
        <div class="step"><span class="num">3</span><h3>Two judges</h3><p>Independent judges on Reppo (70%) and an automatic check on SERV (30%) score every answer.</p></div>
        <div class="step"><span class="num">4</span><h3>A grade you can check</h3><p>Every answer and every score is published, so you can see exactly why.</p></div>
      </div>
      <p><a href="/articles/how-the-polly-test-works">Read the full method</a></p>
    </section>`, { fullTitle: true, wide: true });
}

export function articleCard(x) {
  return `<a class="article-card" href="/articles/${esc(x.slug)}"><span class="tag">${esc(x.tag)}</span><h3>${esc(x.title)}</h3><p>${esc(x.dek)}</p></a>`;
}

// ----- Directory, agent pages and the Pecking Order -----

export function directoryPage({ agents, listings, category, notice, error, signedIn }) {
  const cats = CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  return layout('Tested AI agents', `
    <section class="page-head">
      <p class="eyebrow">The directory</p>
      <h1>AI agents, tested</h1>
      <p class="lead">Every agent below has taken the Polly Test: real tasks, two judges, and one question it can't know.
        Tap any agent to see its answers.</p>
    </section>
    ${categoryTabs('/agents', category)}
    <div class="agent-list">${agents.map(agentCard).join('') || '<p class="muted">No tested agents in this category yet.</p>'}</div>
    ${listings.length ? `<section class="section">
      <h2>Not Polly Tested yet</h2>
      <p class="muted">Listed so you can find them. Polly hasn't checked their work, so there's no grade.</p>
      <div class="agent-list">${listings.map((l) => `<div class="agent-card untested">
        <span class="grade grade-none" title="Not tested">?</span>
        <span class="agent-main"><strong><a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.name)}</a></strong><span class="muted small">${esc(categoryName(l.category))} · not tested</span>
          <span class="agent-desc">${esc(l.description)}</span></span>
        <span class="agent-tags"><a class="btn small" href="/get-polly-tested?agent=${encodeURIComponent(l.url)}">Get it tested</a></span></div>`).join('')}</div>
    </section>` : ''}
    <p class="listed-link"><a href="/listed">See thousands more agents from the Official MCP Registry and ERC-8004</a>: not Polly Tested yet, so no grades.</p>
    <section class="card section" id="suggest">
      <h2>Know an agent we should list?</h2>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${signedIn ? `<form method="post" action="/agents/suggest" class="stack">
        <div class="grid2"><label>Agent name<input name="name" required maxlength="80"></label>
          <label>Link<input name="url" type="url" required maxlength="300" placeholder="https://"></label></div>
        <div class="grid2"><label>What it does<input name="description" maxlength="200"></label>
          <label>Category<select name="category">${cats}</select></label></div>
        <button type="submit">Suggest it</button>
      </form>` : '<p><a href="/signin">Join</a> (free) to suggest agents for the directory.</p>'}
    </section>`, { description: 'AI agents, tested. Every agent in the Agent Parrot directory has a grade from real tasks and two independent judges.' });
}

export function agentPage({ agent, place, total, listed = '' }) {
  const tasks = agent.tasks.map((t) => `
      <article class="task">
        <div class="task-head"><span class="task-score score-${t.score === null ? 'none' : t.score >= 70 ? 'ok' : 'bad'}">${t.score === null ? '…' : Number(t.score)}</span>
          <div><p class="eyebrow">${t.honesty ? `Honesty check · ${esc(t.honesty)}` : 'Task'}</p><h3>${esc(t.prompt)}</h3></div></div>
        ${t.verdict ? `<p class="judge"><b>Judges' note:</b> ${esc(t.verdict)}</p>` : ''}
        <details><summary>Read the agent's answer</summary><pre class="answer">${esc(t.answer)}</pre></details>
      </article>`).join('');
  const report = `${graderUrl()}/agents/${encodeURIComponent(agent.id)}/`;
  return layout(`${agent.name}: Polly Tested ${agent.grade}`, `
    <section class="agent-hero">
      ${gradeBadge(agent.grade, { size: 'xl' })}
      <div>
        <p class="eyebrow">${esc(categoryName(agent.category))} · Polly Tested ${esc(dateLabel(agent.gradedAt))}</p>
        <h1>${esc(agent.name)}</h1>
        <p class="lead">${esc(agent.description)}</p>
        <p class="meaning"><strong>Grade ${esc(agent.grade)}.</strong> ${esc(GRADE_MEANING[agent.grade])}</p>
        <div class="facts">
          <span><b>${Number(agent.score)}</b> Squawk Score</span>
          <span><b>#${Number(place)}</b> of ${Number(total)} in the <a href="/pecking-order">Pecking Order</a></span>
          <span>${agent.honesty === 'failed' ? '<b class="bad">Made something up</b> on the honesty check' : agent.honesty === 'passed' ? '<b class="ok">Honest</b> on the honesty check' : 'Honesty check pending'}</span>
          ${agent.provisional ? '<span class="muted">Provisional: some judges still scoring</span>' : ''}
        </div>
        ${listed}
        <div class="hero-actions">
          ${agent.url ? `<a class="btn" href="${esc(agent.url)}" target="_blank" rel="noopener">Visit the agent</a>` : ''}
          <a class="btn ghost" href="${esc(report)}" target="_blank" rel="noopener">Full report card</a>
          <a class="btn ghost" href="${esc(xShareUrl(`/agents/${agent.id}`, `${agent.name} got ${agent.grade} in the Polly Test 🦜`))}" target="_blank" rel="noopener">Share on X</a>
        </div>
      </div>
    </section>
    <section class="section">
      <h2>What Polly asked, and how it did</h2>
      ${tasks}
    </section>
    <section class="card cta-card">
      <img src="/parrot.svg" width="56" height="56" alt="">
      <div><h2>Did you build ${esc(agent.name)}?</h2>
        <p>Fixed something since ${esc(dateLabel(agent.gradedAt))}? A retest is $5 and updates this page.</p>
        <a class="btn" href="/get-polly-tested?agent=${encodeURIComponent(agent.url || agent.name)}">Get retested</a></div>
    </section>`, { description: `${agent.name} got ${agent.grade} (Squawk Score ${agent.score}) in the Polly Test. See every task, every answer and both judges' scores.`, ogType: 'article' });
}

export function peckingOrderPage({ rows, category }) {
  const body = rows.map((a) => `<tr>
      <td class="place">${Number(a.place)}</td>
      <td><a href="/agents/${esc(a.id)}"><strong>${esc(a.name)}</strong></a><br><span class="muted small">${esc(categoryName(a.category))}</span></td>
      <td>${gradeBadge(a.grade, { size: 'sm' })}</td>
      <td class="num">${Number(a.score)}</td>
      <td>${honestyTag(a.honesty)}</td></tr>`).join('');
  return layout('The Pecking Order', `
    <section class="page-head">
      <p class="eyebrow">Leaderboard</p>
      <h1>The Pecking Order</h1>
      <p class="lead">Every Polly Tested agent, best first. The Squawk Score is the average of every answer, scored by two judges. Ties share a place.</p>
    </section>
    ${categoryTabs('/pecking-order', category)}
    <div class="card table-scroll"><table class="pecking">
      <thead><tr><th>#</th><th>Agent</th><th>Grade</th><th class="num">Squawk Score</th><th>Honesty</th></tr></thead>
      <tbody>${body || '<tr><td colspan="5" class="muted">No agents in this category yet.</td></tr>'}</tbody>
    </table></div>
    <p class="muted small">Not on the list? <a href="/get-polly-tested">Get your agent Polly Tested</a>.</p>`, { description: 'The Pecking Order: every Polly Tested AI agent, ranked by Squawk Score.' });
}

export function getTestedPage({ agent = '' }) {
  const request = `${graderUrl()}/request/${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`;
  return layout('Get Polly Tested', `
    <section class="page-head">
      <p class="eyebrow">For builders</p>
      <h1>Get Polly Tested</h1>
      <p class="lead">Put your agent through real tasks and two independent judges, then earn its place in the Pecking Order.</p>
    </section>
    <div class="price-grid">
      <div class="card price"><h2>Polly Test</h2><p class="amount">$10</p><ul>
        <li>Up to ten real tasks of the kind your agent does</li><li>The honesty checks, including the question it can't know</li>
        <li>Two judges on every answer: Reppo (70%) and SERV (30%)</li><li>A public grade, every answer, and a badge for your README</li>
        <li>A listing in the directory and the Pecking Order</li></ul>
        <a class="btn" href="${esc(request)}" target="_blank" rel="noopener">Order a Polly Test</a></div>
      <div class="card price"><h2>Retest</h2><p class="amount">$5</p><ul>
        <li>Improved your agent? Run the same tasks again</li><li>Your page and your place update with the new grade</li>
        <li>The old grade stays in the history, so the improvement shows</li></ul>
        <a class="btn ghost" href="${esc(request)}" target="_blank" rel="noopener">Order a retest</a></div>
    </div>
    <section class="card section">
      <h2>How it works</h2>
      <ol class="plain-list">
        <li>Order on Agent Report Card, the grading service behind Agent Parrot. Pay by card or in USDC.</li>
        <li>We write tasks that match what your agent says it does, then run them against it.</li>
        <li>Both judges score every answer. Grades usually land within a day.</li>
        <li>Your agent appears here with its grade, its answers and a "Polly Tested" badge you can show off.</li>
      </ol>
      <p class="muted">Grades are snapshots, not verdicts on the people who built the agent. If you think we got something wrong, tell us and we'll look again.</p>
    </section>`, { description: 'Get your AI agent Polly Tested: real tasks, two independent judges and a public grade. $10, retests $5.' });
}

// ----- The Daily Hallucination -----

function storyBlock(s, agent, { link = true } = {}) {
  return `<article class="story" id="story-${Number(s.id)}">
      <p class="eyebrow">The Daily Hallucination · ${esc(dateLabel(s.day))}</p>
      <h2>${link ? `<a href="/news/${Number(s.id)}">${esc(s.headline)}</a>` : esc(s.headline)}</h2>
      ${paras(s.body).map((p) => `<p>${esc(p)}</p>`).join('')}
      <p class="source">Satire, inspired by a real story: <a href="${esc(s.source_link)}" target="_blank" rel="noopener">${esc(s.source)}: ${esc(s.source_title)}</a></p>
      ${pollyBox(agent)}
    </article>`;
}

export function newsPage({ stories, agentFor, headlines = [] }) {
  const body = stories.length
    ? stories.map((s) => storyBlock(s, agentFor(s.agent_id))).join('')
    : headlines.length
      ? `<p class="notice">Polly is still warming up. Here are today's real AI headlines.</p><ul class="headlines">${headlines.slice(0, 20).map((h) =>
        `<li><a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted small">${esc(h.source)}</span></li>`).join('')}</ul>`
      : '<p class="muted">The first stories land tomorrow morning.</p>';
  return layout('The Daily Hallucination', `
    <section class="page-head">
      <p class="eyebrow">Satire, daily</p>
      <h1>The Daily Hallucination</h1>
      <p class="lead">Five of today's AI stories, retold by a parrot who has read too many agent logs. Made up on purpose, with a link to the real thing.</p>
    </section>
    <div class="stories">${body}</div>`, { description: "The Daily Hallucination: today's AI news as satire. Made up on purpose, with links to the real stories." });
}

export function storyPage({ story, agent }) {
  return layout(story.headline, `<div class="stories">${storyBlock(story, agent, { link: false })}</div>
    <p class="share-row"><a class="btn ghost" href="${esc(xShareUrl(`/news/${story.id}`, story.headline))}" target="_blank" rel="noopener">Share on X</a>
      <a class="btn ghost" href="${esc(linkedInShareUrl(`/news/${story.id}`))}" target="_blank" rel="noopener">Share on LinkedIn</a> <a href="/news">More from today</a></p>`,
  { description: paras(story.body)[0]?.slice(0, 200), ogType: 'article' });
}

// ----- Spot the Hallucination -----

export function gamePage({ rounds, gameNo, played, streak, signedIn, stats }) {
  // The rounds go to the page as JSON for the game script. "<" is escaped so the text can't close the script tag.
  const data = JSON.stringify({ gameNo, rounds, played, signedIn }).replace(/</g, '\\u003c');
  return layout(`Spot the Hallucination #${gameNo}`, `
    <section class="page-head">
      <p class="eyebrow">The daily game · #${Number(gameNo)}</p>
      <h1>Spot the Hallucination</h1>
      <p class="lead">Each round is one question answered twice. One answer is making it up. Pick it. Three rounds, new ones every day.</p>
      ${signedIn ? `<p class="muted small">${streak ? `Your streak: <b>${Number(streak)} day${streak === 1 ? '' : 's'}</b>.` : 'Play every day to build a streak.'}${stats.players ? ` ${Number(stats.players)} member${stats.players === 1 ? ' has' : 's have'} played today.` : ''}</p>`
        : '<p class="muted small"><a href="/signin">Join</a> to keep a streak.</p>'}
    </section>
    <div id="game" class="game"><noscript><p class="error">The game needs JavaScript switched on.</p></noscript></div>
    <script type="application/json" id="game-data">${data}</script>
    <script src="/game.js" defer></script>`, { description: 'Spot the Hallucination: two AI answers, one is making it up. Can you tell which? A new game every day.' });
}

// ----- Articles -----

export function articlesPage({ articles }) {
  return layout('Articles', `
    <section class="page-head"><p class="eyebrow">From the perch</p><h1>Articles</h1>
      <p class="lead">What the Polly Test tells us about AI agents. Every claim links to a real grade.</p></section>
    <div class="article-grid">${articles.map(articleCard).join('')}</div>`, { description: 'Articles from Agent Parrot, built on real AI agent test results.' });
}

export function articlePage({ article, more }) {
  return layout(article.title, `
    <article class="card prose article">
      <p class="eyebrow">${esc(article.tag)} · ${esc(dateLabel(article.date))}</p>
      <h1>${esc(article.title)}</h1>
      <p class="dek">${esc(article.dek)}</p>
      ${article.body}
      <p class="share-row"><a class="btn ghost" href="${esc(xShareUrl(`/articles/${article.slug}`, article.title))}" target="_blank" rel="noopener">Share on X</a>
        <a class="btn ghost" href="${esc(linkedInShareUrl(`/articles/${article.slug}`))}" target="_blank" rel="noopener">Share on LinkedIn</a></p>
    </article>
    <section class="section"><h2>More from the perch</h2><div class="article-grid">${more.map(articleCard).join('')}</div></section>`,
  { description: article.dek, ogType: 'article' });
}

// ----- Joining and members -----

export function signInPage({ providers, emailLogin, error }) {
  return layout('Join the flock', `
    <section class="card narrow">
      <img src="/parrot.svg" width="64" height="64" alt="">
      <h1>Join the flock</h1>
      <p>Free. Keep a game streak, suggest agents, and get The Squawk, our weekly email. Already a member? Same buttons.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${providers.length ? signInButtons(providers) : ''}
      ${emailLogin ? emailLoginForm({ label: providers.length ? 'Or get a sign-in link by email' : 'Get a sign-in link by email' }) : ''}
      ${!providers.length && !emailLogin ? '<p class="error">Sign-in is not set up yet.</p>' : ''}
      <p class="fine">We only receive your name, email and photo. We never post for you, and you can remove yourself at any time. <a href="/privacy">Privacy</a></p>
    </section>`, { description: 'Join Agent Parrot, the AI agent community where every listed agent is tested.' });
}

export const LINK_MINUTES = 30;

export function emailSignInPage({ email = '', sent = false, expired = false, error }) {
  const body = sent
    ? `<h1>Check your email</h1><p>We've sent a sign-in link to <strong>${esc(email)}</strong>. It works once, for ${LINK_MINUTES} minutes.</p>
       <p class="muted">Nothing there? Check your spam or junk folder, and mark it "not spam" so the next one arrives.</p>`
    : `<h1>${expired ? 'That link has expired' : 'Sign in by email'}</h1>
       ${expired ? '<p>Sign-in links work once, for a short time. Ask for a new one below.</p>' : ''}
       ${error ? `<p class="error">${esc(error)}</p>` : ''}
       ${emailLoginForm({ email, label: 'Your email address' })}`;
  return layout('Sign in by email', `<section class="card narrow">${body}</section>`);
}

export function emailConfirmPage({ email, token }) {
  return layout('Sign in', `<section class="card narrow"><h1>Sign in to ${BRAND}</h1><p>Signing in as <strong>${esc(email)}</strong>.</p>
    <form method="post" action="/auth/email/verify"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">Sign me in</button></form></section>`);
}

export function signInEmail({ to, link }) {
  return {
    to, subject: `Your ${BRAND} sign-in link`,
    text: `Here's your link to sign in to ${BRAND}. It works once, for ${LINK_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: `<p>Here's your link to sign in to ${BRAND}. It works once, for ${LINK_MINUTES} minutes:</p><p><a href="${esc(link)}">Sign me in</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
  };
}

export const ROLES = [
  ['builder', 'I build AI agents'],
  ['user', 'I use AI agents for work'],
  ['curious', "I'm just curious"],
];

export function joinPage({ member, error }) {
  const needsName = member.id.startsWith('email:');
  return layout('Finish joining', `
    <section class="card narrow">
      ${member.photo_url ? `<img src="${esc(member.photo_url)}" alt="" class="avatar">` : ''}
      <h1>One quick question</h1>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <form method="post" action="/join" class="stack">
        ${needsName ? `<label>Your name<input name="name" required maxlength="80" value="${esc(member.name)}" autocomplete="name"></label>` : `<p>Signed in as <strong>${esc(member.name)}</strong>.</p>`}
        <fieldset><legend>What brings you here?</legend>
          ${ROLES.map(([v, l]) => `<label class="check"><input type="radio" name="role" value="${v}"${member.role === v ? ' checked' : ''}> <span>${esc(l)}</span></label>`).join('')}
        </fieldset>
        <label class="check"><input type="checkbox" name="squawk" value="yes"${member.squawk_optin || !member.consent_at ? ' checked' : ''}>
          <span>Email me The Squawk: the week's best Hallucinations, new grades and the Pecking Order, once a week.</span></label>
        <label class="check"><input type="checkbox" name="consent" value="yes" required${member.consent_at ? ' checked' : ''}>
          <span>I agree to ${BRAND} keeping my name, email and photo so I can be a member. I can remove myself at any time. <a href="/privacy">Privacy</a></span></label>
        <button type="submit">Join the flock</button>
      </form>
    </section>`);
}

export const FOUNDING_MEMBERS = 1000;

export function mePage({ member, inviteCode, invited, streak }) {
  const invite = siteUrl(`/i/${inviteCode}`);
  const founding = member.member_number && member.member_number <= FOUNDING_MEMBERS;
  return layout('Your perch', `
    <section class="card member-card">
      <div class="who">${member.photo_url ? `<img src="${esc(member.photo_url)}" alt="" class="avatar">` : '<img src="/parrot.svg" alt="" class="avatar">'}
        <div><h1>${esc(member.name)}</h1>
          <p>${member.member_number ? `<span class="tag ${founding ? 'founding' : ''}">${founding ? 'Founding member' : 'Member'} #${Number(member.member_number)}</span>` : ''}
            ${streak ? `<span class="tag">Game streak: ${Number(streak)}</span>` : ''}</p></div></div>
    </section>
    <section class="card">
      <h2>Bring a friend to the flock</h2>
      <p>Your personal invite link. ${invited ? `${Number(invited)} ${invited === 1 ? 'person has' : 'people have'} joined through it so far.` : "We'll count who joins through it."}</p>
      <p class="invite-link"><input readonly value="${esc(invite)}" aria-label="Your invite link" onclick="this.select()"></p>
      <p><a class="btn ghost" href="${esc(xShareUrl(`/i/${inviteCode}`, 'Every agent on Agent Parrot has been Polly Tested. Come and see the Pecking Order 🦜'))}" target="_blank" rel="noopener">Share on X</a>
        <a class="btn ghost" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(invite)}" target="_blank" rel="noopener">Share on LinkedIn</a></p>
    </section>
    <section class="card">
      <h2>The Squawk</h2>
      <form method="post" action="/squawk/subscription">
        <label class="check"><input type="checkbox" name="squawk" value="yes"${member.squawk_optin ? ' checked' : ''}${member.email ? '' : ' disabled'}>
          <span>Email me The Squawk once a week${member.email ? ` at ${esc(member.email)}` : ' (we have no email address for you)'}.</span></label>
        <button type="submit">Save</button>
      </form>
    </section>
    <section class="card">
      <h2>Leave</h2>
      <form method="post" action="/logout" class="inline"><button type="submit" class="ghost">Sign out</button></form>
      <form method="post" action="/remove" class="inline" onsubmit="return confirm('Remove your membership and everything we hold about you?')"><button type="submit" class="danger">Remove me completely</button></form>
    </section>`);
}

export function removedPage() {
  return layout('Removed', `<section class="card narrow"><h1>You've been removed</h1><p>We've deleted your membership and everything we held about you. Polly will miss you.</p><p><a href="/">Back to ${BRAND}</a></p></section>`);
}

export function messagePage({ title, text }) {
  return layout(title, `<section class="card narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Back to ${BRAND}</a></p></section>`);
}

export function errorPage(message) {
  return layout('Something went wrong', `<section class="card narrow"><img src="/parrot.svg" width="64" height="64" alt=""><h1>Squawk!</h1><p>${esc(message)}</p><p><a href="/">Back to ${BRAND}</a></p></section>`);
}

export function pageNotFound() {
  return layout('Not found', `<section class="card narrow"><img src="/parrot.svg" width="64" height="64" alt=""><h1>This page flew off</h1>
    <p>Polly looked everywhere. Try the <a href="/agents">directory</a> or the <a href="/pecking-order">Pecking Order</a>.</p></section>`);
}

export function privacyPage({ contactEmail }) {
  return layout('Privacy', `<section class="card prose">
    <h1>Privacy</h1>
    <p>${BRAND} is a free community about AI agents. This page explains what we keep about members and why.</p>
    <h2>What we keep</h2>
    <ul><li>Your name, email address and photo, from LinkedIn, Google or GitHub, or the email address you sign in with. For GitHub we also keep your username.</li>
      <li>What brings you here (builder, user or curious), if you tell us.</li>
      <li>Whether you want The Squawk, our weekly email.</li>
      <li>Your Spot the Hallucination results, so we can show your streak.</li>
      <li>Agents you suggest for the directory.</li>
      <li>The tag on the link you first arrived from and who invited you, so we know which posts bring people in.</li></ul>
    <h2>What we don't do</h2>
    <p>We never post on your behalf, never sell your details and never show your email to other members. We don't use advertising trackers.</p>
    <h2>Removing yourself</h2>
    <p>Use "Remove me completely" on <a href="/me">your perch</a>. It deletes your membership and everything above straight away.</p>
    <h2>Grades and satire</h2>
    <p>Agent grades come from Agent Report Card and describe how an agent handled our tasks on the day it was tested. The Daily Hallucination is satire: its stories are made up on purpose and always link to the real article.</p>
    ${contactEmail ? `<h2>Contact</h2><p>Questions or requests: <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a></p>` : ''}
  </section>`);
}
