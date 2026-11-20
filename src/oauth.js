// Sign in with Google and GitHub. Both are standard OAuth: send the visitor to the provider, get a code back,
// swap it for a token, then read the person's name, email and photo. LinkedIn lives in linkedin.js.
// Each provider returns a profile in the same shape: { id, name, given_name, family_name, email, email_verified, picture }.

export const PROVIDERS = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    label: 'GitHub',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
};

export function authorizeUrl(provider, { clientId, redirectUri, state }) {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: p.scope });
  if (provider === 'google') {
    params.set('response_type', 'code');
    params.set('prompt', 'select_account');
  }
  if (provider === 'github') params.set('allow_signup', 'true');
  return `${p.authorize}?${params}`;
}

async function exchange(provider, { code, clientId, clientSecret, redirectUri }) {
  const res = await fetch(PROVIDERS[provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`${PROVIDERS[provider].label} token exchange failed (${res.status}): ${data.error || ''}`);
  return data.access_token;
}

const getJson = async (url, token, extra = {}) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'AgentParrot', ...extra }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

export async function fetchProfile(provider, opts) {
  const token = await exchange(provider, opts);
  if (provider === 'google') {
    const u = await getJson('https://openidconnect.googleapis.com/v1/userinfo', token);
    return { id: `google:${u.sub}`, name: u.name, given_name: u.given_name, family_name: u.family_name, email: u.email, email_verified: Boolean(u.email_verified), picture: u.picture };
  }
  // GitHub: the public profile may hide the email, so ask for the verified primary address separately.
  const u = await getJson('https://api.github.com/user', token);
  let email = null;
  try {
    const emails = await getJson('https://api.github.com/user/emails', token);
    email = emails.find((e) => e.primary && e.verified)?.email ?? null;
  } catch {}
  const name = u.name || u.login;
  const [given, ...rest] = String(name).split(/\s+/);
  return { id: `github:${u.id}`, name, given_name: given, family_name: rest.join(' ') || null, email, email_verified: Boolean(email), picture: u.avatar_url, github_login: u.login };
}
