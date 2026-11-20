# Agent Parrot handover (20 Nov 2026)

## Where things stand
- Repo: robd-hub/agent-parrot. The whole first version of the site is on branch `claude/project-thread-7wk4eq`.
  `main` is still empty, so no pull request exists yet. Next step: with Rob's OK, push a README-only starter
  `main`, then open the PR from the branch. Never merge without Rob's OK.
- Not deployed anywhere. Nothing bought. Domains chosen: agentparrot.ai and agentparrots.com (Rob buys them
  himself on Cloudflare).
- `npm test`: 14 tests, all passing.
- Business plan (Claude Doc): https://claude.ai/artifact/Cgr4y3TzZiDA9FfHg3SAwE
- Screenshots were saved in the old project's files (agent-parrot/ folder).

## Waiting on Rob
1. OK to create a starter `main` so the PR can open, then review and merge.
2. Buy the two domains (about $170 total).
3. Free Vercel project (team designimp-projects, Hobby; move to Pro about $20 a month once it takes money)
   plus a Neon database through Vercel's Storage tab.
4. Sign-in apps (Google, GitHub, LinkedIn), the Claude key and the other settings in `.env.example`. Rob adds
   the values in Vercel himself; never ask for them in chat.
5. Agent Parrot LinkedIn page, 20 builders to invite, a launch date.

## Notes
- The daily satire run starts paused; resume it at `/admin/news` once `ANTHROPIC_API_KEY` is set.
- Grades come from the agent-report-card repo via `npm run sync-grades` (both repos side by side).
- Paid tests go to the Agent Report Card request page (`GRADER_URL`, default https://grader.designimp.com).
- Hackathon entries, listings and registries keep the Agent Report Card name; the parrot names are this site only.
