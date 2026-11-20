import { createHmac, timingSafeEqual } from 'node:crypto';

// Small signed-cookie session: the cookie holds JSON plus an HMAC so it can't be forged.
const COOKIE = 'ap_session';
// Members stay signed in for 90 days, and each visit pushes that back (at most once a day).
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function readSession(req, secret) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return {};
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return {};
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return {};
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && data.exp < Date.now()) return {};
    return data;
  } catch {
    return {};
  }
}

export function writeSession(res, data, secret, secure, maxAgeSeconds = MAX_AGE_SECONDS) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + maxAgeSeconds * 1000 })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload, secret)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: maxAgeSeconds * 1000,
    path: '/',
  });
}

// Re-issue a signed-in member's cookie once it is a day old, so regular visitors never get logged out.
export function renewSession(req, res, secret, secure) {
  const { uid, exp } = req.session;
  if (uid && exp && exp - Date.now() < MAX_AGE_SECONDS * 1000 - RENEW_AFTER_MS) {
    writeSession(res, { uid }, secret, secure);
  }
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
