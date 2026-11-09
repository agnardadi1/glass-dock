// The companion panel's page: clock and weather, what's playing, graphs of the PC over the last
// ten minutes, clipboard history and downloads. Data comes from the main process.
const api = window.dockApi;
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let S = null, media = null, mediaAt = performance.now(), history = [], clips = [], weather = null;

// ---------- look: the same tint and glow as the dock ----------
const TINTS = { glass: null, graphite: '30 32 38', frost: '214 230 255', rose: '255 122 168', aurora: '56 196 168', ember: '255 138 60' };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return `${n >> 16} ${(n >> 8) & 255} ${n & 255}`; };
function applySettings(all) {
  S = all;
  const L = all.look || {}, c = all.companion || {}, d = $('panel').style;
  const t = L.tint === 'custom' ? hexRgb(L.custom) : TINTS[L.tint];
  if (t) d.setProperty('--tint', t); else d.removeProperty('--tint');
  d.setProperty('--alpha', Math.min(0.96, (L.alpha || 0.62) + 0.2));
  if (L.glow && L.glow !== 'off') { d.setProperty('--glow', (L.glowSize || 22) + 'px'); d.setProperty('--glow-c', L.glowCol || '#7aa8ff'); } else { d.removeProperty('--glow'); d.removeProperty('--glow-c'); }
  document.body.classList.toggle('top', c.side === 'top');
  const sec = c.sections || {};
  $('secClock').hidden = sec.clock === false;
  $('secMusic').hidden = sec.music === false;
  $('secStats').hidden = sec.stats === false;
  $('secClips').hidden = sec.clips === false;
  $('secDl').hidden = sec.downloads === false;
  document.documentElement.style.zoom = String(c.scale || 1);
}
api.onSettings(applySettings);

// ---------- clock ----------
function tickClock() {
  const n = new Date();
  const t = n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]\.?M\.?$/i, '');
  if ($('time').textContent !== t) $('time').textContent = t;
  const dt = n.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  if ($('date').textContent !== dt) $('date').textContent = dt;
}
tickClock(); setInterval(tickClock, 1000);

api.onWeather((w) => {
  weather = w;
  const box = $('wx');
  if (!w || w.error || w.temp == null) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `${wIcon(w.code, w.day)}<span class="num">${Math.round(w.temp)}°</span><span class="small">${esc(wKind(w.code)[1])}${w.place ? ' · ' + esc(w.place) : ''}</span>`;
});
function wKind(c) {
  if (c === 0) return ['clear', 'Clear'];
  if (c <= 2) return ['partly', c === 1 ? 'Mostly clear' : 'Partly cloudy'];
  if (c === 3) return ['cloud', 'Cloudy'];
  if (c === 45 || c === 48) return ['fog', 'Fog'];
  if (c >= 51 && c <= 57) return ['rain', 'Drizzle'];
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return ['rain', c >= 80 ? 'Showers' : 'Rain'];
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ['snow', 'Snow'];
  if (c >= 95) return ['storm', 'Thunderstorm'];
  return ['cloud', 'Cloudy'];
}
function wIcon(code, day = true) {
  const k = wKind(code)[0];
  const sun = day ? '<circle cx="9" cy="9" r="4" fill="#ffd60a"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="#ffd60a" stroke-width="1.6" stroke-linecap="round"/>'
    : '<path d="M12 3a6.5 6.5 0 1 0 7 8.2A5.2 5.2 0 0 1 12 3z" fill="#9aa3b5"/>';
  const cloud = (y = 0, fill = '#b9bfcc') => `<path d="M7 ${19 + y}h10.5a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.3 1.4A2.9 2.9 0 0 0 7 ${19 + y}z" fill="${fill}"/>`;
  const parts = {
    clear: day ? '<circle cx="12" cy="12" r="4.5" fill="#ffd60a"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke="#ffd60a" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M14 4a8 8 0 1 0 6 11.5A6.5 6.5 0 0 1 14 4z" fill="#9aa3b5"/>',
    partly: sun + cloud(), cloud: cloud(-1, '#8f97a8') + cloud(),
    fog: '<path d="M4 9h16M6 13h12M4 17h16" stroke="#9aa3b5" stroke-width="2" stroke-linecap="round"/>',
    rain: cloud(-4) + '<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="#64d2ff" stroke-width="1.8" stroke-linecap="round"/>',
    snow: cloud(-4) + '<g fill="#dfe6f3"><circle cx="9" cy="20" r="1.2"/><circle cx="13" cy="21" r="1.2"/><circle cx="17" cy="20" r="1.2"/></g>',
    storm: cloud(-4) + '<path d="M13 16l-3 4h3l-1.5 3.5" stroke="#ffd60a" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  return `<svg viewBox="0 0 24 24">${parts[k]}</svg>`;
}

// ---------- music ----------
const fmtTime = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const appLabel = (a) => { const s = String(a || '').toLowerCase(); if (s.includes('spotify')) return 'Spotify'; if (s.includes('chrome')) return 'Chrome'; if (s.includes('brave')) return 'Brave'; if (s.includes('msedge')) return 'Edge'; if (s.includes('firefox')) return 'Firefox'; if (s.includes('zune') || s.includes('media')) return 'Media Player'; return ''; };
const mediaPos = () => (media ? media.pos + (media.playing ? (performance.now() - mediaAt) / 1000 : 0) : 0);
const seek = $('seek');
function renderMedia() {
  const m = media;
  const none = !m || m.none;
  $('mTitle').textContent = none ? 'Nothing playing' : m.title || 'Unknown';
  $('mArtist').textContent = none ? '' : m.artist || '';
  $('mApp').textContent = none ? '' : appLabel(m.app);
  $('art').style.backgroundImage = !none && m.art ? `url('${m.art}')` : '';
  $('playIco').innerHTML = !none && m.playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  const hasLen = !none && m.len > 0;
  $('scrub').hidden = !hasLen;
  if (hasLen) { seek.max = m.len; $('lenT').textContent = fmtTime(m.len); }
}
api.onMedia((m) => { media = m; mediaAt = performance.now(); renderMedia(); });
setInterval(() => {
  if (!media || media.none || !(media.len > 0) || seek.dragging) return;
  const p = Math.min(media.len, mediaPos());
  seek.value = p; $('posT').textContent = fmtTime(p);
}, 500);
seek.addEventListener('input', () => { seek.dragging = true; $('posT').textContent = fmtTime(+seek.value); });
seek.addEventListener('change', () => { seek.dragging = false; api.media('seek ' + seek.value); if (media) { media.pos = +seek.value; mediaAt = performance.now(); } });
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
  const cmd = b.dataset.cmd;
  if (cmd === 'toggle' && (!media || media.none)) { api.islandResume(); return; }
  api.media(cmd);
  if (cmd === 'toggle' && media) { media.pos = mediaPos(); mediaAt = performance.now(); media.playing = !media.playing; renderMedia(); }
}));

// ---------- stats graphs ----------
const fmtGB = (b) => (b / 1073741824).toFixed(1);
const tempColor = (t) => (t >= 80 ? 'var(--red)' : t >= 70 ? 'var(--orange)' : 'var(--green)');
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function drawGraph(canvas, values, max, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pts = values.filter((v) => v != null);
  if (pts.length < 2) return;
  const n = 400; // ten minutes at 1.5 s
  const step = w / (n - 1);
  const x0 = w - (pts.length - 1) * step;
  ctx.beginPath();
  pts.forEach((v, i) => { const x = x0 + i * step, y = h - 2 - (h - 4) * Math.min(1, v / max); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(x0, h); ctx.closePath();
  ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
}
function renderStats() {
  const last = history[history.length - 1];
  if (!last) return;
  const accent = cssVar('--accent') || '#2f6fe0';
  $('vCpu').textContent = last.cpu != null ? last.cpu + '%' : '—';
  $('vGpu').textContent = last.gpu != null ? last.gpu + '%' : '—';
  $('vTemp').textContent = last.gpuTemp != null ? last.gpuTemp + '°' : '—';
  $('vTemp').style.color = last.gpuTemp != null ? tempColor(last.gpuTemp) : '';
  $('vRam').textContent = `${fmtGB(last.ramUsed)} / ${fmtGB(last.ramTotal)} GB`;
  $('gpuName').textContent = last.gpuName ? last.gpuName.replace(/^NVIDIA\s+/i, '') : '';
  const pick = (k) => history.map((s) => (k === 'ram' ? 100 * s.ramUsed / s.ramTotal : s[k]));
  for (const c of document.querySelectorAll('#graphs canvas')) {
    const k = c.dataset.k;
    const color = k === 'gpuTemp' ? (last.gpuTemp != null ? cssVar(tempColor(last.gpuTemp).slice(4, -1)) || accent : accent) : accent;
    drawGraph(c, pick(k), k === 'gpuTemp' ? 100 : 100, color);
  }
}
api.onStats((st) => { history.push(st); while (history.length > 400) history.shift(); renderStats(); });
api.onStatsHistory((h) => { history = (h || []).slice(-400); renderStats(); });
window.addEventListener('resize', renderStats);

// ---------- clipboard ----------
function renderClips() {
  const box = $('clipList');
  if (!clips.length) { box.innerHTML = '<div class="small">Nothing copied yet.</div>'; return; }
  box.innerHTML = clips.map((c) => `<button class="clip" data-id="${c.id}">${c.type === 'image' ? `<img src="${c.thumb}" alt=""><span class="small">${c.width}×${c.height} image</span>` : `<span class="t">${esc(c.text)}</span>`}</button>`).join('');
}
api.onClips((list) => { clips = list || []; renderClips(); });
$('clipList').addEventListener('click', (e) => {
  const b = e.target.closest('.clip'); if (!b) return;
  api.companionClip(+b.dataset.id);
  b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 900);
});

// ---------- downloads, game session ----------
api.onDownloads((list) => {
  const box = $('dlList');
  if (!list || !list.length) { box.textContent = 'No downloads running.'; box.className = 'small'; return; }
  box.className = '';
  box.innerHTML = list.map((d) => `<div class="dlrow"><span class="spin"></span><span class="ell">${esc(d.name)}</span><span class="small num">${d.size > 1048576 ? (d.size / 1048576).toFixed(1) + ' MB' : Math.round(d.size / 1024) + ' kB'}</span></div>`).join('');
});
api.onSession((d) => {
  const bits = [];
  if (d.avgFps != null) bits.push(`${d.avgFps} fps avg`);
  if (d.lowFps != null) bits.push(`1% low ${d.lowFps}`);
  if (d.maxTemp != null) bits.push(`GPU up to ${d.maxTemp}°`);
  const len = d.minutes >= 60 ? `${Math.floor(d.minutes / 60)} h ${d.minutes % 60} min` : `${d.minutes} min`;
  const box = $('sessionBox');
  box.hidden = false;
  box.innerHTML = `<div class="session"><b>Last game: ${esc(d.name || 'Game')} · ${len}</b><span class="small">${esc(bits.join(' · ')) || 'No readings'}</span></div>`;
});
