const api = window.dockApi;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

api.onStack((data) => {
  $('title').textContent = data.title;
  $('count').textContent = data.total > data.files.length ? `newest ${data.files.length} of ${data.total}` : `${data.total} item${data.total === 1 ? '' : 's'}`;
  const panel = $('panel');
  panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
  $('grid').innerHTML = data.files.length
    ? data.files.map((f, i) => `<button class="file" draggable="true" data-path="${esc(f.path)}" title="${esc(f.name)}" style="animation-delay:${i * 18}ms">
        ${f.icon ? `<img src="${f.icon}" alt="">` : `<span class="ph">${esc(f.name.split('.').pop().slice(0, 4).toUpperCase())}</span>`}
        <span class="name">${esc(f.name)}</span><span class="when">${ago(f.mtime)}</span></button>`).join('')
    : `<p class="empty">${data.error ? esc(data.error) : 'This folder is empty'}</p>`;
});

$('grid').addEventListener('click', (e) => { const b = e.target.closest('.file'); if (b) api.stackFile(b.dataset.path); });
$('grid').addEventListener('contextmenu', (e) => { const b = e.target.closest('.file'); if (b) { e.preventDefault(); api.stackReveal(b.dataset.path); } });
$('grid').addEventListener('dragstart', (e) => { const b = e.target.closest('.file'); if (b) { e.preventDefault(); api.stackDrag(b.dataset.path); } });
$('openFolder').addEventListener('click', () => api.stackFolder());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.stackClose(); });
