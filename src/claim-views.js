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

function badgeBlock({ agent }) {
  const img = siteUrl(`/badge.svg?ref=${encodeURIComponent(agent.ref)}`);
  const link = siteUrl(`${agent.path}?from=badge`);
  const md = `[![Agent Parrot](${img})](${link})`;
  const html = `<a href="${link}"><img src="${img}" alt="Agent Parrot"></a>`;
  return `<section class="card section"><h2>Your badge</h2>
    <p>Paste one of these once. The badge redraws itself after every check or test, so it's always current. If your agent goes down, it says so.</p>
    <p><img src="${esc(`/badge.svg?ref=${encodeURIComponent(agent.ref)}`)}" alt="Your Agent Parrot badge" height="20"></p>
    <p class="invite-link"><label class="small muted" for="badge-md">For a GitHub README</label><input id="badge-md" readonly value="${esc(md)}" onclick="this.select()"></p>
    <p class="invite-link"><label class="small muted" for="badge-html">For a website</label><input id="badge-html" readonly value="${esc(html)}" onclick="this.select()"></p>
  </section>`;
}

function nudgeBlock({ agent }) {
  const testWith = agent.row?.endpoint || agent.row?.url || agent.tested?.url || agent.name;
  const href = `/get-polly-tested?agent=${encodeURIComponent(testWith)}&from=claim`;
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
    ? `<h3>With GitHub</h3>
       ${byGithub
        ? `<p>You signed in as <b>${esc(member.github_login)}</b>, the account the registry checked for this listing.</p>
           <form method="post" action="/claim">${ref}<input type="hidden" name="method" value="github"><button type="submit">Claim it now</button></form>`
        : `<p>This listing belongs to the GitHub account <b>${esc(logins.join(', '))}</b>. ${member.github_login ? `You signed in as ${esc(member.github_login)}.` : "You didn't sign in with GitHub."} <a href="/auth/github">Sign in with GitHub</a> as that account to claim it in one click.</p>`}`
    : '';
  const places = [
    ...hosts.map((h) => `<li><code>https://${esc(h)}/.well-known/agent-parrot.txt</code></li>`),
    ...repos.map((r) => `<li><code>agent-parrot.txt</code> at the top of <a href="${esc(r)}" target="_blank" rel="noopener nofollow">${esc(r.replace('https://github.com/', ''))}</a></li>`),
  ];
  const file = places.length
    ? `<h3>${logins.length ? 'Or with' : 'With'} a code</h3>
       <p>Put this line in a public file in one of these places. It's only for you and this agent.</p>
       <p class="invite-link"><input readonly value="${esc(token)}" aria-label="Your claim code" onclick="this.select()"></p>
       <ul class="plain-list">${places.join('')}</ul>
       <form method="post" action="/claim">${ref}<input type="hidden" name="method" value="code"><button type="submit">I've added it, check now</button></form>
       <p class="muted small">You can take the file down once your claim is through.</p>`
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

// A small flat badge, like the ones on GitHub READMEs. Width is worked out from the text length.
const COLOURS = { green: '#2f9e44', yellow: '#d4a017', red: '#d9480f', blue: '#1c7ed6', grey: '#868e96' };
const textWidth = (s) => [...s].reduce((w, ch) => w + (/[ilI.,:·|!']/.test(ch) ? 3.5 : /[mwMW]/.test(ch) ? 10 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.5), 0);
export function badgeSvg({ label = 'Agent Parrot', message, colour = 'grey' }) {
  const lw = Math.round(textWidth(label) + 30); // room for the parrot dot
  const mw = Math.round(textWidth(message) + 14);
  const w = lw + mw;
  const fill = COLOURS[colour] ?? COLOURS.grey;
  const title = `${label}: ${message}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#333"/><rect x="${lw}" width="${mw}" height="20" fill="${fill}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<circle cx="11" cy="10" r="5" fill="#2f9e44"/><circle cx="13" cy="8.5" r="1.3" fill="#ffd43b"/><path d="M15.5 9.5l2.5 1-2.5 1z" fill="#ffd43b"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${(lw + 18) / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>`;
}
