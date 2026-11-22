// Licence (is the code open source?) and a short data-privacy note, from data we already hold. Nothing is guessed:
// the licence comes from the agent's GitHub repo (src/activity.js reads it weekly) or a confirmed fact in
// data/agent-facts.json, and anything else is shown as not known.

const isGithub = (url) => /^https:\/\/github\.com\//.test(url ?? '');

// { known, open: true | false | null, text, note }
export function licenceInfo({ row, facts = {}, openserv = false } = {}) {
  if (facts.licence) return { known: true, open: facts.openSource ?? null, text: facts.licence, note: 'Confirmed by the maker' };
  const repo = row?.details?.repo ?? facts.repo ?? null;
  const a = row?.activity;
  if (isGithub(repo)) {
    if (!a) return { known: false, open: null, text: 'Not known yet', note: 'Read from its GitHub repository once a week' };
    if (!a.found) return { known: false, open: null, text: 'Not known', note: 'Its code repository was not found on GitHub' };
    if (a.license && a.license !== 'NOASSERTION') return { known: true, open: true, text: `Open source: ${a.license} licence`, note: 'From its GitHub repository' };
    if (a.license === 'NOASSERTION') return { known: true, open: null, text: 'Code is public, licence unclear', note: 'It has a licence file GitHub could not recognise' };
    return { known: true, open: false, text: 'Code is public, but has no licence', note: 'Without one, others have no clear right to reuse it' };
  }
  if (repo) return { known: false, open: null, text: 'Not known', note: 'Its code is not on GitHub, so we do not read the licence' };
  if (openserv) return { known: false, open: null, text: 'Not known', note: 'OpenServ marketplace agents do not publish their code' };
  return { known: false, open: null, text: 'Not known', note: 'No public code listed' };
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

// { policy: { text, url } | null, lines: [] } — lines are plain facts about where data goes.
export function privacyInfo({ row, facts = {}, openserv = false, x402 = false } = {}) {
  const lines = [];
  const host = hostOf(row?.endpoint);
  if (openserv) lines.push('What you send goes through the OpenServ marketplace to the agent.');
  else if (host) lines.push(`What you send goes to ${host}, run by the maker.`);
  if (x402 || row?.x402 || row?.health?.price) lines.push('Paying over x402 records your wallet address on a public blockchain.');
  const policy = facts.privacy || facts.privacyUrl ? { text: facts.privacy ?? 'Privacy policy', url: facts.privacyUrl ?? null } : null;
  return { policy, lines };
}
