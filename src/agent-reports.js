// "Report an agent": signed-in members tell Polly an agent looks like a scam, is broken, is misleading or asks for
// unsafe permissions. One open report per member per agent, with rate limits. The organiser checks each report at
// /admin/reports and confirms or dismisses it. Only confirmed reports show on the agent's page, as a community flag in
// its Security section that says plainly it comes from members, not from a Polly test. Agents are never hidden.
// An agent is named by the same ref reviews and /compare use: a tested id ("coder") or a listed "source:id".
import express from 'express';
import { pageNotFound, dateLabel } from './views.js';
import { resolveAgent } from './reviews.js';
import { adminReportsPage, REASONS, NOTE_MAX, PUBLIC_NOTE_MAX, LIMITS } from './agent-report-views.js';

export { REASONS, NOTE_MAX, PUBLIC_NOTE_MAX, LIMITS };

// Tidy and check a report. Returns { reason, note } or { error }.
export function cleanReport(input = {}) {
  const reason = String(input.reason ?? '');
  if (!Object.hasOwn(REASONS, reason)) return { error: 'reason' };
  const note = String(input.note ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (note.length > NOTE_MAX) return { error: 'long' };
  if (reason === 'other' && note.length < 10) return { error: 'note' };
  if ((note.match(/https?:\/\/|www\./gi) ?? []).length > 3) return { error: 'links' };
  return { reason, note };
}

export const cleanPublicNote = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, PUBLIC_NOTE_MAX);

const plural = (n, one, many) => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? one : many}`;

// The community flags for an agent's Security section, from db.agentReports.summaries: one per confirmed reason, and a
// softer note when several members have open reports that Polly hasn't checked yet.
export function communityFlags(summary) {
  if (!summary) return [];
  const flags = summary.confirmed
    .map((c) => ({ ...c, def: REASONS[c.reason] ?? REASONS.other }))
    .sort((a, b) => (a.def.level === 'bad' ? 0 : 1) - (b.def.level === 'bad' ? 0 : 1))
    .map((c) => ({
      level: c.def.level,
      community: true,
      text: `Community report: ${plural(c.members, 'member', 'members')} reported it as ${c.def.flag}, and Polly checked and agreed${c.last_at ? ` (${dateLabel(c.last_at)})` : ''}.${c.public_note ? ` ${c.public_note}` : ''} This comes from members, not from a Polly test.`,
    }));
  if (summary.open >= LIMITS.pendingAt) {
    flags.push({ level: 'info', community: true, text: `${plural(summary.open, 'member has', 'members have')} reported a problem that Polly is still checking. Not confirmed yet.` });
  }
  return flags;
}

// The short tag for a /listed card, only for confirmed reports.
export function communityTag(summary) {
  const c = summary?.confirmed ?? [];
  if (!c.length) return null;
  const worst = c.find((x) => REASONS[x.reason]?.level === 'bad') ?? c[0];
  return { level: REASONS[worst.reason]?.level ?? 'warn', text: worst.reason === 'scam' ? 'Reported: scam' : worst.reason === 'permissions' ? 'Reported: unsafe' : 'Reported by members' };
}

// Everything an agent page needs for the report button and the community flags.
export async function reportSection(db, { agent, member, notice }) {
  const [summaries, mine] = await Promise.all([
    db.agentReports.summaries([agent.ref]),
    member?.consent_at ? db.agentReports.mine(agent.ref, member.id) : null,
  ]);
  return { ref: agent.ref, flags: communityFlags(summaries[agent.ref]), mine, signedIn: Boolean(member), joined: Boolean(member?.consent_at), notice };
}

export function agentReportRoutes({ db, adminOnly }) {
  const app = express.Router();
  const back = (res, path, code) => res.redirect(303, `${path}?report=${code}#security`);

  app.post('/agent-reports', async (req, res) => {
    const member = (req.session.uid && (await db.get(req.session.uid))) || null;
    if (!member) return res.redirect(303, '/signin');
    if (!member.consent_at) return res.redirect(303, '/join');
    const agent = await resolveAgent(db, req.body?.ref);
    if (!agent) return res.status(404).send(pageNotFound());
    const r = cleanReport(req.body ?? {});
    if (r.error) return back(res, agent.path, r.error);
    if (await db.agentReports.mine(agent.ref, member.id)) return back(res, agent.path, 'already');
    if ((await db.reviews.recentActions(member.id, 'agent-report', 86400)) >= LIMITS.perDay) return back(res, agent.path, 'slow');
    if ((await db.reviews.recentActions(null, 'agent-report', 3600)) >= LIMITS.sitePerHour) return back(res, agent.path, 'busy');
    const id = await db.agentReports.add(agent.ref, member.id, r.reason, r.note);
    back(res, agent.path, id ? 'sent' : 'already');
  });

  // ----- Organiser -----
  app.get('/admin/reports', adminOnly, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.send(adminReportsPage({ reports: await db.agentReports.forAdmin(), notice: req.query.done === 'clash' ? 'clash' : null }));
  });

  app.post('/admin/reports/:id/:action', adminOnly, async (req, res, next) => {
    const id = /^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null;
    const status = { confirm: 'confirmed', dismiss: 'dismissed', reopen: 'open' }[req.params.action];
    if (!id || !status) return next();
    if (!(await db.agentReports.get(id))) return res.status(404).send(pageNotFound());
    const ok = await db.agentReports.setStatus(id, status, cleanPublicNote(req.body?.public_note));
    res.redirect(303, ok ? '/admin/reports' : '/admin/reports?done=clash');
  });

  return app;
}
