# Agent Parrot handover (22 Nov 2026)

Where the project stands, for whoever picks it up next (Claude Code, Antigravity or a person).
Rules and commands are in `CLAUDE.md`. Update this file when something below changes.

## Live now

- Repo `robd-hub/agent-parrot`, default branch `main`. `npm test`: 53 tests, all passing.
- Vercel project `agent-parrot` (team designimp-projects, Hobby plan), linked to the repo, deploys `main`
  automatically: https://agent-parrot.vercel.app. Behind Vercel's login until a custom domain is added,
  so the public can't see it yet.
- Neon Postgres connected through Vercel. Set in Vercel by Rob so far: `SESSION_SECRET`, `DATABASE_URL`,
  `ADMIN_PASSWORD`, `GRAPH_API_KEY`.
- Daily crons: `/api/cron/directories` 05:00 UTC, `/api/cron/hallucination` 06:00 UTC, `/api/cron/health` 01:00 and 13:00 UTC.

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
| #11 | Health checks (`src/health.js`): each listed agent visited at most once a day; Up/Down, response time, uptime % and tools on pages; "only agents that answered" filter; uptime in maker reputation. Cut to twice a day (01:00, 13:00 UTC) to save free-plan use |
| #14 | Prices and activity: real x402 price per call (read, never paid), GitHub code activity (`src/activity.js`), last on-chain activity for ERC-8004 agents, recent activity in maker reputation |
| #13 | Grade history chart on each tested agent's page (every past Agent Report Card run) and a Security section (HTTPS, key, payment, tool powers) |

## In review

- Compare two agents (branch `claude/compare-agents`): `/compare` puts any two agents (tested or listed) side by side:
  grade, honesty, grade history, price per call, health and uptime, security flags, tools, activity, licence, data
  privacy, maker and reputation, where listed. "Better" marks the higher score, uptime, reputation and listings and the
  lower price, only when both have a number. Compare links on tested and listed agent pages, `/listed` cards, and the
  `/agents` and `/listed` pages. Agent pages also get Licence and Data privacy rows (`src/openness.js`): the licence
  comes from the GitHub repo's licence (read weekly) or `licence` in `data/agent-facts.json`; privacy shows a policy
  only from `privacy`/`privacyUrl` in that file, plus plain facts (where data goes, x402 puts the wallet on chain).
  Everything else says "not known". No sign-in needed. (Merged as #15.)
- Member reviews and ratings (branch `claude/reviews-ratings`, `src/reviews.js`, `src/review-views.js`): signed-in, joined
  members give any tested or listed agent 1 to 5 stars and an optional note (up to 1,000 characters), one per member per
  agent, and can edit or delete it. Average and count show on agent pages (tested and listed), `/agents` and `/listed`
  cards, maker pages and a new "Member reviews" row on `/compare` ("Better" only once both have 3+ reviews). Reviews never
  change grades, the Pecking Order or the maker reputation score (the maker page shows the member average beside it,
  labelled as not counted). Abuse protection: 10 saves an hour per member and 300 an hour site-wide, 20 reports a day,
  hidden after reports from 3 members, makers signed in with GitHub can't review their own agent, names shown as
  "Ada L.", text escaped, invisible characters stripped, at most 2 links. `/admin/reviews` lists reported reviews first
  with Hide, Show again and Delete. Reviews on a listing move to the tested agent's page once it is matched (daily sync).
  Live only once a sign-in option is set up in Vercel: none is yet (no Google, GitHub, LinkedIn or email keys).

## Waiting on Rob

1. Buy the domains agentparrot.ai and agentparrots.com (about $170, Rob buys them on Cloudflare himself).
   Adding one to Vercel is what makes the site public.
2. Sign-in apps (Google, GitHub, LinkedIn) and the email settings in `.env.example`. Reviews need at least one of these. The Claude API key is in (22 Nov 2026).
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
