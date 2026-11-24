// The public grades feed: every grade as JSON, so other directories and marketplaces can show them.
// Grades come from Agent Report Card, and the feed says so under that name (registries and listings keep the
// Agent Report Card name; the parrot names are for this site only).
import express from 'express';
import { allAgents, agentById, SYNCED_AT } from './agents.js';
import { testedAgentFor, ownListings } from './directories.js';
import { esc, layout } from './views.js';
import { apiAccess, historyHandler, PLANS } from './api-keys.js';

const FEED_VERSION = 1;

// One agent as it appears in the feed.
export function feedAgent(a, { baseUrl, graderUrl }) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    category: a.category,
    grade: a.grade,
    score: a.score,
    honesty: a.honesty,
    provisional: a.provisional,
    gradedAt: a.gradedAt,
    tasks: a.tasks.length,
    url: a.url,
    report: `${graderUrl}/agents/${encodeURIComponent(a.id)}/`,
    page: `${baseUrl}/agents/${encodeURIComponent(a.id)}`,
    // Where else this agent is registered, as "mcp:<server name>" or "erc8004:<chain id or *>:<agent id>".
    registries: ownListings(a.id).ids ?? [],
  };
}

export function feedRoutes({ config, db, fetchFn = fetch, now = () => new Date() }) {
  const app = express.Router();
  const urls = { baseUrl: config.baseUrl, graderUrl: config.graderUrl };
  const source = () => ({
    name: 'Agent Report Card',
    url: config.graderUrl,
    method: 'Real tasks, each answer scored by two independent judges (Reppo 70%, SERV 30%), plus honesty checks.',
  });
  const scale = { A: '90 to 100', B: '80 to 89', C: '70 to 79', D: '60 to 69', F: 'under 60' };

  // Anyone can read the feed, from any website, with or without a key. A key adds a known daily limit and, on a paid
  // plan, grade history and webhooks (src/api-keys.js). Answers to keyed calls are never kept by the CDN.
  const access = apiAccess({ db, now });
  app.use('/api/grades.json', access);
  app.use('/api/grades', access);
  const cache = (req, res) => { if (!req.apiKey) res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600'); };

  app.get('/api/grades.json', (req, res) => {
    cache(req, res);
    res.json({ version: FEED_VERSION, source: source(), updatedAt: SYNCED_AT, scale, count: allAgents().length,
      agents: allAgents().map((a) => feedAgent(a, urls)) });
  });

  // Has this agent been graded? Ask by its registry entry or its web address.
  //   /api/grades/lookup?mcp=io.github.example/server   ?erc8004=8453:1234   ?url=https://example.com
  app.get('/api/grades/lookup', (req, res) => {
    const str = (k) => (typeof req.query[k] === 'string' ? req.query[k].slice(0, 300) : '');
    const [mcp, erc, url] = [str('mcp'), str('erc8004'), str('url')];
    cache(req, res);
    if (!mcp && !erc && !url) return res.status(400).json({ error: 'Give mcp, erc8004 or url.' });
    const row = mcp ? { source: 'mcp', source_id: mcp, url } : erc ? { source: 'erc8004', source_id: erc, url } : { source: '', source_id: '', url };
    const agent = testedAgentFor(row);
    res.json(agent ? { graded: true, source: source().name, agent: feedAgent(agent, urls) } : { graded: false, test: `${config.baseUrl}/get-polly-tested` });
  });

  app.get('/api/grades/:id/history.json', historyHandler({ db, config, fetchFn, source }));

  app.get('/api/grades/:id.json', (req, res) => {
    cache(req, res);
    const agent = agentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'No graded agent with that id.' });
    res.json({ version: FEED_VERSION, source: source(), agent: feedAgent(agent, urls) });
  });

  app.get('/feed', (req, res) => res.send(feedPage({ baseUrl: config.baseUrl, count: allAgents().length, example: allAgents()[0], x402: Boolean(config.x402PayTo), x402Usd: config.x402LookupUsd })));

  return app;
}

export function feedPage({ baseUrl, count, example, x402 = false, x402Usd = 0.002 }) {
  const sample = example ? `{
  "id": "${example.id}",
  "name": "${example.name}",
  "grade": "${example.grade}",
  "score": ${Number(example.score)},
  "honesty": "${example.honesty}",
  "report": "https://grader.designimp.com/agents/${example.id}/",
  …
}` : '';
  return layout('Grades feed', `
    <section class="page-head">
      <p class="eyebrow">For directories and developers</p>
      <h1>Use our grades</h1>
      <p class="lead">Run a directory, marketplace or registry of AI agents? Show your users which ones have been tested.
        All ${Number(count)} grades are free to read as JSON. No key, no sign-up. Need more? See the <a href="#plans">plans</a>.</p>
    </section>
    <section class="card section">
      <h2>Every grade</h2>
      <p><a href="/api/grades.json"><code>${esc(baseUrl)}/api/grades.json</code></a></p>
      <p class="muted">Each agent has its grade (A to F), score out of 100, honesty check result, the date it was graded and a link to the full report card.</p>
      ${sample ? `<pre class="answer">${esc(sample)}</pre>` : ''}
      <h2>One agent</h2>
      <p><code>${esc(baseUrl)}/api/grades/&lt;id&gt;.json</code></p>
      <h2>Has this agent been graded?</h2>
      <p>Look it up by its Official MCP Registry name, its ERC-8004 id (chain:agent) or its website:</p>
      <ul class="plain-list">
        <li><code>/api/grades/lookup?mcp=io.github.example/server</code></li>
        <li><code>/api/grades/lookup?erc8004=8453:1234</code></li>
        <li><code>/api/grades/lookup?url=https://example.com</code></li>
      </ul>
      <p class="muted">Not graded yet? The answer links to where its builder can get it tested.</p>
    </section>
    <section class="card section" id="plans">
      <h2>Plans</h2>
      <p>The feed above stays free with no key. A key gives you a known daily limit, and the paid plans add every past
        grade and a webhook when grades change. Paying never changes a grade or a ranking.</p>
      <div class="table-scroll"><table><thead><tr><th>Plan</th><th>Price</th><th>Calls</th><th>Grade history</th><th>Webhooks</th><th>Commercial use</th></tr></thead><tbody>
        ${Object.values(PLANS).map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.price)}</td><td>${p.perDay ? `${Number(p.perDay).toLocaleString('en-US')} a day` : `${Number(p.perHour)} an hour`}</td>
          <td>${p.history ? 'Yes' : ''}</td><td>${p.webhooks ? 'Yes' : ''}</td><td>${p.commercial ? 'Yes' : p.price === 'Free' ? 'With credit' : 'Small teams'}</td></tr>`).join('')}
      </tbody></table></div>
      <p><a class="btn" href="/api-keys">Get a free key</a></p>
      <h2>Using a key</h2>
      <pre class="answer">curl -H "Authorization: Bearer ap_your_key" ${esc(baseUrl)}/api/grades.json</pre>
      <p class="muted">Every answer carries <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>. <code>${esc(baseUrl)}/api/account</code> shows your plan and today's calls.</p>
      <h2>Grade history (paid plans)</h2>
      <p><code>${esc(baseUrl)}/api/grades/&lt;id&gt;/history.json</code>: every past run's grade and score, oldest first.</p>
      ${x402 ? `<p>No key? Agents can pay per call: the address answers <code>402 Payment Required</code> with x402 payment details,
        $${esc(String(x402Usd))} in USDC on Base a call. Send the signed payment in the <code>X-PAYMENT</code> header.</p>` : ''}
      <h2>Webhooks (paid plans)</h2>
      <p>Add an https address on your key's page. Once a day, when any grade changes, it gets a <code>POST</code> with
        <code>{"event": "grades.updated", "changes": [...]}</code>, signed in the <code>X-Signature-256</code> header
        (HMAC SHA-256 of the body with your webhook secret).</p>
    </section>
    <section class="card section">
      <h2>The small print</h2>
      <ul class="plain-list">
        <li>Grades come from <strong>Agent Report Card</strong>. Please credit it by that name and link to the agent's report card.</li>
        <li>Grades are snapshots from the date shown, not verdicts on the people who built the agent.</li>
        <li>The feed updates when new grades are published. Cache it for at least ten minutes.</li>
      </ul>
    </section>`, { description: 'Free JSON feed of every Agent Report Card grade, for agent directories, marketplaces and registries.' });
}
