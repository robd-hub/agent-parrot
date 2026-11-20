// Sign In with LinkedIn using OpenID Connect.
// Docs: https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
export const SCOPES = 'openid profile email';

export function authorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function fetchProfile({ code, clientId, clientSecret, redirectUri }) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) throw new Error(`LinkedIn token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json();

  const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new Error(`LinkedIn userinfo failed (${infoRes.status}): ${await infoRes.text()}`);
  // { sub, name, given_name, family_name, picture, email, email_verified, locale }
  return infoRes.json();
}
