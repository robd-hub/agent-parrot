# CLAUDE.md

Guidance for any AI coding agent working in this repo (Claude Code, Google Antigravity or another).
Read this file and `HANDOVER.md` before starting: this one is the rules, `HANDOVER.md` is where things stand.

## What this is

**Agent Parrot** ("Every agent here has been Polly Tested.") is a community site for people who build and use
AI agents. Built from the Bullwhip codebase (robd-hub/supply-chain-talent), same stack and conventions.
Planned domains: agentparrot.ai and agentparrots.com (Rob buys them himself; don't buy anything).

## Who you're working with

Rob owns the project. He is not a developer: explain git and GitHub in plain words, build and show rather than
list options, and show screenshots or links. Never merge or publish without Rob's OK. Never ask Rob to paste a
secret into chat; env values never go in the repo, a PR or chat.

## Stack

Node 24, ES modules, Express 5, HTML from template strings in `src/*views.js`, no framework or build step.
Postgres via `pg` on Vercel (Neon), PGlite locally and in tests (`./.data/pg`). Vercel Cron calls
`/api/cron/hallucination` at 06:00 UTC and `/api/cron/directories` at 05:00 UTC. Claude API writes The Daily Hallucination (`src/hallucination.js`).

## Commands

```bash
npm install         # once
npm run dev         # http://localhost:3000, reloads on save, reads .env if present
npm test            # node --test, every file in test/ (25 tests, all should pass)
npm run sync-grades # copy grades from ../agent-report-card/data into data/ (both repos side by side)
npm start           # what Vercel runs
```

- Copy `.env.example` to `.env` for local runs. Set `DEV_FAKE_LOGIN=1` to sign in without any keys.
- No database install needed locally: PGlite writes to `./.data/pg` (git-ignored). Tests use a fresh one.
- Missing keys switch features off quietly (sign-in buttons hide, the satire run stays idle), so the site runs with none.

## Deploying

- Vercel project `agent-parrot` on team designimp-projects, production branch `main`. Every merge to `main`
  deploys to https://agent-parrot.vercel.app on its own; every PR gets a preview link.
- That address is behind Vercel's login (team default) until a custom domain is added, so only team members see it.
- Neon Postgres is connected through Vercel (`DATABASE_URL`). Env values are set in Vercel by Rob, never in files.
- Crons are in `vercel.json`. They only check `CRON_SECRET` once it is set in Vercel.

## File map

| File | What's in it |
| --- | --- |
| `src/index.js` | Reads env vars into `config`, connects the database, exports the app |
| `src/routes.js` | All routes |
| `src/views.js` | Layout, nav, most pages. `BRAND`, `TAGLINE`, `SLOGAN` |
| `src/admin-views.js` | Admin pages |
| `src/db.js` | Tables and every query |
| `src/agents.js` | Loads `data/agents.json`: directory, Pecking Order, stats |
| `src/hallucination.js` | Daily satire and the "Polly Tested" fact box |
| `src/game.js` | Spot the Hallucination rounds |
| `src/articles.js` | Articles (hand-written HTML) |
| `src/squawk.js` | The Squawk weekly email |
| `src/oauth.js`, `src/linkedin.js` | Google, GitHub and LinkedIn sign-in |
| `src/session.js`, `src/email.js`, `src/news.js` | Cookies, email sending, RSS feeds |
| `src/directories.js` | Pulls agents in from the Official MCP Registry and ERC-8004 (daily cron `/api/cron/directories`), "Listed on" badges |
| `src/directory-routes.js`, `src/directory-views.js` | `/listed` (agents not Polly Tested yet) and `/admin/directories` |
| `src/feed.js` | Public grades feed: `/api/grades.json`, `/api/grades/<id>.json`, `/api/grades/lookup`, and the `/feed` page |
| `data/listed-on.json` | Hand-kept: where our own tested agents are registered, and entries never shown as untested |
| `scripts/sync-grades.mjs` | Copies grades from the Agent Report Card repo into `data/` |
| `public/` | `style.css`, `parrot.svg` (Polly, the signature parrot), `game.js`, icons |

## Conventions

- Plain Express handlers, template strings, SQL in `src/db.js`. No framework, ORM or build step without asking.
- Schema changes: `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` in `src/db.js`. Never drop data.
- Escape everything in HTML with `esc()`. Forms that change things are POSTs and same-origin checked.
- Add or update a test in `test/` for each change; keep `npm test` green.
- Grades shown must match Agent Report Card exactly; never edit `data/agents.json` by hand.
- Branches `claude/<something>` (or `antigravity/<something>` from Antigravity), a PR for every change,
  never push to `main` directly. Rob merges; never merge without his OK.
- Pull `main` before starting: Claude Code and Antigravity may both be working on the repo.
- Only match directory listings to tested agents by registry id or web address, never by name.

## Brand rules

- Name **Agent Parrot**, mascot **Polly**, slogan "Polly wants a grade". Green, yellow and red parrot colours.
- Hackathon entries, registries and listings keep the Agent Report Card name. The parrot names are this site only.
- Tone: friendly banter about agent life, work-safe. Satire never names real companies, products, models or people,
  and skips tragedies, crime and job losses. Facts about tested agents come only from the grade data.
