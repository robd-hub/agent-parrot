# Agent Parrot handover (22 Nov 2026)

Where the project stands, for whoever picks it up next (Claude Code, Antigravity or a person).
Rules and commands are in `CLAUDE.md`. Update this file when something below changes.

## Live now

- Repo `robd-hub/agent-parrot`, default branch `main`. `npm test`: 36 tests, all passing.
- Vercel project `agent-parrot` (team designimp-projects, Hobby plan), linked to the repo, deploys `main`
  automatically: https://agent-parrot.vercel.app. Behind Vercel's login until a custom domain is added,
  so the public can't see it yet.
- Neon Postgres connected through Vercel. Set in Vercel by Rob so far: `SESSION_SECRET`, `DATABASE_URL`,
  `ADMIN_PASSWORD`, `GRAPH_API_KEY`.
- Daily crons: `/api/cron/directories` 05:00 UTC, `/api/cron/hallucination` 06:00 UTC, `/api/cron/health` 01:00, 09:00, 13:00, 19:00 UTC.

## Done (all merged with Rob's OK)

| PR | What it did |
| --- | --- |
| #1 | First version of the site: directory, Pecking Order, agent pages, Daily Hallucination, Spot the Hallucination game, articles, The Squawk, sign-in, admin |
| #2 | Lighter, CoinGecko-style home page with every agent ranked |
| #3 | `/listed`: agents pulled in from the Official MCP Registry (no key) and ERC-8004 (via The Graph, needs `GRAPH_API_KEY`); "Also listed on" badges from `data/listed-on.json`; `/admin/directories` |
| #4 | Faster directory copy on the live database (batched queries) |
| #5 | Free grades feed: `/api/grades.json`, `/api/grades/<id>.json`, `/api/grades/lookup`, and the `/feed` page |
| #6 | `CLAUDE.md` and this file updated for working in Antigravity too |
| #7 | Top bar: dark mode toggle, Sign in and Sign up buttons (CoinGecko style); new `/signup` page (same flow as `/signin`) |
| #8 | Light by default (dark only when someone clicks the moon, never from the device setting); `/news` split by day under Today / Yesterday / date headings |
| #10 | Key details on every agent page (maker, links, first listed, how to connect, model, pricing), pages for each `/listed` agent and maker, maker reputation score (`src/makers.js`) |

## In review

- Health checks (branch `claude/agent-health`): each listed agent is visited at most once a day to see if it
  answers, how fast, and what tools or skills it lists. Up/Down tags and an "only agents that answered" filter on
  `/listed`, uptime % and tools on agent pages, uptime feeds the maker reputation. Checks every few days per agent.

## Waiting on Rob

1. Buy the domains agentparrot.ai and agentparrots.com (about $170, Rob buys them on Cloudflare himself).
   Adding one to Vercel is what makes the site public.
2. Sign-in apps (Google, GitHub, LinkedIn), the Claude API key and the email settings in `.env.example`.
   Rob adds the values in Vercel himself. Never ask for them in chat and never put them in a file or PR.
3. Move to Vercel Pro (about $20 a month) once the site takes money.
4. Agent Parrot LinkedIn page, 20 builders to invite, a launch date.

## Paused or parked

- The Daily Hallucination run starts paused. Once `ANTHROPIC_API_KEY` is set, resume it at `/admin/news`.
- Claim-your-listing growth plan (builders claim their `/listed` agent, get a badge, nudged to a paid test):
  written up, not built. Parked until 21 Dec 2026. Never email addresses taken from GitHub or open automated
  GitHub issues.
- The SealKeeper-style badge idea was dropped.
- Publishing the grades feed to outsiders only works once a custom domain is live.

## Things to know

- The site opens light for everyone. Rob wants it that way: don't make dark mode follow the device setting.

- Grades come from the agent-report-card repo via `npm run sync-grades` (repos side by side). Never edit
  `data/agents.json` by hand; grades must match Agent Report Card exactly.
- Paid tests ($10, $5 retest) send people to `GRADER_URL` (default https://grader.designimp.com).
- Hackathons, listings and registries keep the "Agent Report Card" name. Parrot names are this site only.
- Rob's own agents on the site: Cheap First (grade A, 98, https://cheap-first.vercel.app/) and the Agent
  Report Card grader. Where they are registered is kept in `data/listed-on.json`.
- No public listing API was found for OpenServ, NEAR AI Market, Concordium or mcptry. x402 Bazaar is a
  possible third directory source.
- Business plan: https://claude.ai/artifact/Cgr4y3TzZiDA9FfHg3SAwE
