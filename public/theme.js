// Light and dark mode. The choice is saved on this device; the head script applies it before the page paints.
const root = document.documentElement;
const meta = document.querySelector('meta[name="theme-color"]');
const paint = () => { if (meta) meta.content = root.dataset.theme === 'dark' ? '#0b1210' : '#ffffff'; };
paint();
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  paint();
});
