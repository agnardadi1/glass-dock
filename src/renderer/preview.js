const api = window.dockApi;
const strip = document.getElementById('strip');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
let count = 0;

api.onPreview((p) => {
  const icon = p.icon ? `<img src="${p.icon}" alt="">` : '<span></span>';
  strip.innerHTML = p.windows.map((w) => `<div class="win" role="button" tabindex="0" data-addr="${w.addr}" title="${esc(w.title)}">
      <div class="top">${icon}<span>${esc(w.title)}</span><button class="x" data-close="${w.addr}" aria-label="Close ${esc(w.title)}">${X}</button></div>
      <div class="shot" ${w.thumb ? `style="background-image:url('${w.thumb}')"` : ''}>${w.thumb ? '' : `${p.icon ? `<img src="${p.icon}" alt="">` : ''}<small>${w.minimized ? 'Minimised' : 'No preview'}</small>`}</div>
    </div>`).join('');
  if (p.windows.length !== count) { count = p.windows.length; api.previewSize(count); }
});

strip.addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if (x) { e.stopPropagation(); api.previewCloseWindow(x.dataset.close); x.closest('.win').style.opacity = '.4'; return; }
  const w = e.target.closest('.win');
  if (w) api.previewFocus(w.dataset.addr);
});
