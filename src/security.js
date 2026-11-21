// Security flags for an agent, from what we already know: its address, its registry entry and the tools it listed at
// its last health check (src/health.js). Tool powers are read from the tool's own safety notes where it gives them
// (MCP annotations), otherwise guessed from the tool's name, and the page says which.

const words = (name) => String(name ?? '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const MONEY = new Set(['transfer', 'withdraw', 'deposit', 'swap', 'trade', 'buy', 'sell', 'pay', 'payment', 'payout', 'bridge', 'stake', 'unstake', 'mint', 'burn', 'refund', 'charge', 'invoice']);
const COINS = new Set(['eth', 'token', 'tokens', 'usdc', 'usdt', 'sol', 'btc', 'funds', 'crypto', 'tx', 'transaction', 'money', 'nft']);
const MESSAGE_VERBS = new Set(['send', 'post', 'publish', 'tweet', 'reply', 'notify', 'email', 'message', 'dm', 'sms', 'broadcast', 'comment']);
const CODE = new Set(['exec', 'execute', 'shell', 'eval', 'bash', 'terminal', 'subprocess', 'sandbox']);
const RUN_WHAT = new Set(['code', 'command', 'commands', 'script', 'python', 'js', 'javascript', 'sql', 'cmd']);
const CHANGE_VERBS = new Set(['delete', 'remove', 'drop', 'destroy', 'purge', 'update', 'write', 'create', 'edit', 'set', 'insert', 'upload', 'modify', 'rename', 'move', 'cancel', 'deploy']);

export const POWERS = {
  money: { label: 'Moves money or tokens', level: 'warn' },
  code: { label: 'Runs code or commands', level: 'warn' },
  messages: { label: 'Sends messages or posts', level: 'warn' },
  changes: { label: 'Changes or deletes data', level: 'warn' },
};

// Which powers one tool seems to have.
export function toolPowers(tool) {
  const w = words(tool?.name);
  const out = new Set();
  const has = (set) => w.some((x) => set.has(x));
  if (has(MONEY) || ((w.includes('send') || w.includes('sign')) && has(COINS)) || (w.includes('place') && w.includes('order'))) out.add('money');
  if (has(CODE) || (w.includes('run') && has(RUN_WHAT))) out.add('code');
  if (MESSAGE_VERBS.has(w[0]) && !out.has('money')) out.add('messages');
  if (CHANGE_VERBS.has(w[0]) || tool?.destructive === true) out.add('changes');
  // A tool that says it only reads is taken at its word for data changes, not for money or messages.
  if (tool?.readOnly === true) out.delete('changes');
  return [...out];
}

// The list of flags shown on an agent's page: { level: good | info | warn | bad, text }.
export function securityFlags(r) {
  const flags = [];
  const note = r?.health?.note ?? '';
  if (!r?.endpoint) return [{ level: 'info', text: 'No public address listed, so nothing to check' }];
  if (/private network/i.test(note)) flags.push({ level: 'bad', text: 'Its address points at a private network' });
  else if (/^https:/i.test(r.endpoint)) flags.push({ level: 'good', text: 'Uses HTTPS, so traffic is encrypted' });
  else flags.push({ level: 'bad', text: 'Not encrypted: uses plain HTTP' });

  if (r.details?.needsKey || /needs a key/i.test(note)) flags.push({ level: 'info', text: 'Needs a key or sign-in to use' });
  else if (r.checked_at && r.up) flags.push({ level: 'info', text: 'Open to anyone: no key needed' });
  if (r.x402 || /payment/i.test(note)) flags.push({ level: 'info', text: 'Takes payment (x402)' });

  const tools = r.health?.tools;
  if (!r.checked_at) flags.push({ level: 'info', text: 'Tool powers not known yet: not health checked' });
  else if (!tools?.length) flags.push({ level: 'info', text: 'Tool powers not known: it did not list its tools' });
  else {
    const found = {};
    for (const t of tools) for (const p of toolPowers(t)) (found[p] ??= []).push(t.name);
    for (const [p, names] of Object.entries(found)) {
      flags.push({ level: POWERS[p].level, text: `${POWERS[p].label}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}` });
    }
    if (!Object.keys(found).length) {
      flags.push({ level: 'good', text: tools.every((t) => t.readOnly === true) ? 'Every tool says it only reads' : 'No tools that look like they move money, send messages, run code or change data' });
    }
  }
  return flags;
}

// The one or two flags worth a tag on a /listed card.
export function cardFlags(r) {
  const out = [];
  if (r?.endpoint && /^http:/i.test(r.endpoint)) out.push({ level: 'bad', text: 'No HTTPS' });
  const powers = new Set((r?.health?.tools ?? []).flatMap(toolPowers));
  if (powers.has('money')) out.push({ level: 'warn', text: 'Moves money' });
  if (powers.has('code')) out.push({ level: 'warn', text: 'Runs code' });
  return out.slice(0, 2);
}
