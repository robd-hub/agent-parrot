// The Squawk: the weekly email. The organiser starts a draft at /admin/squawk, which pulls in the week's best Daily
// Hallucination stories, the top of the Pecking Order and the newest articles. They add an intro and an optional
// sponsor, send a test to themselves, then send it to members who ticked "Email me The Squawk".
// Sent issues are kept at /squawk. Ported from Bullwhip's Manifest.
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { esc, layout, BRAND, SLOGAN, paras, dateLabel, messagePage } from './views.js';
import { peckingOrder } from './agents.js';
import { ARTICLES } from './articles.js';

const SEND_BUDGET_MS = 8000; // stay inside the hosting time limit; press Send again to carry on
const SEND_BATCH = 200;
const firstParagraph = (text = '') => String(text).split(/\n{2,}/)[0].trim();
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);

export async function composeContent(db) {
  const byDay = new Map();
  for (const s of await db.stories.recent(8)) if (!s.hidden && !byDay.has(s.day)) byDay.set(s.day, s);
  const stories = [...byDay.values()].slice(0, 5).map((s) => ({ id: s.id, headline: s.headline, body: firstParagraph(s.body) }));
  const top = peckingOrder().slice(0, 5).map((a) => ({ id: a.id, name: a.name, grade: a.grade, score: a.score, place: a.place }));
  const articles = ARTICLES.slice(0, 3).map((x) => ({ slug: x.slug, title: x.title, dek: x.dek }));
  return { stories, top, articles };
}

const content = (issue) => {
  try {
    const c = JSON.parse(issue.content || '{}');
    return { stories: c.stories ?? [], top: c.top ?? [], articles: c.articles ?? [] };
  } catch {
    return { stories: [], top: [], articles: [] };
  }
};

export const defaultSubject = (date = new Date()) =>
  `The Squawk: ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;

export function unsubscribeToken(secret, memberId) {
  return createHmac('sha256', secret).update(`squawk-unsub:${memberId}`).digest('base64url').slice(0, 32);
}
const validToken = (secret, memberId, token = '') => {
  const a = Buffer.from(unsubscribeToken(secret, memberId));
  const b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
};

// ----- The email (inline styles, because email apps ignore stylesheets) -----

const INK = '#0e1a14';
const GREEN = '#12b76a';

export function squawkEmail({ issue, to, name, unsubscribe, webUrl }) {
  const { stories, top, articles } = content(issue);
  const site = new URL(webUrl).origin;
  const sponsorUrl = safeUrl(issue.sponsor_url);
  const hello = name ? `Squawk, ${name}.` : 'Squawk.';
  const h2 = (t) => `<h2 style="font:bold 20px Arial,sans-serif;margin:32px 0 8px;border-bottom:3px solid ${GREEN};padding-bottom:4px">${t}</h2>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:${INK};max-width:560px;margin:0 auto;padding:16px">
  <p style="font:bold 22px Arial,sans-serif;margin:0"><img src="${esc(site)}/apple-touch-icon.png" width="32" height="32" alt="" style="vertical-align:middle"> Agent<span style="color:${GREEN}">Parrot</span> <span style="font-size:13px;letter-spacing:2px;color:#5b6b63">THE SQUAWK</span></p>
  <p style="margin:20px 0 4px">${esc(hello)}</p>
  ${paras(issue.intro).map((p) => `<p style="margin:8px 0">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
  ${top.length ? h2('The Pecking Order this week') + `<table style="border-collapse:collapse;width:100%">${top.map((a) => `<tr>
      <td style="padding:6px 8px 6px 0;color:#5b6b63">${Number(a.place)}</td>
      <td style="padding:6px 0"><a href="${esc(`${site}/agents/${a.id}`)}" style="color:${INK};font-weight:bold">${esc(a.name)}</a></td>
      <td style="padding:6px 0;text-align:right">${esc(a.grade)} · ${Number(a.score)}</td></tr>`).join('')}</table>` : ''}
  ${stories.length ? h2('The week in The Daily Hallucination') + stories.map((s) => `<div style="margin:16px 0">
      <p style="margin:0;font-weight:bold;font-size:17px"><a href="${esc(`${site}/news/${s.id}`)}" style="color:${INK}">${esc(s.headline)}</a></p>
      <p style="margin:4px 0">${esc(s.body)}</p></div>`).join('') : ''}
  ${articles.length ? h2('From the perch') + articles.map((x) => `<p style="margin:10px 0"><a href="${esc(`${site}/articles/${x.slug}`)}" style="color:${INK};font-weight:bold">${esc(x.title)}</a><br>
      <span style="color:#5b6b63;font-size:14px">${esc(x.dek)}</span></p>`).join('') : ''}
  <p style="margin:24px 0"><a href="${esc(site)}/game" style="background:${GREEN};color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:bold">Play today's Spot the Hallucination</a></p>
  ${issue.sponsor_name ? `<div style="margin:32px 0 8px;border:2px solid ${INK};border-radius:12px;padding:12px 16px">
      <p style="margin:0 0 4px;font:bold 11px Arial,sans-serif;letter-spacing:2px;color:#5b6b63">SPONSORED BY ${esc(issue.sponsor_name.toUpperCase())}</p>
      <p style="margin:0">${esc(issue.sponsor_text ?? '')}${sponsorUrl ? ` <a href="${esc(sponsorUrl)}" style="color:${INK};font-weight:bold">Find out more</a>` : ''}</p></div>` : ''}
  <p style="margin:28px 0 0;font-weight:bold">${esc(SLOGAN)}.</p>
  <p style="color:#5b6b63;font-size:12px;margin:12px 0 0">You're getting this because you ticked "Email me The Squawk" on ${BRAND}.
    <a href="${esc(webUrl)}" style="color:#5b6b63">Read it on the web</a> · <a href="${esc(unsubscribe)}" style="color:#5b6b63">Unsubscribe</a></p>
</div>`;
  const text = [
    `${BRAND.toUpperCase()}: THE SQUAWK`, '', hello, '',
    ...paras(issue.intro).flatMap((p) => [p, '']),
    ...(top.length ? ['THE PECKING ORDER THIS WEEK', ...top.map((a) => `${a.place}. ${a.name}: ${a.grade} (${a.score})`), ''] : []),
    ...(stories.length ? ['THE WEEK IN THE DAILY HALLUCINATION', '', ...stories.flatMap((s) => [s.headline, s.body, `${site}/news/${s.id}`, ''])] : []),
    ...(articles.length ? ['FROM THE PERCH', '', ...articles.flatMap((x) => [x.title, `${site}/articles/${x.slug}`, ''])] : []),
    `Play today's Spot the Hallucination: ${site}/game`, '',
    ...(issue.sponsor_name ? [`SPONSORED BY ${issue.sponsor_name.toUpperCase()}`, `${issue.sponsor_text ?? ''} ${sponsorUrl ?? ''}`.trim(), ''] : []),
    `${SLOGAN}.`, '',
    `You're getting this because you ticked "Email me The Squawk" on ${BRAND}.`,
    `Read it on the web: ${webUrl}`, `Unsubscribe: ${unsubscribe}`,
  ].join('\n');
  return { to, subject: issue.subject, text, html, headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

// ----- Pages -----

function archivePage({ issues, member }) {
  const list = issues.map((i) => `<li><a href="/squawk/${Number(i.id)}">${esc(i.subject)}</a> <span class="muted small">${esc(dateLabel(i.sent_at))}</span></li>`).join('');
  return layout('The Squawk', `
    <section class="card">
      <p class="eyebrow">The weekly email</p>
      <h1>The Squawk</h1>
      <p class="muted">The week's best Hallucinations, the Pecking Order and new grades, once a week. Every issue is kept here.
        ${member?.consent_at ? 'Switch it on from <a href="/me">your perch</a>.' : '<a href="/signin">Join</a> (free) to get it in your inbox.'}</p>
      ${list ? `<ul class="issue-list">${list}</ul>` : '<p>The first issue is on its way.</p>'}
    </section>`, { description: 'The Squawk, the weekly Agent Parrot email: the best satire, new grades and the Pecking Order.' });
}

function issuePage({ issue, baseUrl }) {
  return layout(issue.subject, `<section class="card"><p class="eyebrow">The Squawk · ${esc(dateLabel(issue.sent_at))}</p>
    <div class="email-preview">${squawkEmail({ issue, to: '', name: '', unsubscribe: `${baseUrl}/me`, webUrl: `${baseUrl}/squawk/${issue.id}` }).html}</div>
    <p><a href="/squawk">All issues</a></p></section>`);
}

function unsubscribePage({ action }) {
  return layout('Unsubscribe', `<section class="card narrow"><h1>Unsubscribe from The Squawk?</h1>
    <p>You'll stop getting the weekly email. You'll stay a member and keep everything else.</p>
    <form method="post" action="${esc(action)}"><button type="submit">Yes, unsubscribe me</button></form></section>`);
}

function adminPage({ issues, issue, optins, sent, canEmail, adminEmail, notice, error, baseUrl }) {
  const v = (k) => esc(issue?.[k]);
  const off = issue?.sent_at ? 'disabled' : '';
  const rows = issues.map((i) => `<tr><td><a href="/admin/squawk/${Number(i.id)}">${esc(i.subject)}</a></td><td>${i.sent_at ? `Sent ${esc(dateLabel(i.sent_at))}` : 'Draft'}</td></tr>`).join('');
  const editor = issue ? `
    <h2>${issue.sent_at ? 'Sent issue' : 'Draft'}: ${esc(issue.subject)}</h2>
    ${issue.sent_at ? `<p class="muted">This issue has gone out. So far ${Number(sent)} of ${Number(optins)} opted-in members have it.</p>` : ''}
    <form method="post" action="/admin/squawk/${Number(issue.id)}" class="stack">
      <label>Subject line<input name="subject" maxlength="150" value="${v('subject')}" ${off}></label>
      <label>Your intro (a few lines in your own voice; a blank line starts a new paragraph)<textarea name="intro" rows="6" maxlength="3000" ${off}>${v('intro')}</textarea></label>
      <h3>Sponsor slot (optional)</h3>
      <div class="grid2"><label>Sponsor name<input name="sponsor_name" maxlength="100" value="${v('sponsor_name')}" ${off}></label>
        <label>Link<input name="sponsor_url" type="url" maxlength="500" value="${v('sponsor_url')}" placeholder="https://" ${off}></label></div>
      <label>A line or two about them<input name="sponsor_text" maxlength="400" value="${v('sponsor_text')}" ${off}></label>
      ${issue.sent_at ? '' : '<button type="submit">Save</button>'}
    </form>
    ${issue.sent_at ? '' : `<form method="post" action="/admin/squawk/${Number(issue.id)}/refresh" class="inline"><button type="submit" class="ghost">Refresh stories and grades</button></form>
    <form method="post" action="/admin/squawk/${Number(issue.id)}/delete" class="inline"><button type="submit" class="danger">Delete this draft</button></form>`}
    <h3>Preview</h3>
    <div class="email-preview">${squawkEmail({ issue, to: '', name: 'Rob', unsubscribe: '#', webUrl: `${baseUrl}/squawk/${issue.id}` }).html}</div>
    <h3>Send</h3>
    ${canEmail ? `<form method="post" action="/admin/squawk/${Number(issue.id)}/test" class="inline"><button type="submit" class="ghost">Send a test to ${esc(adminEmail || 'the admin email')}</button></form>
    <form method="post" action="/admin/squawk/${Number(issue.id)}/send" class="stack">
      <label class="check"><input type="checkbox" name="confirm" value="yes" required>
        <span>Send it to the ${Number(optins)} member${optins === 1 ? '' : 's'} who opted in${issue.sent_at ? ' (anyone who hasn\'t had it yet)' : ''}. This can't be undone.</span></label>
      <button type="submit">${issue.sent_at ? 'Send to the rest' : 'Send The Squawk'}</button>
    </form>` : '<p class="error">Email is not set up (no Brevo or Resend key), so nothing can be sent.</p>'}` : '';
  return layout('The Squawk (admin)', `<section class="card">
    <div class="card-head"><h1>The Squawk</h1><a href="/admin">Back to admin</a></div>
    <p class="muted">${Number(optins)} member${optins === 1 ? '' : 's'} opted in.</p>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}${error ? `<p class="error">${esc(error)}</p>` : ''}
    <form method="post" action="/admin/squawk" class="inline"><button type="submit">Start this week's Squawk</button></form>
    <div class="table-scroll"><table><thead><tr><th>Issue</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" class="muted">None yet.</td></tr>'}</tbody></table></div>
    ${editor}
  </section>`, { wide: true });
}

// ----- Routes -----

export function squawkRoutes({ db, config, adminOnly, sendEmail = null, now = () => new Date() }) {
  const app = express.Router();
  const unsubUrl = (id) => `${config.baseUrl}/squawk/unsubscribe?m=${encodeURIComponent(id)}&t=${unsubscribeToken(config.sessionSecret, id)}`;
  const issueUrl = (issue) => `${config.baseUrl}/squawk/${issue.id}`;
  const memberOf = async (req) => (req.session.uid && (await db.get(req.session.uid))) || null;

  app.get('/squawk', async (req, res) => res.send(archivePage({ issues: await db.squawk.sent(), member: await memberOf(req) })));

  app.get('/squawk/unsubscribe', (req, res) => {
    const { m, t } = req.query;
    if (typeof m !== 'string' || !validToken(config.sessionSecret, m, t)) {
      return res.status(400).send(messagePage({ title: 'That link did not work', text: 'The unsubscribe link looks incomplete. Sign in and switch it off on your perch instead.' }));
    }
    res.send(unsubscribePage({ action: `/squawk/unsubscribe?m=${encodeURIComponent(m)}&t=${encodeURIComponent(t)}` }));
  });

  // Mail apps' one-click unsubscribe posts here too, with no origin header.
  app.post('/squawk/unsubscribe', async (req, res) => {
    const { m, t } = req.query;
    if (typeof m !== 'string' || !validToken(config.sessionSecret, m, t)) return res.status(400).send('Bad link');
    await db.setSquawk(m, false);
    res.send(messagePage({ title: "You're unsubscribed", text: "You won't get The Squawk any more. You can switch it back on from your perch." }));
  });

  app.post('/squawk/subscription', async (req, res) => {
    const member = await memberOf(req);
    if (!member?.consent_at) return res.redirect(303, '/');
    await db.setSquawk(member.id, req.body?.squawk === 'yes' && Boolean(member.email));
    res.redirect(303, '/me');
  });

  app.get('/squawk/:id', async (req, res) => {
    const issue = /^\d+$/.test(req.params.id) ? await db.squawk.get(Number(req.params.id)) : null;
    if (!issue?.sent_at) return res.status(404).send(messagePage({ title: 'Not found', text: "We couldn't find that issue." }));
    res.send(issuePage({ issue, baseUrl: config.baseUrl }));
  });

  // ----- Organiser -----
  const page = async (res, id, { notice, error, status = 200 } = {}) => {
    const issue = id ? await db.squawk.get(id) : null;
    if (id && !issue) return res.redirect(303, '/admin/squawk');
    res.status(status).send(adminPage({
      issues: await db.squawk.list(), issue, optins: await db.squawk.optinCount(), sent: issue ? await db.squawk.sentCount(issue.id) : 0,
      canEmail: Boolean(sendEmail), adminEmail: config.adminEmail, notice, error, baseUrl: config.baseUrl,
    }));
  };
  const editable = async (req, res) => {
    const issue = await db.squawk.get(Number(req.params.id) || 0);
    if (!issue) res.redirect(303, '/admin/squawk');
    return issue;
  };

  app.get('/admin/squawk', adminOnly, (req, res) => page(res, null));
  app.get('/admin/squawk/:id', adminOnly, (req, res) => page(res, Number(req.params.id) || 0, { notice: String(req.query.msg ?? '').slice(0, 300) }));

  app.post('/admin/squawk', adminOnly, async (req, res) => {
    const id = await db.squawk.create({ subject: defaultSubject(now()), content: await composeContent(db) });
    res.redirect(303, `/admin/squawk/${id}`);
  });

  app.post('/admin/squawk/:id', adminOnly, async (req, res) => {
    const issue = await editable(req, res);
    if (!issue) return;
    const clean = (k, max) => String(req.body?.[k] ?? '').trim().slice(0, max);
    const edit = {
      subject: clean('subject', 150) || defaultSubject(now()), intro: clean('intro', 3000),
      sponsor_name: clean('sponsor_name', 100), sponsor_text: clean('sponsor_text', 400), sponsor_url: clean('sponsor_url', 500),
    };
    if (edit.sponsor_url && !safeUrl(edit.sponsor_url)) return page(res, issue.id, { error: 'The sponsor link should start with https://', status: 400 });
    if (issue.sent_at) return res.redirect(303, `/admin/squawk/${issue.id}?msg=${encodeURIComponent('That issue has already gone out, so it cannot be edited.')}`);
    await db.squawk.update(issue.id, edit);
    res.redirect(303, `/admin/squawk/${issue.id}?msg=${encodeURIComponent('Saved.')}`);
  });

  app.post('/admin/squawk/:id/refresh', adminOnly, async (req, res) => {
    const issue = await editable(req, res);
    if (!issue) return;
    if (!issue.sent_at) await db.squawk.setContent(issue.id, await composeContent(db));
    res.redirect(303, `/admin/squawk/${issue.id}?msg=${encodeURIComponent('Refreshed.')}`);
  });

  app.post('/admin/squawk/:id/delete', adminOnly, async (req, res) => {
    const issue = await editable(req, res);
    if (!issue) return;
    await db.squawk.delete(issue.id);
    res.redirect(303, '/admin/squawk');
  });

  const emailFor = (issue, member) =>
    squawkEmail({ issue, to: member.email, name: member.first_name, unsubscribe: unsubUrl(member.id), webUrl: issueUrl(issue) });

  app.post('/admin/squawk/:id/test', adminOnly, async (req, res) => {
    const issue = await editable(req, res);
    if (!issue) return;
    if (!sendEmail || !config.adminEmail) return page(res, issue.id, { error: 'Email or ADMIN_EMAIL is not set up, so nothing can be sent.', status: 400 });
    try {
      const msg = emailFor(issue, { email: config.adminEmail, first_name: 'Rob', id: 'test' });
      await sendEmail({ ...msg, subject: `[TEST] ${msg.subject}` });
    } catch (err) {
      console.error('Squawk test failed:', err);
      return page(res, issue.id, { error: `The test email did not send: ${err.message}`, status: 502 });
    }
    res.redirect(303, `/admin/squawk/${issue.id}?msg=${encodeURIComponent(`Test sent to ${config.adminEmail}.`)}`);
  });

  // Sends to everyone who hasn't had this issue yet, until the time budget runs out. Press again to carry on.
  app.post('/admin/squawk/:id/send', adminOnly, async (req, res) => {
    const issue = await editable(req, res);
    if (!issue) return;
    if (!sendEmail) return page(res, issue.id, { error: 'Email is not set up, so nothing can be sent.', status: 400 });
    if (req.body?.confirm !== 'yes') return page(res, issue.id, { error: 'Please tick the box to confirm you want to send.', status: 400 });
    await db.squawk.markStarted(issue.id);
    const started = Date.now();
    let sent = 0;
    let failure = null;
    outer: for (;;) {
      const batch = await db.squawk.toSend(issue.id, SEND_BATCH);
      if (!batch.length) break;
      for (const member of batch) {
        if (Date.now() - started > SEND_BUDGET_MS) break outer;
        try {
          await sendEmail(emailFor(issue, member));
        } catch (err) {
          console.error('Squawk send failed:', err);
          failure = err.message;
          break outer;
        }
        await db.squawk.recordSend(issue.id, member.id);
        sent++;
      }
    }
    const left = (await db.squawk.toSend(issue.id, 1)).length;
    const msg = failure ? `Stopped after ${sent} because sending failed: ${failure}. Press Send again to retry the rest.`
      : left ? `Sent ${sent} so far. There are more to go: press Send again.`
        : `Sent to ${sent} member${sent === 1 ? '' : 's'}. That's everyone who opted in.`;
    res.redirect(303, `/admin/squawk/${issue.id}?msg=${encodeURIComponent(msg)}`);
  });

  return app;
}
