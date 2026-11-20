# CLAUDE.md

Guidance for Claude Code working in this repo.

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
`/api/cron/hallucination` at 06:00 UTC. Claude API writes The Daily Hallucination (`src/hallucination.js`).

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
| `scripts/sync-grades.mjs` | Copies grades from the Agent Report Card repo into `data/` |
| `public/` | `style.css`, `parrot.svg` (Polly, the signature parrot), `game.js`, icons |

## Conventions

- Plain Express handlers, template strings, SQL in `src/db.js`. No framework, ORM or build step without asking.
- Schema changes: `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` in `src/db.js`. Never drop data.
- Escape everything in HTML with `esc()`. Forms that change things are POSTs and same-origin checked.
- Add or update a test in `test/` for each change; keep `npm test` green.
- Grades shown must match Agent Report Card exactly; never edit `data/agents.json` by hand.
- Branches `claude/<something>`, a PR for every change, never push to `main` directly.

## Brand rules

- Name **Agent Parrot**, mascot **Polly**, slogan "Polly wants a grade". Green, yellow and red parrot colours.
- Hackathon entries, registries and listings keep the Agent Report Card name. The parrot names are this site only.
- Tone: friendly banter about agent life, work-safe. Satire never names real companies, products, models or people,
  and skips tragedies, crime and job losses. Facts about tested agents come only from the grade data.
