const api = window.dockApi;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('pw').focus();
$('pw').addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') return api.pvCancel();
  if (e.key !== 'Enter' || !$('pw').value) return;
  const r = await api.pvTry($('pw').value);
  $('pw').value = '';
  if (!r.ok) {
    $('msg').textContent = 'Wrong password';
    $('msg').classList.add('bad');
    const box = $('box');
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    return;
  }
  if (r.opening) return; // only one: it's opening
  if (!r.list.length) { $('msg').textContent = 'No private workspaces yet. Add one in Settings → Workspaces.'; $('msg').classList.remove('bad'); return; }
  $('pw').hidden = true;
  $('msg').textContent = 'Which one?';
  $('msg').classList.remove('bad');
  $('list').hidden = false;
  $('list').innerHTML = r.list.map((w) => `<button data-id="${esc(w.id)}"><span>${esc(w.icon)}</span>${esc(w.name)}</button>`).join('');
  $('list').querySelector('button').focus();
});
$('list').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) api.pvOpen(b.dataset.id); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.pvCancel(); });
