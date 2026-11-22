// "Your badge" on the claim page: pick a look and a colour, see the badge redraw, copy the code.
(() => {
  const box = document.querySelector('.badge-tailor');
  if (!box) return;
  const { base, ref, link } = box.dataset;
  const colour = box.querySelector('#badge-accent');
  const DEFAULT = '#12b76a';
  let custom = false;
  const update = () => {
    const style = box.querySelector('input[name="badge-style"]:checked')?.value ?? 'dark';
    const q = new URLSearchParams({ ref });
    if (style !== 'flat') q.set('style', style);
    if (custom && colour.value.toLowerCase() !== DEFAULT) q.set('accent', colour.value.slice(1).toLowerCase());
    const img = `${base}?${q}`;
    box.querySelector('#badge-img').src = `/badge.svg?${q}`;
    box.querySelector('#badge-preview').className = `badge-preview badge-preview-${style}`;
    box.querySelector('#badge-md').value = `[![Agent Parrot](${img})](${link})`;
    box.querySelector('#badge-html').value = `<a href="${link}"><img src="${img}" alt="Agent Parrot"></a>`;
  };
  box.addEventListener('change', update);
  colour.addEventListener('input', () => { custom = true; update(); });
  box.querySelector('#badge-accent-reset').addEventListener('click', () => { colour.value = DEFAULT; custom = false; update(); });
})();
