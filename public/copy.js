// Copy buttons: <button data-copy="id-of-a-textarea">. Used on /admin/digest for the LinkedIn text.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const box = document.getElementById(btn.dataset.copy);
  if (!box) return;
  const label = btn.dataset.label ?? (btn.dataset.label = btn.textContent);
  try {
    await navigator.clipboard.writeText(box.value);
    btn.textContent = 'Copied!';
  } catch {
    box.select();
    btn.textContent = 'Press Ctrl+C (or ⌘C) to copy';
  }
  setTimeout(() => { btn.textContent = label; }, 2500);
});
