// The game HUD's readout. Numbers come from the main process (stats.js); only the text changes, nothing
// re-animates, so it sits still over the game.
const api = window.dockApi;
const $ = (id) => document.getElementById(id);
let o = { show: {} };

const tempColor = (t) => (t >= 80 ? 'var(--red)' : t >= 70 ? 'var(--orange)' : 'var(--green)');
const gb = (mb) => (mb / 1024).toFixed(1);
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function applySettings(s) {
  o = s || {};
  const show = o.show || {};
  document.body.classList.toggle('left', (o.corner || 'tr').endsWith('l'));
  document.body.classList.toggle('bottom', (o.corner || 'tr').startsWith('b'));
  document.documentElement.style.setProperty('--alpha', String(o.opacity == null ? 0.8 : o.opacity));
  $('fpsRow').hidden = show.fps === false;
  $('lowWrap').hidden = show.low === false;
  $('gpuRow').hidden = show.gpu === false;
  $('gpuBar').hidden = show.gpu === false;
  $('cpuRow').hidden = show.cpu === false;
  $('vramRow').hidden = show.vram === false;
  $('clock').hidden = show.clock === false;
}

api.onHudSettings(applySettings);
api.onStats((st) => {
  const set = (id, v) => { const el = $(id); if (el && el.textContent !== v) el.textContent = v; };
  set('fps', st.fps != null ? String(st.fps) : (st.fpsSource ? '…' : '—'));
  $('fps').title = st.fps == null && !st.fpsSource ? 'Frame rate needs RivaTuner Statistics Server (MSI Afterburner) running' : '';
  set('low', st.low1 != null ? String(st.low1) : '—');
  if (st.gpu != null) { set('gpu', `${st.gpu}%`); $('gpuBar').firstElementChild.style.width = st.gpu + '%'; } else set('gpu', '—');
  if (st.gpuTemp != null) { set('gpuTemp', `${st.gpuTemp}°`); $('gpuTemp').style.color = tempColor(st.gpuTemp); } else set('gpuTemp', '—');
  set('cpu', st.cpu != null ? `${st.cpu}%` : '—');
  set('vram', st.vramUsed != null ? `${gb(st.vramUsed)} / ${gb(st.vramTotal)} GB` : '—');
  set('session', st.sessionMin != null ? (st.sessionMin >= 60 ? `${Math.floor(st.sessionMin / 60)} h ${st.sessionMin % 60} min` : `${st.sessionMin} min`) : '');
});
setInterval(() => { const c = clock(); if ($('clock').textContent !== c) $('clock').textContent = c; }, 1000);
$('clock').textContent = clock();
