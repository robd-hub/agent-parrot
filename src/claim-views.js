// HTML for claiming a listing (see src/claims.js), the "Claimed by its maker" tick and the badge image.
import { esc, layout, dateLabel, siteUrl } from './views.js';
import { displayName } from './review-views.js';

export const CLAIM_NOTICES = {
  claimed: ['notice', "It's yours. Your agent now shows \"Claimed by its maker\", and your badge is ready below."],
  taken: ['error', 'Someone has already claimed this agent.'],
  github: ['error', "The GitHub account you signed in with isn't the one this listing names. Sign in with that account, or use the code below."],
  notfound: ['error', "We couldn't find your code yet. Check the file is public and holds the whole line, then try again. Some sites take a few minutes to update."],
  checked: ['notice', 'Done. The result of the basic check is below.'],
  slow: ['error', `You ran the check a few minutes ago. Please try again shortly.`],
  noaddress: ['error', "This listing has no address we can check, so there's no basic check for it yet."],
  notyours: ['error', 'Only the person who claimed this agent can do that.'],
  released: ['notice', "You've given up your claim. Anyone who can prove they own it can claim it now."],
};

const noticeHtml = (code) => {
  const n = CLAIM_NOTICES[code];
  return n ? `<p class="${n[0]}">${esc(n[1])}</p>` : '';
};

// The tick beside an agent's name, or a small invitation to claim it.
export function claimTag({ ref, claim }) {
  const href = `/claim?ref=${encodeURIComponent(ref)}`;
  return claim
    ? `<a class="tag tag-claimed" href="${esc(href)}" title="${esc(`Claimed by ${displayName(claim)}, who proved they own it (${methodName(claim.method)}). Claiming doesn't change any grade.`)}">✓ Claimed by its maker</a>`
    : `<a class="tag tag-unclaimed" href="${esc(href)}" title="Built this agent? Prove it's yours and get a badge">Is this yours? Claim it</a>`;
}

const methodName = (m) => ({ github: 'GitHub sign-in', file: 'a file on its website', repo: 'a file in its code repo' }[m] ?? m);

function checkBlock({ check, canCheck, mine, ref }) {
  const result = check
    ? `<p class="check-result ${check.up ? 'ok' : 'bad'}"><b>${check.up ? 'Up' : 'Down'}</b>${check.up ? `, ${Number(check.tools)}${check.toolsMore ? '+' : ''} ${check.tools === 1 ? 'tool' : 'tools'}` : ''}${Number.isFinite(check.latency) ? `, replied in ${(check.latency / 1000).toFixed(1)}s` : ''}, checked ${esc(dateLabel(check.at))}</p>
       ${!check.up && check.note ? `<p class="muted small">${esc(check.note)}</p>` : ''}`
    : `<p class="muted">${canCheck ? 'Not checked yet.' : "This listing names no address we can check, so there's no basic check yet."}</p>`;
  return `<section class="card section"><h2>Free basic check</h2>
    <p>Does it answer, what tools does it list, and how fast does it reply. It says whether your agent is <b>alive</b>, never whether it's <b>good</b>, so it gives no score or grade. We run it every few days on our own.</p>
    ${result}
    ${mine && canCheck ? `<form method="post" action="/claim/check"><input type="hidden" name="ref" value="${esc(ref)}"><button type="submit" class="ghost">Check now</button></form>` : ''}
  </section>`;
}

// "Your badge": the maker picks a look and their own colour, sees it live and copies the code (public/badge.js).
function badgeBlock({ agent }) {
  const link = siteUrl(`${agent.path}?from=badge`);
  const ref = encodeURIComponent(agent.ref);
  const img = siteUrl(`/badge.svg?ref=${ref}&style=dark`);
  const md = `[![Agent Parrot](${img})](${link})`;
  const html = `<a href="${link}"><img src="${img}" alt="Agent Parrot"></a>`;
  const look = (value, name, checked) => `<label class="badge-opt"><input type="radio" name="badge-style" value="${value}"${checked ? ' checked' : ''}> ${name}</label>`;
  return `<section class="card section badge-tailor" data-base="${esc(siteUrl('/badge.svg'))}" data-ref="${esc(agent.ref)}" data-link="${esc(link)}"><h2>Your badge</h2>
    <p>Make it match your site: pick a look and your own brand colour, then paste the code once. The badge redraws itself after every check or test, so it's always current. If your agent goes down, it says so.</p>
    <div class="badge-controls">
      <fieldset><legend class="small muted">Look</legend>${look('dark', 'Dark card', true)}${look('light', 'Light card')}${look('flat', 'Classic README badge')}</fieldset>
      <p class="badge-colour"><label class="small muted" for="badge-accent">Your colour</label><input type="color" id="badge-accent" value="#12b76a"> <button type="button" class="ghost small" id="badge-accent-reset">Use Agent Parrot green</button></p>
    </div>
    <p class="badge-preview" id="badge-preview"><img id="badge-img" src="${esc(`/badge.svg?ref=${ref}&style=dark`)}" alt="Your Agent Parrot badge"></p>
    <p class="invite-link"><label class="small muted" for="badge-md">For a GitHub README</label><input id="badge-md" readonly value="${esc(md)}" onclick="this.select()"></p>
    <p class="invite-link"><label class="small muted" for="badge-html">For a website</label><input id="badge-html" readonly value="${esc(html)}" onclick="this.select()"></p>
    <p class="small muted">Your colour is used for a pass or a good grade. A down or low result always shows in amber or red, whatever colour you pick.</p>
  </section><script src="/badge.js" defer></script>`;
}

function nudgeBlock({ agent }) {
  const href = `/request?ref=${encodeURIComponent(agent.ref)}&from=claim`;
  return agent.tested
    ? `<section class="card cta-card section"><img src="/parrot.svg" width="56" height="56" alt="">
        <div><h2>Improved it since ${esc(dateLabel(agent.tested.gradedAt))}?</h2>
          <p>A retest is $5. Your page, your place in the Pecking Order and your badge update with the new grade.</p>
          <a class="btn" href="${esc(href)}">Get retested</a></div></section>`
    : `<section class="card cta-card section"><img src="/parrot.svg" width="56" height="56" alt="">
        <div><h2>Your spot in the Pecking Order is empty</h2>
          <p>The basic check says your agent is alive. Only a Polly Test says it's good: real tasks for its job, an honesty check and two independent judges. $10, and your badge then shows your grade.</p>
          <a class="btn" href="${esc(href)}">Get Polly Tested to take your place</a></div></section>`;
}

function proveBlock({ agent, member, joined, byGithub, token }) {
  const { logins, hosts, repos } = agent.targets;
  if (!member) {
    return `<section class="card section"><h2>Is this yours?</h2>
      <p>Sign in to claim it. It's free, and if your agent is in the MCP Registry under your GitHub name, signing in with GitHub is all it takes.</p>
      <p><a class="btn" href="/signin">Sign in to claim</a></p></section>`;
  }
  if (!joined) return `<section class="card section"><h2>Is this yours?</h2><p>Finish joining first, then come back to claim it.</p><p><a class="btn" href="/join">Finish joining</a></p></section>`;
  const ref = `<input type="hidden" name="ref" value="${esc(agent.ref)}">`;
  const github = logins.length
    ? `<div class="claim-way"><h3>With GitHub <span class="muted small">quickest</span></h3>
       ${byGithub
        ? `<p>You signed in as <b>${esc(member.github_login)}</b>, the account the registry checked for this listing.</p>
           <form method="post" action="/claim">${ref}<input type="hidden" name="method" value="github"><button type="submit">Claim it now</button></form>`
        : `<p>This listing belongs to the GitHub account <b>${esc(logins.join(', '))}</b>. ${member.github_login ? `You signed in as ${esc(member.github_login)}.` : "You didn't sign in with GitHub."} <a href="/auth/github">Sign in with GitHub</a> as that account to claim it in one click.</p>`}</div>`
    : '';
  const places = [
    ...hosts.map((h) => `<li><code>https://${esc(h)}/.well-known/agent-parrot.txt</code></li>`),
    ...repos.map((r) => `<li><code>agent-parrot.txt</code> at the top of <a href="${esc(r)}" target="_blank" rel="noopener nofollow">${esc(r.replace('https://github.com/', ''))}</a></li>`),
  ];
  const file = places.length
    ? `${logins.length ? '<p class="or-divider"><span>or</span></p>' : ''}<div class="claim-way"><h3>With a code</h3>
       <ol class="claim-steps">
         <li><span>Copy your code. It's only for you and this agent.</span>
           <p class="invite-link"><input readonly value="${esc(token)}" aria-label="Your claim code" onclick="this.select()"></p></li>
         <li><span>Put it in a public file in one of these places:</span><ul class="plain-list">${places.join('')}</ul></li>
         <li><span>Ask us to check.</span>
           <form method="post" action="/claim">${ref}<input type="hidden" name="method" value="code"><button type="submit">I've added it, check now</button></form>
           <p class="muted small">You can take the file down once your claim is through.</p></li>
       </ol></div>`
    : '';
  return `<section class="card section"><h2>Prove it's yours</h2>
    <p>We only accept proof from the places this agent's own listing names, so nobody has to take anyone's word for it.</p>
    ${github}${file}
    ${!github && !file ? '<p class="muted">This listing names no GitHub account, website or code repo we can check, so it can\'t be claimed yet. Wallet signatures for on-chain agents are coming later.</p>' : ''}
  </section>`;
}

export function claimPage({ agent, claim, member, joined, mine, byGithub, token, check, canCheck, notice, contactEmail }) {
  const other = claim && !mine;
  return layout(`Claim ${agent.name}`, `
    <section class="page-head">
      <p class="eyebrow">For builders · Claim your listing</p>
      <h1>${mine ? `You own ${esc(agent.name)}` : other ? `${esc(agent.name)} is claimed` : `Claim ${esc(agent.name)}`}</h1>
      <p class="lead">${mine || other ? claimTag({ ref: agent.ref, claim }) : 'Built this agent? Prove it and you get a "Claimed by its maker" tick, a free basic check and a badge for your README.'}</p>
      <p><a href="${esc(agent.path)}">Back to ${esc(agent.name)}</a></p>
    </section>
    ${noticeHtml(notice)}
    ${mine ? `${badgeBlock({ agent })}${checkBlock({ check, canCheck, mine, ref: agent.ref })}${nudgeBlock({ agent })}
      <section class="card section"><h2>Your claim</h2><p class="muted small">Claimed ${esc(dateLabel(claim.created_at))} with ${esc(methodName(claim.method))}.</p>
        <form method="post" action="/claim/release" onsubmit="return confirm('Give up your claim on this agent?')"><input type="hidden" name="ref" value="${esc(agent.ref)}"><button type="submit" class="ghost">Give up my claim</button></form></section>`
    : other ? `<section class="card section"><p>Someone proved they own this agent on ${esc(dateLabel(claim.created_at))}. Think that's wrong?${contactEmail ? ` Email <a href="mailto:${esc(contactEmail)}?subject=${encodeURIComponent(`Wrong claim: ${agent.ref}`)}">${esc(contactEmail)}</a> and Polly will look into it.` : ' Tell us and Polly will look into it.'}</p></section>
      ${checkBlock({ check, canCheck, mine: false, ref: agent.ref })}`
    : proveBlock({ agent, member, joined, byGithub, token })}
    `, { description: `Claim ${agent.name} on Agent Parrot: prove you built it and get a badge.` });
}

// The "found yours" box on a member's own page: their claims, and listings that look like theirs.
export function memberClaimsBlock({ mine, found }) {
  if (!mine.length && !found.length) return '';
  return `<section class="card">
    ${found.length ? `<h2>We found ${found.length === 1 ? 'an agent that looks' : `${Number(found.length)} agents that look`} like yours</h2>
      <p>The MCP Registry lists ${found.length === 1 ? 'it' : 'them'} under the GitHub account you signed in with. Claim ${found.length === 1 ? 'it' : 'them'} for a badge and a free basic check.</p>
      <ul class="plain-list">${found.map((r) => `<li><a href="/claim?ref=${esc(encodeURIComponent(`${r.source}:${r.source_id}`))}">Claim ${esc(r.name)}</a></li>`).join('')}</ul>` : ''}
    ${mine.length ? `<h2>Your agents</h2><ul class="plain-list">${mine.map((c) => `<li><a href="${esc(c.agent.path)}">${esc(c.agent.name)}</a> <span class="tag tag-claimed">✓ Claimed</span> <a class="small" href="/claim?ref=${esc(encodeURIComponent(c.agent_ref))}">Badge and check</a></li>`).join('')}</ul>` : ''}
  </section>`;
}

export function adminClaimsPage({ claims }) {
  const rows = claims.map((c) => `<tr><td><a href="/claim?ref=${esc(encodeURIComponent(c.agent_ref))}">${esc(c.agent_ref)}</a></td>
    <td>${esc(c.name)}<br><span class="muted small">${esc(c.email ?? '')}${c.github_login ? ` · GitHub ${esc(c.github_login)}` : ''}</span></td>
    <td>${esc(methodName(c.method))}<br><span class="muted small">${esc(c.proof)}</span></td><td>${esc(dateLabel(c.created_at))}</td>
    <td>${c.badge_seen_at ? esc(dateLabel(c.badge_seen_at)) : '<span class="muted">Not yet</span>'}</td>
    <td><form method="post" action="/admin/claims/remove" class="inline" onsubmit="return confirm('Remove this claim?')"><input type="hidden" name="ref" value="${esc(c.agent_ref)}"><button type="submit" class="danger">Remove</button></form></td></tr>`).join('');
  return layout('Claims', `<section class="card"><div class="card-head"><h1>Claimed listings</h1><a href="/admin">Back to admin</a></div>
    <p class="muted">Builders who proved they own an agent. Remove a claim if someone tells you it's wrong; the real owner can then claim it.</p>
    <p><b>${claims.length}</b> claimed · <b>${claims.filter((c) => c.badge_seen_at).length}</b> with a badge seen somewhere</p>
    <div class="table-scroll"><table><thead><tr><th>Agent</th><th>Claimed by</th><th>How</th><th>When</th><th>Badge last seen</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No claims yet.</td></tr>'}</tbody></table></div></section>`, { wide: true });
}

// The badge comes in three looks so it suits the page it sits on:
//   flat  - the small grey-and-colour badge GitHub READMEs are full of (the default)
//   dark  - a rounded card with Polly's head, for dark websites
//   light - the same card for light websites
// `accent` (six hex digits, no #) swaps Agent Parrot green for the site's own colour on the good states.
// Width is worked out from the text length, as SVG in an <img> can't measure text.
export const BADGE_STYLES = ['flat', 'dark', 'light'];
const COLOURS = { green: '#2f9e44', yellow: '#d4a017', red: '#d9480f', blue: '#1c7ed6', grey: '#868e96' };
const CARD_COLOURS = { green: '#12b76a', yellow: '#f5b400', red: '#f04438', blue: '#2e90fa', grey: '#98a2b3' };
const GRADE_FILL = { A: '#12b76a', B: '#66c61c', C: '#f5b400', D: '#f79009', F: '#f04438' };
const THEMES = {
  dark: { bg: '#0b1210', line: '#24352c', ink: '#e7efea', muted: '#9bada3' },
  light: { bg: '#ffffff', line: '#dfe7e2', ink: '#0e1a14', muted: '#56655d' },
};
const textWidth = (s) => [...s].reduce((w, ch) => w + (/[ilI.,:·|!']/.test(ch) ? 3.5 : /[mwMW]/.test(ch) ? 10 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.5), 0);
export function badgeStyle(q = {}) {
  const style = BADGE_STYLES.includes(q.style) ? q.style : 'flat';
  const accent = /^[0-9a-f]{6}$/i.test(String(q.accent ?? '')) ? `#${String(q.accent).toLowerCase()}` : null;
  return { style, accent };
}
export function badgeSvg({ label = 'Agent Parrot', message, colour = 'grey', grade, score, style = 'flat', accent = null }) {
  if (style === 'dark' || style === 'light') return badgeCard({ label, message, colour, grade, score, theme: THEMES[style], accent });
  const lw = Math.round(textWidth(label) + 30); // room for the parrot dot
  const mw = Math.round(textWidth(message) + 14);
  const w = lw + mw;
  const fill = (colour === 'green' && accent) || (COLOURS[colour] ?? COLOURS.grey);
  const title = `${label}: ${message}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#333"/><rect x="${lw}" width="${mw}" height="20" fill="${fill}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<circle cx="11" cy="10" r="5" fill="#2f9e44"/><circle cx="13" cy="8.5" r="1.3" fill="#ffd43b"/><path d="M15.5 9.5l2.5 1-2.5 1z" fill="#ffd43b"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${(lw + 18) / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>`;
}

// Polly's head (public/parrot.svg) drawn at 120x120, scaled down by the caller.
const POLLY = `<clipPath id="pd"><circle cx="60" cy="60" r="58"/></clipPath><circle cx="60" cy="60" r="58" fill="#0E3B2A"/>
<g clip-path="url(#pd)" transform="translate(-2 6)"><path d="M30 30 C26 18 30 10 38 6 C37 13 39 17 43 21 C44 12 50 7 57 8 C53 13 53 18 55 22 Z" fill="#12B76A"/>
<path d="M14 120 C4 90 10 50 34 30 C54 14 84 18 94 40 C99 52 96 64 88 70 C84 92 72 108 56 120 Z" fill="#12B76A"/>
<path d="M28 78 C38 72 52 76 56 88 C58 100 50 112 38 116 C30 106 26 92 28 78 Z" fill="#0A8F52"/>
<ellipse cx="72" cy="48" rx="16" ry="14" fill="#FFFFFF"/><circle cx="75" cy="47" r="8.5" fill="#0E1A14"/><circle cx="78" cy="44" r="3" fill="#FFFFFF"/>
<path d="M58 30 C66 24 76 24 84 29" stroke="#0E1A14" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M86 38 C104 32 118 46 115 66 C114 76 108 84 101 87 C103 76 99 68 86 66 Z" fill="#FFC531"/>
<path d="M86 66 C96 66 100 72 97 78 C92 81 87 78 84 72 Z" fill="#E0A100"/></g>`;

// The card look: Polly, a small "AGENT PARROT" line, the result underneath and, for a Polly Tested agent, the grade in a tile.
function badgeCard({ label, message, colour, grade, score, theme, accent }) {
  const H = 40;
  const tested = Boolean(grade);
  const main = tested ? `Polly Tested · Squawk ${Number(score)}` : message;
  const kicker = label.toUpperCase();
  const textX = 42;
  const textW = Math.max(textWidth(kicker) * 0.78 + kicker.length * 1.1, textWidth(main) * 1.06);
  const tile = tested ? 28 : 0;
  const w = Math.round(textX + textW + (tested ? 10 + tile : 0) + 12);
  const good = colour === 'green';
  const tone = (good && accent) || CARD_COLOURS[colour] || CARD_COLOURS.grey;
  const tileFill = (good && accent) || GRADE_FILL[grade] || CARD_COLOURS.grey;
  const title = `${label}: ${message}`;
  const font = `font-family="'Plus Jakarta Sans','Inter','Segoe UI',Helvetica,Arial,sans-serif"`;
  const dot = tested ? '' : `<circle cx="${textX + 3}" cy="25.5" r="3" fill="${tone}"/>`;
  const mainX = tested ? textX : textX + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tested ? w : w + 10}" height="${H}" viewBox="0 0 ${tested ? w : w + 10} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
<rect x=".5" y=".5" width="${(tested ? w : w + 10) - 1}" height="${H - 1}" rx="10" fill="${theme.bg}" stroke="${accent && good ? accent : theme.line}" stroke-opacity="${accent && good ? '.55' : '1'}"/>
<g transform="translate(8 8) scale(.2)">${POLLY}</g>
<g ${font}>
<text x="${textX}" y="16" font-size="8.5" font-weight="700" letter-spacing="1.1" fill="${(good && accent) || theme.muted}">${esc(kicker)}</text>
${dot}<text x="${mainX}" y="30" font-size="12" font-weight="700" fill="${theme.ink}">${esc(main)}</text>
${tested ? `<rect x="${w - 12 - tile}" y="6" width="${tile}" height="${tile}" rx="7" fill="${tileFill}"/><text x="${w - 12 - tile / 2}" y="25.5" text-anchor="middle" font-size="16" font-weight="800" fill="#06110c">${esc(grade)}</text>` : ''}
</g></svg>`;
}
