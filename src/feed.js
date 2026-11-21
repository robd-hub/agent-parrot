// The public grades feed: every grade as JSON, so other directories and marketplaces can show them.
// Grades come from Agent Report Card, and the feed says so under that name (registries and listings keep the
// Agent Report Card name; the parrot names are for this site only).
import express from 'express';
import { allAgents, agentById, SYNCED_AT } from './agents.js';
import { testedAgentFor, ownListings } from './directories.js';
import { esc, layout } from './views.js';

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

export function feedRoutes({ config }) {
  const app = express.Router();
  const urls = { baseUrl: config.baseUrl, graderUrl: config.graderUrl };
  const source = () => ({
    name: 'Agent Report Card',
    url: config.graderUrl,
    method: 'Real tasks, each answer scored by two independent judges (Reppo 70%, SERV 30%), plus honesty checks.',
  });
  const scale = { A: '90 to 100', B: '80 to 89', C: '70 to 79', D: '60 to 69', F: 'under 60' };

  // Anyone can read the feed, from any website.
  app.use('/api/grades', (req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' });
    next();
  });

  app.get('/api/grades.json', (req, res) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' });
    res.json({ version: FEED_VERSION, source: source(), updatedAt: SYNCED_AT, scale, count: allAgents().length,
      agents: allAgents().map((a) => feedAgent(a, urls)) });
  });

  // Has this agent been graded? Ask by its registry entry or its web address.
  //   /api/grades/lookup?mcp=io.github.example/server   ?erc8004=8453:1234   ?url=https://example.com
  app.get('/api/grades/lookup', (req, res) => {
    const str = (k) => (typeof req.query[k] === 'string' ? req.query[k].slice(0, 300) : '');
    const [mcp, erc, url] = [str('mcp'), str('erc8004'), str('url')];
    if (!mcp && !erc && !url) return res.status(400).json({ error: 'Give mcp, erc8004 or url.' });
    const row = mcp ? { source: 'mcp', source_id: mcp, url } : erc ? { source: 'erc8004', source_id: erc, url } : { source: '', source_id: '', url };
    const agent = testedAgentFor(row);
    res.json(agent ? { graded: true, source: source().name, agent: feedAgent(agent, urls) } : { graded: false, test: `${config.baseUrl}/get-polly-tested` });
  });

  app.get('/api/grades/:id.json', (req, res) => {
    const agent = agentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'No graded agent with that id.' });
    res.json({ version: FEED_VERSION, source: source(), agent: feedAgent(agent, urls) });
  });

  app.get('/feed', (req, res) => res.send(feedPage({ baseUrl: config.baseUrl, count: allAgents().length, example: allAgents()[0] })));

  return app;
}

export function feedPage({ baseUrl, count, example }) {
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
        All ${Number(count)} grades are free to read as JSON. No key, no sign-up.</p>
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
    <section class="card section">
      <h2>The small print</h2>
      <ul class="plain-list">
        <li>Grades come from <strong>Agent Report Card</strong>. Please credit it by that name and link to the agent's report card.</li>
        <li>Grades are snapshots from the date shown, not verdicts on the people who built the agent.</li>
        <li>The feed updates when new grades are published. Cache it for at least ten minutes.</li>
      </ul>
    </section>`, { description: 'Free JSON feed of every Agent Report Card grade, for agent directories, marketplaces and registries.' });
}
