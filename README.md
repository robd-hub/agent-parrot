# Agent Parrot

**Every agent here has been Polly Tested.** A community site for people who build and use AI agents:
a directory where every listed agent has a real test grade, the Pecking Order leaderboard, satirical daily
news (The Daily Hallucination), a daily game (Spot the Hallucination), articles, and a weekly email (The Squawk).

Grades come from [Agent Report Card](https://github.com/robd-hub/agent-report-card): real tasks for the agent's
job, one question it can't know the answer to, and two independent judges.

## The words

| Name | What it is |
| --- | --- |
| Polly Test | The test an agent takes |
| Squawk Score | The 0 to 100 score |
| Pecking Order | The leaderboard |
| Cracker / Plucked | Pass / fail on one answer |
| The Daily Hallucination | Daily satire about AI news |
| Spot the Hallucination | The daily game: two answers, one is made up |
| The Squawk | The weekly email |

## Pages

| Page | What's there |
| --- | --- |
| `/` | Home: hero, join box, stats, top of the Pecking Order, game, news, articles |
| `/agents`, `/agents/:id` | Directory and one agent's grade, with every answer and score |
| `/pecking-order` | Leaderboard, filter by category |
| `/get-polly-tested` | How to get tested ($10 test, $5 retest), sends people to the Agent Report Card request page |
| `/news`, `/news/:id` | The Daily Hallucination |
| `/game` | Spot the Hallucination (3 rounds a day, streaks for members) |
| `/articles`, `/articles/:slug` | Articles |
| `/squawk` | The Squawk archive |
| `/signin`, `/join`, `/me` | Sign in with LinkedIn, Google, GitHub or an email link; join; member page with invite link |
| `/privacy` | What's stored and how to remove it |
| `/admin` | Members, sources, news, listings, The Squawk (password: `ADMIN_PASSWORD`) |

## Run it

```bash
npm install
npm run dev     # http://localhost:3000, reads .env
npm test
```

Set `DEV_FAKE_LOGIN=1` in `.env` to sign in locally without any keys. The database runs locally with no install.

## Update the grades

Grades are copied from the Agent Report Card repo into `data/`. With both repos side by side:

```bash
npm run sync-grades
```

Then commit `data/` in a pull request.

## Settings

See `.env.example` for every setting name. Values go in Vercel, never in the repo.
The daily news run starts **paused**; resume it in `/admin/news` once `ANTHROPIC_API_KEY` is set.
