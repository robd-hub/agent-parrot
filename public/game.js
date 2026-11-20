// Spot the Hallucination. The rounds come from the page (see gamePage in src/views.js).
// Progress is kept in this browser so a refresh doesn't lose it; signed-in members' scores are saved for streaks.
(() => {
  const root = document.getElementById('game');
  const data = JSON.parse(document.getElementById('game-data').textContent);
  const key = `ap-game-${data.gameNo}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(key)) || { picks: [] }; } catch { return { picks: [] }; } };
  const save = (s) => { try { localStorage.setItem(key, JSON.stringify(s)); } catch {} };
  const state = load();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function render() {
    root.replaceChildren();
    const i = state.picks.length;
    if (i >= data.rounds.length) return finish();
    const r = data.rounds[i];
    const head = el('p', 'eyebrow', `Round ${i + 1} of ${data.rounds.length}`);
    const q = el('div', 'game-question');
    q.append(el('p', 'small muted', 'The question'), el('p', 'q', r.question));
    const prompt = el('p', 'game-prompt', 'Which answer is hallucinating?');
    const grid = el('div', 'game-answers');
    r.answers.forEach((text, idx) => {
      const card = el('button', 'game-answer');
      card.type = 'button';
      card.append(el('span', 'label', idx === 0 ? 'Answer A' : 'Answer B'), el('span', 'text', text));
      card.addEventListener('click', () => reveal(idx));
      grid.append(card);
    });
    root.append(head, q, prompt, grid);
  }

  function reveal(pick) {
    const i = state.picks.length;
    const r = data.rounds[i];
    const right = pick === r.wrong;
    state.picks.push(right ? 1 : 0);
    save(state);
    const cards = root.querySelectorAll('.game-answer');
    cards.forEach((c, idx) => {
      c.disabled = true;
      c.classList.add(idx === r.wrong ? 'is-wrong' : 'is-right');
      if (idx === pick) c.classList.add('picked');
      c.querySelector('.label').textContent += idx === r.wrong ? ' · the hallucination' : ' · the real deal';
    });
    const box = el('div', `game-result ${right ? 'ok' : 'bad'}`);
    box.append(el('p', 'verdict', right ? 'Cracker! You spotted it.' : 'Plucked! That one was telling the truth.'),
      el('p', null, r.why), el('p', 'small muted', r.reveal));
    const next = el('button', 'btn', state.picks.length >= data.rounds.length ? 'See your score' : 'Next round');
    next.type = 'button';
    next.addEventListener('click', render);
    box.append(next);
    root.querySelector('.game-prompt').replaceWith(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function finish() {
    const score = state.picks.reduce((a, b) => a + b, 0);
    const total = data.rounds.length;
    const squares = state.picks.map((p) => (p ? '🟩' : '🟥')).join('');
    const share = `Spot the Hallucination #${data.gameNo} 🦜\n${squares} ${score}/${total}\n${location.origin}/game`;
    const box = el('div', 'card game-finish');
    box.append(el('p', 'eyebrow', `Spot the Hallucination #${data.gameNo}`),
      el('h2', null, score === total ? 'Perfect. Polly is impressed.' : score === 0 ? 'Polly fell for all of them too, once.' : `You spotted ${score} of ${total}.`),
      el('p', 'squares', squares));
    const streak = el('p', 'muted');
    box.append(streak);
    const actions = el('div', 'hero-actions');
    const copy = el('button', 'btn', 'Copy my result');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(share); copy.textContent = 'Copied!'; } catch { copy.textContent = 'Copy failed'; }
    });
    const x = el('a', 'btn ghost', 'Share on X');
    x.href = `https://x.com/intent/post?text=${encodeURIComponent(share)}`;
    x.target = '_blank';
    x.rel = 'noopener';
    const more = el('a', 'btn ghost', 'See the tested agents');
    more.href = '/agents';
    actions.append(copy, x, more);
    box.append(actions, el('p', 'small muted', 'New rounds tomorrow.'));
    root.replaceChildren(box);
    if (data.signedIn && !data.played && !state.sent) {
      try {
        const res = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correct: score }) });
        if (res.ok) {
          const { streak: n } = await res.json();
          state.sent = true;
          save(state);
          streak.textContent = n ? `Your streak: ${n} day${n === 1 ? '' : 's'}.` : '';
        }
      } catch {}
    } else if (!data.signedIn) {
      streak.innerHTML = '<a href="/signin">Join</a> to keep a streak.';
    }
  }

  render();
})();
