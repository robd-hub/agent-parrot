// Sends the "sign in by email" links. Works with Brevo (free, no website domain needed: you verify
// one sender address) or Resend (needs a domain you own). Returns null when neither is set up,
// and the email sign-in option is hidden.

export function emailSender({ brevoKey, resendKey, from, log = false }) {
  const sender = parseFrom(from);
  if (brevoKey && sender) return (msg) => sendBrevo(brevoKey, sender, msg);
  if (resendKey && sender) return (msg) => sendResend(resendKey, from, msg);
  // Local testing: print the email instead of sending it.
  if (log) return async ({ to, subject, text }) => console.log(`\n--- Email to ${to}: ${subject}\n${text}\n---\n`);
  return null;
}

// "Bullwhip <rob@example.com>" or just "rob@example.com".
export function parseFrom(from = '') {
  const m = String(from).trim().match(/^(?:"?([^"<]*?)"?\s*<([^>]+)>|([^\s<>]+@[^\s<>]+))$/);
  if (!m) return null;
  return { name: (m[1] || '').trim() || undefined, email: (m[2] || m[3]).trim() };
}

async function sendBrevo(apiKey, sender, { to, subject, text, html, headers }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html, ...(headers && { headers }) }),
  });
  if (!res.ok) throw new Error(`Brevo could not send the email (${res.status}): ${await res.text()}`);
}

async function sendResend(apiKey, from, { to, subject, text, html, headers }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html, ...(headers && { headers }) }),
  });
  if (!res.ok) throw new Error(`Resend could not send the email (${res.status}): ${await res.text()}`);
}
