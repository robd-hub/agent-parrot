// Lite Check result page: starts the check (it takes about a minute), then reloads to show the result.
(() => {
  const box = document.getElementById('lite-run');
  if (!box) return;
  const status = document.getElementById('lite-status');
  const say = (t) => { if (status) status.textContent = t; };
  let secs = 0;
  const timer = setInterval(() => say(`Still checking… ${(secs += 1)} seconds`), 1000);
  const reload = () => { clearInterval(timer); location.reload(); };
  if (box.dataset.start !== '1') {
    // Already running in another tab: look again in a few seconds.
    setTimeout(reload, 5000);
    return;
  }
  fetch(box.dataset.run, { method: 'POST', headers: { Accept: 'application/json' } })
    .then(reload)
    .catch(() => { clearInterval(timer); say("We lost touch with the check. Reload the page to see if it finished."); });
})();
