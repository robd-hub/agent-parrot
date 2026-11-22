// Checks whether listed agents answer, how fast, and what tools they offer. Runs twice a day (see vercel.json),
// oldest-checked first, so every agent gets checked every few days. One short, polite visit per agent:
//   MCP agents: the standard MCP hello (initialize), then tools/list, then the session is closed.
//   A2A agents: their public agent card (/.well-known/agent-card.json), which lists their skills.
// Only public internet addresses are visited: anything that points at a private or local network is refused, and
// redirects are not followed. Bodies are capped, and nothing an agent sends back is ever run.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TIMEOUT_MS = 10000;
const MAX_BODY = 256 * 1024;
const UA = 'AgentParrot/1.0 (agent directory health check)';
const clip = (s, max) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// Private, local and reserved address ranges. A listed agent pointing at one of these is never visited.
export function isPrivateAddress(ip) {
  if (isIP(ip) === 6) {
    const a = ip.toLowerCase();
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a) || a.startsWith('64:ff9b:') || a.startsWith('2001:db8');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

export async function publicUrl(raw, lookup = dnsLookup) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'Not a valid address' };
  }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return { error: 'Not a web address' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) return { error: 'Points at a private network' };
  let addrs;
  try {
    addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    return { error: 'Its web address does not exist' };
  }
  if (!addrs.length || addrs.some((x) => isPrivateAddress(x.address))) return { error: 'Points at a private network' };
  return { url: u };
}

// fetch with a time limit, no redirects and a capped body.
async function visit(fetchFn, url, init = {}) {
  const res = await fetchFn(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': UA, ...init.headers } });
  let text = '';
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let size = 0;
    // An event stream can stay open: stop once there's a complete message or the cap is hit.
    while (size < MAX_BODY) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      text += dec.decode(value, { stream: true });
      if (init.untilMessage && /\n\n/.test(text) && /"id"\s*:/.test(text)) break;
    }
    reader.cancel().catch(() => {});
  } else if (res.text) text = (await res.text()).slice(0, MAX_BODY);
  return { status: res.status, headers: res.headers, text };
}

// A JSON-RPC answer, sent either as plain JSON or as a server-sent event.
export function rpcResult(text, id) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const msgs = [tryParse(text), ...text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => tryParse(l.slice(5).trim()))]
    .flat().filter((m) => m && typeof m === 'object');
  return msgs.find((m) => m.id === id) ?? null;
}

const header = (res, name) => (typeof res.headers?.get === 'function' ? res.headers.get(name) : null);
const verdict = (status) => (status === 401 || status === 403 ? 'Answered, but needs a key'
  : status === 402 ? 'Answered, and asks for payment' : null);

// The price an x402 agent asks for, read from its "402 Payment Required" answer. We never pay: we only read the
// offer. Version 1 puts it in the body; version 2 in a base64 PAYMENT-REQUIRED header. Amounts are in the token's
// smallest unit, so they're only turned into dollars for tokens we know (USDC has 6 decimals).
const USDC = new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d']);
const NETWORKS = { base: 'Base', 'base-sepolia': 'Base Sepolia (test)', ethereum: 'Ethereum', polygon: 'Polygon', solana: 'Solana', avalanche: 'Avalanche',
  'eip155:8453': 'Base', 'eip155:84532': 'Base Sepolia (test)', 'eip155:1': 'Ethereum', 'eip155:137': 'Polygon', 'eip155:43114': 'Avalanche' };
export function x402Price(res) {
  let offer = null;
  try {
    offer = JSON.parse(res.text);
  } catch { /* not JSON */ }
  if (!Array.isArray(offer?.accepts)) {
    const h = header(res, 'payment-required');
    try {
      offer = h ? JSON.parse(Buffer.from(h, 'base64').toString('utf8')) : offer;
    } catch { /* not base64 JSON */ }
  }
  const a = Array.isArray(offer?.accepts) ? offer.accepts[0] : null;
  const raw = String(a?.maxAmountRequired ?? a?.amount ?? '');
  if (!a || !/^[0-9]{1,30}$/.test(raw)) return null;
  const asset = String(a.asset ?? '').toLowerCase();
  const network = String(a.network ?? '');
  const where = NETWORKS[network] ?? (clip(network, 30) || null);
  const usdc = USDC.has(asset) || /^(usd ?coin|usdc)$/i.test(a.extra?.name ?? '');
  const dollars = usdc ? Number(raw) / 1e6 : null;
  const money = dollars === null ? '' : dollars < 0.01 ? String(Number(dollars.toFixed(6))) : dollars.toFixed(2);
  return {
    amount: raw, usd: dollars, network: where, scheme: clip(a.scheme, 20) || null,
    display: usdc ? `$${money} USDC per call${where ? ` on ${where}` : ''}`
      : `${raw} units of token ${clip(asset, 12)}${where ? ` on ${where}` : ''} per call (token not recognised, so no dollar figure)`,
  };
}

export async function checkMcp(endpoint, { fetchFn = fetch } = {}) {
  const started = Date.now();
  const post = (body, session) => visit(fetchFn, endpoint, {
    method: 'POST', untilMessage: true,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify(body),
  });
  const hello = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'AgentParrot', version: '1.0' } } });
  const latency = Date.now() - started;
  const locked = verdict(hello.status);
  if (locked) return { up: true, latency, note: locked, price: hello.status === 402 ? x402Price(hello) : null };
  if (hello.status === 405 || hello.status === 404) {
    // Older MCP servers talk over a long-lived event stream instead; seeing it open is enough to know it's there.
    const sse = await visit(fetchFn, endpoint, { headers: { accept: 'text/event-stream' }, untilMessage: true }).catch(() => null);
    if (sse && sse.status === 200 && /event-stream/.test(header(sse, 'content-type') ?? '')) return { up: true, latency, note: 'Answers over the older MCP event stream; tools not read' };
    return { up: false, latency, note: `Answered ${hello.status}: no MCP server at this address` };
  }
  if (hello.status >= 300) return { up: false, latency, note: `Answered ${hello.status}` };
  const init = rpcResult(hello.text, 1);
  if (!init?.result) return { up: false, latency, note: init?.error ? `MCP error: ${clip(init.error.message, 80)}` : 'Answered, but not as an MCP server' };
  const session = header(hello, 'mcp-session-id');
  const server = { name: clip(init.result.serverInfo?.name, 80) || null, version: clip(init.result.serverInfo?.version, 30) || null, protocol: clip(init.result.protocolVersion, 20) || null };
  let tools = null;
  {
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session).catch(() => null);
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session).catch(() => null);
    const r = list && rpcResult(list.text, 2);
    if (Array.isArray(r?.result?.tools)) {
      tools = r.result.tools.slice(0, 40).map((t) => ({
        name: clip(t?.name, 60), description: clip(t?.description, 140) || null,
        // The tool's own safety notes (MCP annotations), when it gives them. Used for the security flags.
        ...(typeof t?.annotations?.readOnlyHint === 'boolean' ? { readOnly: t.annotations.readOnlyHint } : {}),
        ...(typeof t?.annotations?.destructiveHint === 'boolean' ? { destructive: t.annotations.destructiveHint } : {}),
      })).filter((t) => t.name);
      if (r.result.nextCursor) tools.more = true;
    }
  }
  if (session) visit(fetchFn, endpoint, { method: 'DELETE', headers: { 'mcp-session-id': session } }).catch(() => {});
  return { up: true, latency, note: tools ? null : 'Answered, but did not list its tools', server, tools, toolsMore: Boolean(tools?.more) };
}

export async function checkA2a(endpoint, { fetchFn = fetch, x402 = false } = {}) {
  const started = Date.now();
  const origin = new URL(endpoint).origin;
  for (const path of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
    const res = await visit(fetchFn, origin + path, { headers: { accept: 'application/json' } }).catch(() => null);
    if (!res || res.status !== 200) continue;
    let card = null;
    try {
      card = JSON.parse(res.text);
    } catch { /* not JSON */ }
    if (card && typeof card === 'object' && card.name) {
      const skills = (Array.isArray(card.skills) ? card.skills : []).slice(0, 40).map((s) => ({ name: clip(s?.name || s?.id, 60), description: clip(s?.description, 140) || null })).filter((s) => s.name);
      const latency = Date.now() - started;
      // An agent that says it takes x402 payments usually names its price when asked without paying.
      const ask = x402 ? await visit(fetchFn, endpoint, { headers: { accept: 'application/json' } }).catch(() => null) : null;
      return { up: true, latency, note: null, server: { name: clip(card.name, 80), version: clip(card.version, 30) || null, protocol: clip(card.protocolVersion, 20) || null }, tools: skills,
        price: ask?.status === 402 ? x402Price(ask) : null };
    }
  }
  const res = await visit(fetchFn, endpoint, { headers: { accept: 'application/json' } });
  const latency = Date.now() - started;
  return res.status < 500
    ? { up: true, latency, note: verdict(res.status) || 'Answered, but has no public agent card', price: res.status === 402 ? x402Price(res) : null }
    : { up: false, latency, note: `Answered ${res.status}` };
}

// Checks one listed agent. Never throws: a failure is a result too.
export async function checkAgent(row, { fetchFn = fetch, lookup = dnsLookup } = {}) {
  const endpoint = row.endpoint;
  if (!endpoint) return { up: false, latency: null, note: 'No address to check' };
  const safe = await publicUrl(endpoint, lookup);
  if (safe.error) return { up: false, latency: null, note: safe.error };
  const a2a = row.source === 'erc8004' && !row.details?.mcp && row.details?.a2a;
  try {
    return await (a2a ? checkA2a : checkMcp)(safe.url.href, { fetchFn, x402: Boolean(row.x402) });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { up: false, latency: null, note: timeout ? `No answer within ${TIMEOUT_MS / 1000} seconds` : 'Could not connect' };
  }
}

// One health run: checks the agents that were checked longest ago (never-checked first), several at a time,
// until the time budget runs out. Returns how many were checked and how many answered.
export async function checkHealth({ db, fetchFn = fetch, lookup = dnsLookup, budgetMs = 200000, concurrency = 40, batch = 400 }) {
  const started = Date.now();
  let checked = 0;
  let up = 0;
  while (Date.now() - started < budgetMs) {
    const due = await db.listed.dueForCheck(batch);
    if (!due.length) break;
    const results = [];
    let i = 0;
    const worker = async () => {
      while (i < due.length && Date.now() - started < budgetMs) {
        const row = due[i++];
        results.push({ source: row.source, source_id: row.source_id, ...(await checkAgent(row, { fetchFn, lookup })) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
    await db.listed.saveHealth(results);
    checked += results.length;
    up += results.filter((r) => r.up).length;
    if (due.length < batch) break;
  }
  return { checked, up };
}
