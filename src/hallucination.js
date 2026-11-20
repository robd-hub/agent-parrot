// The Daily Hallucination: once a day, Claude picks five stories from the AI news feeds and rewrites each one as satire.
// Each story can point to one tested agent that fits its theme, shown under it in a plain, factual "Polly Tested" box.
// Stories are stored in the database, so pages never wait on Claude. Needs ANTHROPIC_API_KEY.
// Ported from Bullwhip's Daily Whip (same guardrails, same pause switch).
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';
export const STORIES_PER_DAY = 5;

const SYSTEM = `You write "The Daily Hallucination" for Agent Parrot, a funny community site for people who build and use AI agents.
The mascot is Polly, a parrot with a raised eyebrow who tests agents for a living. Think The Onion, written by someone who has
babysat an AI agent through a long weekend: deadpan, confident, absurd and properly funny. Readers are builders and enthusiasts
who know the jargon (context windows, token bills, evals, prompt injection, YOLO mode, "it worked in the demo"). Use British spelling.

You get a numbered list of real news stories, and a list of tested agents (id, name and what each does).
Pick the stories with the most comic potential and rewrite each as a short satirical news story.

Each story has:
- headline: a satirical headline, under 14 words. Punchy, no clickbait questions.
- body: 70 to 120 words in two or three short paragraphs separated by a blank line. Plain text, no markdown.
- agent: the id of ONE tested agent whose job fits the story's theme (for example a coding story and a coding agent), or "" if none fits.
  This only decides which grade is shown in a factual box under the story. Never mention that agent in the headline or body.

Rules. These matter more than being funny:
- Joke about situations, the industry and its habits (demos, benchmarks, token bills, hype, "agentic" everything, eval spreadsheets),
  never about a named company, product, model, agent or real person. Refer to them generically ("a major AI lab", "a popular coding assistant")
  and never name any company, product, model, agent or real person in the headline or body.
- Any quotes must come from obviously made-up, unnamed people ("a founder on his third pivot"). Never invent quotes from real people or organisations.
- Skip stories about deaths, injuries, self-harm, war, crime, lawsuits against individuals, elections, or people losing their jobs.
- Write every sentence yourself. Do not copy wording from the original story.
- Make the exaggeration obvious enough that nobody could mistake it for real news.
- Keep it work-safe: something a builder would happily share on LinkedIn or X. No swearing, politics or punching down.
- Pick stories on different topics, so the five don't all tell the same joke.`;

const SCHEMA = {
  type: 'object',
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pick: { type: 'integer', description: 'The number of the original story in the list' },
          headline: { type: 'string' },
          body: { type: 'string' },
          agent: { type: 'string', description: 'A tested agent id from the list, or an empty string' },
        },
        required: ['pick', 'headline', 'body', 'agent'],
        additionalProperties: false,
      },
    },
  },
  required: ['stories'],
  additionalProperties: false,
};

// Calls Claude and returns the parsed { stories } object.
export function claudeWriter({ apiKey, model = MODEL } = {}) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async ({ prompt }) => {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      // If a safety check declines the request, the API retries it on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write the stories');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
  };
}

// Turns headlines into satire. `avoid` lists headlines to steer away from (when regenerating a story).
export async function writeStories({ candidates, agents = [], count = STORIES_PER_DAY, avoid = [], write }) {
  const pool = candidates.slice(0, 30);
  if (!pool.length) return [];
  const ids = new Set(agents.map((a) => a.id));
  const list = pool.map((c, i) => `${i + 1}. [${c.source}] ${c.title}${c.summary ? `\n   ${c.summary}` : ''}`).join('\n');
  const roster = agents.map((a) => `- ${a.id}: ${a.name}. ${a.description}`).join('\n');
  const n = Math.min(count, pool.length);
  const prompt = `Today's stories:\n\n${list}\n\nTested agents:\n${roster || '(none)'}\n\nWrite exactly ${n} satirical ${n === 1 ? 'story' : 'stories'}.`
    + (avoid.length ? `\nTake a completely different angle from these earlier headlines: ${avoid.map((h) => `"${h}"`).join('; ')}.` : '');
  const { stories = [] } = await write({ prompt });
  const used = new Set();
  const out = [];
  for (const s of stories) {
    const source = pool[s.pick - 1];
    const headline = String(s.headline ?? '').trim().slice(0, 200);
    const body = String(s.body ?? '').trim().slice(0, 2000);
    if (!source || used.has(source.link) || !headline || !body) continue;
    used.add(source.link);
    out.push({
      headline, body, agent_id: ids.has(s.agent) ? s.agent : null,
      source: source.source, source_title: source.title, source_link: source.link, source_summary: source.summary || null,
    });
    if (out.length >= count) break;
  }
  return out;
}

// Writes today's five, unless they already exist (so a repeated cron call costs nothing). `force` replaces them.
export async function runDaily({ db, getHeadlines, agents, write, force = false, day = today() }) {
  if (!write) throw new Error('ANTHROPIC_API_KEY is not set, so The Daily Hallucination cannot be written yet.');
  if (!force && (await db.stories.countForDay(day)) > 0) return { day, created: 0, skipped: true };
  const recent = new Set(await db.stories.recentLinks(7)); // skip stories used in the last week
  const candidates = (await getHeadlines()).filter((h) => !recent.has(h.link));
  const stories = await writeStories({ candidates, agents, write });
  if (!stories.length) throw new Error('No stories were written. The news feeds may be down.');
  await db.stories.replaceDay(day, stories);
  return { day, created: stories.length };
}

// Rewrites one story from the same original article.
export async function regenerateStory({ db, id, agents, write }) {
  if (!write) throw new Error('ANTHROPIC_API_KEY is not set.');
  const old = await db.stories.get(id);
  if (!old) return null;
  const candidate = { title: old.source_title, link: old.source_link, source: old.source, summary: old.source_summary };
  const [story] = await writeStories({ candidates: [candidate], agents, count: 1, avoid: [old.headline], write });
  if (!story) throw new Error('Claude did not write a new version. Try again, or hide the story.');
  await db.stories.update(id, story);
  return story;
}

export const today = () => new Date().toISOString().slice(0, 10);
