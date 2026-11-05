const api = window.dockApi;
const $ = (id) => document.getElementById(id);
const islandEl = $('island'), contentEl = $('content'), bubbleEl = $('bubble'), stageEl = $('stage');

// ---------- state ----------
let S = null;                 // island settings
let media = null, mediaAt = 0, lastPlayingAt = 0;
let snd = null;
let use = { mic: [], cam: [] };
let downloads = [];
let timer = null;             // { total, end, left, paused, done }
let transient = null;         // { kind, until, data }
let hover = false, hoverTimer = null;
let level = new Array(5).fill(0.2);
let weather = null, stats = null, clips = [];
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not saved */ } } };
let lastMedia = store.get('lastMedia', null);   // for "resume music"
let panel = store.get('panel', 'clock');        // which hover panel was used last
let copiedFlash = 0;
let game = null; // { on, name } while a game is in front
let gameMode = 'stats';

// The panels the quiet island can show when you hover it, in tab order
const PANELS = ['clock', 'weather', 'stats', 'resume', 'launch', 'clipboard', 'timer'];
const PANEL_SIZE = { clock: [340, 112], weather: [390, 160], stats: [390, 150], resume: [380, 104], launch: [400, 120], clipboard: [400, 182], timer: [360, 100] };
function panels() {
  if (!S) return [];
  return PANELS.filter((p) => (p === 'timer' ? S.timer : S.panels && S.panels[p]));
}
function currentPanel() { const ps = panels(); return ps.includes(panel) ? panel : ps[0]; }

const SIZES = {
  tiny: [120, 32, 16], compact: [236, 36, 18], wide: [340, 40, 20], card: [400, 158, 30], idleCard: [360, 118, 28], shot: [380, 196, 28],
};
const S2 = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"';
const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  speaker: `<svg class="ic" ${S2}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
  muted: `<svg class="ic" ${S2}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>`,
  headphones: `<svg class="ic big" ${S2}><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>`,
  mic: `<svg class="ic big" ${S2}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  down: '<svg class="ic" fill="none" stroke="#0a84ff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>',
  check: '<svg class="ic" fill="none" stroke="#30d158" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  bell: '<svg class="ic big" fill="none" stroke="#ff9f0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/></svg>',
  folder: `<svg ${S2}><path d="M3 7h6l2 2h10v10H3z"/></svg>`,
  close: `<svg ${S2}><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  plus: `<svg ${S2}><path d="M12 5v14M5 12h14"/></svg>`,
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]\.?M\.?$/i, '');
const appLabel = (a) => (/spotify/i.test(a) ? 'Spotify' : /chrome/i.test(a) ? 'Chrome' : /edge/i.test(a) ? 'Edge' : /firefox/i.test(a) ? 'Firefox' : /brave/i.test(a) ? 'Brave' : String(a || '').replace(/\.exe$/i, '').split('!')[0]);
// Registry names → readable app names ("C:#…#Discord.exe" → "Discord", "Microsoft.WindowsCamera_8wek…" → "WindowsCamera")
const useName = (k) => { const p = String(k).split('#').pop().replace(/\.exe$/i, ''); return p.includes('_') ? p.split('_')[0].split('.').pop() : p; };

function show(kind, ms, data) { transient = { kind, until: Date.now() + ms, data }; render(); }
function timerLeft() { return !timer ? 0 : timer.paused ? timer.left : timer.end - Date.now(); }

// ---------- what the island shows ----------
function live() {
  const out = [];
  if (S.timer && timer) out.push('timer');
  if (S.downloads && downloads.length) out.push('download');
  if (S.music && media && (media.playing || Date.now() - lastPlayingAt < 30000)) out.push('music');
  return out;
}

function view() {
  const now = Date.now();
  if (transient && transient.until < now && !(hover && ['shot', 'done', 'update'].includes(transient.kind))) transient = null;
  // In a game, only volume/device/workspace messages get through; otherwise a tiny stats pill
  if (game && game.on && gameMode !== 'normal' && !(transient && ['volume', 'device', 'ws'].includes(transient.kind))) {
    return { kind: 'game', size: 'compact', second: null, expanded: false };
  }
  const l = live();
  let kind = transient ? transient.kind : l[0] || 'idle';
  const second = transient ? l[0] : l[1];
  let size;
  if (kind === 'idle') {
    if (hover && panels().length) size = 'p-' + currentPanel();
    else size = S.idle === 'hide' && !privacyOn() ? 'gone' : 'tiny';
  } else if (kind === 'music') size = hover ? 'card' : 'compact';
  else if (kind === 'timer') size = hover || timer.done ? 'wide' : 'compact';
  else if (kind === 'download') size = hover ? 'wide' : 'compact';
  else if (kind === 'shot') size = 'shot';
  else size = 'wide'; // volume, device, done
  return { kind, size, second, expanded: ['card', 'wide', 'shot'].includes(size) || size.startsWith('p-') };
}
const privacyOn = () => S.privacy && (use.mic.length || use.cam.length);

function dotsHtml() {
  if (!privacyOn()) return '';
  return `<span class="dots">${use.cam.length ? '<b class="cam"></b>' : ''}${use.mic.length ? '<b class="mic"></b>' : ''}</span>`;
}
const barsHtml = (cls = '') => `<span class="bars ${cls}" id="bars"><i></i><i></i><i></i><i></i><i></i></span>`;
const artStyle = () => (media && media.art ? `style="background-image:url('${media.art}')"` : '');

function html(v) {
  const k = v.kind;
  if (k === 'idle') {
    if (v.size.startsWith('p-')) return panelHtml(currentPanel()) + tabsHtml();
    const temp = S.panels && S.panels.weather && weather && !weather.error
      ? `<span class="wx-mini">${wIcon(weather.code, weather.day, 14)}${Math.round(weather.temp)}°</span>` : '';
    const showClock = S.idle === 'clock';
    return `<div class="row center">${showClock ? `<span class="num" id="clockSmall" style="font-size:13px">${clock()}</span>` : ''}${showClock ? temp : ''}${dotsHtml()}</div>`;
  }
  if (k === 'music') {
    if (v.size === 'card') {
      return `<div class="row"><div class="art lg" ${artStyle()}></div>
          <div class="grow"><div class="label ell">${esc(media.title || 'Nothing playing')}</div><div class="small ell">${esc(media.artist || '')}${media.artist ? ' · ' : ''}${esc(appLabel(media.app))}</div></div>
          ${barsHtml()}</div>
        ${media.len > 0 ? `<div class="scrub"><span class="num" id="posT"></span><input type="range" id="seek" min="0" max="${media.len}" step="1" aria-label="Song position"><span class="num">${fmtTime(media.len)}</span></div>` : ''}
        <div class="ctrls"><button class="icon-btn" data-act="prev" aria-label="Previous">${I.prev}</button><button class="icon-btn lg" data-act="toggle" aria-label="Play or pause">${media.playing ? I.pause : I.play}</button><button class="icon-btn" data-act="next" aria-label="Next">${I.next}</button></div>`;
    }
    const prog = media.len > 0 ? '<span class="mini-prog"><i id="miniProg"></i></span>' : '';
    return `<div class="row"><div class="art sm" ${artStyle()}></div><div class="grow">${prog}</div>${dotsHtml()}${barsHtml()}</div>`;
  }
  if (k === 'timer') {
    const ring = `<svg class="ic ring" viewBox="0 0 24 24"><circle class="bg" cx="12" cy="12" r="9"/><circle class="fg" id="ringFg" cx="12" cy="12" r="9" stroke-dasharray="56.55" stroke-dashoffset="0"/></svg>`;
    if (timer.done) return `<div class="row">${I.bell}<div class="grow label">Time's up</div><button class="btn blue" data-act="timer-ok">OK</button></div>`;
    if (v.size === 'wide') {
      return `<div class="row">${ring}<b class="num" id="tTime" style="color:var(--orange);font-size:17px">${fmtTime(timerLeft() / 1000)}</b><div class="grow"></div>
        <button class="icon-btn" data-act="timer-add" aria-label="Add one minute" title="+1 minute">${I.plus}</button>
        <button class="icon-btn" data-act="timer-pause" aria-label="${timer.paused ? 'Resume' : 'Pause'}">${timer.paused ? I.play : I.pause}</button>
        <button class="icon-btn" data-act="timer-cancel" aria-label="Cancel timer">${I.close}</button></div>`;
    }
    return `<div class="row">${ring}<div class="grow"></div>${dotsHtml()}<b class="num" id="tTime" style="color:var(--orange)">${fmtTime(timerLeft() / 1000)}</b></div>`;
  }
  if (k === 'download') {
    const d = downloads[0];
    if (v.size === 'wide') {
      return `<div class="row">${I.down}<div class="grow"><div class="label ell">${esc(d.name)}</div></div><span class="small num" id="dlText">${fmtSize(d.size)}${downloads.length > 1 ? ` · ${downloads.length} files` : ''}</span></div>`;
    }
    return `<div class="row">${I.down}<div class="grow"></div>${dotsHtml()}<span class="small num" id="dlText">${fmtSize(d.size)}</span></div>`;
  }
  if (k === 'done') {
    const d = transient.data;
    return `<div class="row">${I.check}<div class="grow"><div class="label ell">${esc(d.name)}</div></div>
      <button class="btn blue" data-act="dl-open">Open</button><button class="icon-btn" data-act="dl-show" aria-label="Show in folder" title="Show in folder">${I.folder}</button></div>`;
  }
  if (k === 'volume') {
    const st = transient.data;
    return `<div class="row">${st.mute ? I.muted : I.speaker}<div class="meter"><i style="width:${st.mute ? 0 : Math.round(st.vol * 100)}%"></i></div><span class="num small">${st.mute ? 'Muted' : Math.round(st.vol * 100) + '%'}</span></div>`;
  }
  if (k === 'device') {
    const d = transient.data;
    return `<div class="row">${d.input ? I.mic : I.headphones}<div class="grow"><div class="small">${d.input ? 'Microphone' : 'Sound now plays on'}</div><div class="label ell">${esc(d.name)}</div></div></div>`;
  }
  if (k === 'game') {
    const t = stats && stats.gpuTemp != null ? `<span class="num" id="gTemp" style="color:${stats.gpuTemp >= 80 ? 'var(--red)' : stats.gpuTemp >= 70 ? 'var(--orange)' : 'var(--green)'}">${stats.gpuTemp}°</span>` : '';
    const u = stats && stats.gpu != null ? `<span class="small num" id="gUse">GPU ${stats.gpu}%</span>` : stats && stats.cpu != null ? `<span class="small num" id="gUse">CPU ${stats.cpu}%</span>` : '';
    return `<div class="row"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.6 5.9A3 3 0 0 0 7.2 17l1.8-2h6l1.8 2a3 3 0 0 0 5.1-2.5l-.6-5.9A4 4 0 0 0 17.3 5z"/></svg>${t}${u}<div class="grow"></div><span class="num" id="clockSmall" style="font-size:13px">${clock()}</span></div>`;
  }
  if (k === 'update') {
    return `<div class="row"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg><div class="grow"><div class="label">Glass Dock ${esc(transient.data.version)} is ready</div><div class="small">Restart the dock to update</div></div><button class="btn blue" data-act="update">Restart</button></div>`;
  }
  if (k === 'ws') {
    const d = transient.data;
    const sub = d.phase === 'start' ? `Opening ${d.count} window${d.count === 1 ? '' : 's'}…` : d.missing && d.missing.length ? `Ready · couldn't open ${esc(d.missing.join(', '))}` : 'Ready';
    return `<div class="row"><span style="font-size:22px;line-height:1">${esc(d.icon)}</span><div class="grow"><div class="label ell">${esc(d.name)}</div><div class="small ell">${sub}</div></div>${d.phase === 'start' ? '<span class="spin"></span>' : I.check}</div>`;
  }
  if (k === 'shot') {
    const d = transient.data;
    return `<div class="shot" id="shotImg" draggable="true" title="Drag into any app" style="background-image:url('${d.thumb}')"></div>
      <div class="row"><div class="grow"><div class="label">${d.saved ? 'Saved to Pictures › Screenshots' : 'Screenshot copied'}</div><div class="small">${d.width} × ${d.height} · drag it into any app</div></div>
      ${d.saved ? '' : '<button class="btn blue" data-act="shot-save">Save</button>'}</div>`;
  }
  return '';
}

// ---------- hover panels ----------
const TAB_ICON = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  weather: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19V11M10 19V5M15 19v-6M20 19V9"/></svg>',
  resume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  launch: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/></svg>',
};
const TAB_NAME = { clock: 'Clock', weather: 'Weather', stats: 'PC stats', resume: 'Music', launch: 'Quick launch', clipboard: 'Clipboard', timer: 'Timer' };
function tabsHtml() {
  const ps = panels();
  if (ps.length < 2) return '';
  const cur = currentPanel();
  return `<div class="tabs">${ps.map((p) => `<button class="tab" data-act="panel" data-p="${p}" aria-pressed="${p === cur}" aria-label="${TAB_NAME[p]}" title="${TAB_NAME[p]}">${TAB_ICON[p]}</button>`).join('')}</div>`;
}

// Weather codes from Open-Meteo (WMO) → picture + words
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
function wIcon(code, day = true, size = 20) {
  const k = wKind(code)[0];
  const sun = day ? '<circle cx="9" cy="9" r="4" fill="#ffd60a"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="#ffd60a" stroke-width="1.6" stroke-linecap="round"/>'
    : '<path d="M12 3a6.5 6.5 0 1 0 7 8.2A5.2 5.2 0 0 1 12 3z" fill="#e6e8f0"/>';
  const cloud = (y = 0, fill = '#e6e8f0') => `<path d="M7 ${19 + y}h10.5a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.3 1.4A2.9 2.9 0 0 0 7 ${19 + y}z" fill="${fill}"/>`;
  const parts = {
    clear: day
      ? '<circle cx="12" cy="12" r="4.5" fill="#ffd60a"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke="#ffd60a" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M14 4a8 8 0 1 0 6 11.5A6.5 6.5 0 0 1 14 4z" fill="#e6e8f0"/>',
    partly: sun + cloud(),
    cloud: cloud(-1, '#b9bfcc') + cloud(),
    fog: '<path d="M4 9h16M6 13h12M4 17h16" stroke="#c7ccd6" stroke-width="2" stroke-linecap="round"/>',
    rain: cloud(-4) + '<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="#64d2ff" stroke-width="1.8" stroke-linecap="round"/>',
    snow: cloud(-4) + '<g fill="#fff"><circle cx="9" cy="20" r="1.2"/><circle cx="13" cy="21" r="1.2"/><circle cx="17" cy="20" r="1.2"/></g>',
    storm: cloud(-4) + '<path d="M13 16l-3 4h3l-1.5 3.5" stroke="#ffd60a" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  return `<svg class="wx" width="${size}" height="${size}" viewBox="0 0 24 24">${parts[k]}</svg>`;
}

const fmtGB = (b) => (b / 1073741824).toFixed(1);
function statsInner() {
  if (!stats) return '<div class="small">Measuring…</div>';
  const m = (label, pct, extra) => `<div class="stat"><span class="small">${label}</span><div class="meter"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%;background:${pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--orange)' : 'var(--green)'}"></i></div><span class="num small">${extra}</span></div>`;
  const ram = 100 * stats.ramUsed / stats.ramTotal;
  let out = m('CPU', stats.cpu, stats.cpu == null ? '…' : stats.cpu + '%');
  if (stats.gpu != null) {
    out += m('GPU', stats.gpu, `${stats.gpu}% · ${stats.gpuTemp}°C`);
    out += m('VRAM', 100 * stats.vramUsed / stats.vramTotal, `${(stats.vramUsed / 1024).toFixed(1)} / ${(stats.vramTotal / 1024).toFixed(0)} GB`);
  }
  out += m('RAM', ram, `${fmtGB(stats.ramUsed)} / ${fmtGB(stats.ramTotal)} GB`);
  return out;
}

function panelHtml(p) {
  if (p === 'clock') {
    return `<div class="row"><div class="grow"><div class="clock-big" id="clockBig">${clock()}</div>
      <div class="small">${esc(new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div>${dotsHtml()}</div>`;
  }
  if (p === 'weather') {
    if (!weather) return '<div class="row"><div class="small">Getting the weather…</div></div>';
    if (weather.error) return `<div class="row"><div class="grow"><div class="label">No weather right now</div><div class="small ell">${esc(weather.error)}</div></div></div>`;
    const u = weather.units === 'f' ? 'mph' : 'km/h';
    const days = weather.days.slice(0, 4).map((d, i) => `<div class="day"><span class="small">${i ? new Date(d.date + 'T12:00').toLocaleDateString([], { weekday: 'short' }) : 'Today'}</span>${wIcon(d.code, true, 20)}<span class="num small"><b style="color:var(--ink)">${Math.round(d.max)}°</b> ${Math.round(d.min)}°</span></div>`).join('');
    return `<div class="row">${wIcon(weather.code, weather.day, 40)}<div class="clock-big">${Math.round(weather.temp)}°</div>
      <div class="grow"><div class="label ell">${wKind(weather.code)[1]} · ${esc(weather.place)}</div><div class="small">Feels like ${Math.round(weather.feels)}° · wind ${Math.round(weather.wind)} ${u}</div></div></div>
      <div class="days">${days}</div>`;
  }
  if (p === 'stats') return `<div class="stats" id="statsBox">${statsInner()}</div>`;
  if (p === 'resume') {
    const m = media || lastMedia;
    if (!m || !m.title) return '<div class="row"><div class="grow"><div class="label">Nothing played yet</div><div class="small">Start something to see it here</div></div><button class="btn blue" data-act="resume">Open Spotify</button></div>';
    const art = m.art ? `style="background-image:url('${m.art}')"` : '';
    return `<div class="row"><div class="art lg" ${art}></div><div class="grow"><div class="small">${media && !media.playing ? 'Paused' : 'Last played'}</div>
      <div class="label ell">${esc(m.title)}</div><div class="small ell">${esc(m.artist || '')}</div></div>
      <button class="icon-btn lg play-big" data-act="resume" aria-label="Play">${I.play}</button></div>`;
  }
  if (p === 'launch') {
    const list = S.launch || [];
    if (!list.length) return '<div class="row"><div class="grow"><div class="label">No favourites yet</div><div class="small">Add apps and folders in Settings → Island</div></div></div>';
    return `<div class="launch">${list.slice(0, 8).map((x) => `<button class="app" data-act="launch" data-path="${esc(x.path)}" title="${esc(x.name)}">${x.icon ? `<img src="${x.icon}" alt="">` : `<b>${esc((x.name || '?')[0])}</b>`}<span class="ell">${esc(x.name)}</span></button>`).join('')}</div>`;
  }
  if (p === 'clipboard') {
    if (!clips.length) return '<div class="row"><div class="grow"><div class="label">Clipboard</div><div class="small">Copy some text or an image and it shows up here. Click one to copy it again.</div></div></div>';
    const flash = Date.now() - copiedFlash < 1200;
    return `<div class="row"><span class="label">${flash ? 'Copied ✓' : 'Recently copied'}</span></div><div class="clips">${clips.slice(0, 4).map((c) => c.type === 'text'
      ? `<button class="clip" data-act="clip" data-id="${c.id}"><span class="ell">${esc(c.text.replace(/\s+/g, ' ').trim())}</span></button>`
      : `<button class="clip" data-act="clip" data-id="${c.id}"><img src="${c.thumb}" alt=""><span class="small">Image ${c.width} × ${c.height}</span></button>`).join('')}</div>`;
  }
  if (p === 'timer') {
    return `<div class="row"><span class="label">Start a timer</span></div><div class="presets">${[5, 10, 15, 25, 45, 60].map((mm) => `<button class="btn" data-act="timer" data-min="${mm}">${mm} min</button>`).join('')}</div>`;
  }
  return '';
}

function bubbleHtml(kind) {
  if (kind === 'music') return `<div class="art" ${artStyle()}></div>`;
  if (kind === 'timer') return `<span id="bubbleT" style="color:var(--orange)">${Math.ceil(timerLeft() / 60000)}m</span>`;
  if (kind === 'download') return I.down;
  return '';
}

let lastSig = '';
function render() {
  if (!S) return;
  const v = view();
  const sig = JSON.stringify([v.kind, v.size, v.second, transient && transient.until, transient && transient.data && transient.data.saved,
    media && [media.title, media.artist, media.playing, !!media.art, media.len], timer && [timer.paused, timer.done], downloads.length, use.mic.length, use.cam.length, S.idle,
    v.size.startsWith('p-') || v.size === 'tiny' ? [currentPanel(), weather && [weather.temp, weather.code, weather.error], clips.map((c) => c.id).join(), copiedFlash, (S.launch || []).length] : 0]);
  if (sig === lastSig) return;
  const sizeChanged = !lastSig || JSON.parse(lastSig)[1] !== v.size || JSON.parse(lastSig)[0] !== v.kind;
  lastSig = sig;

  islandEl.classList.toggle('gone', v.size === 'gone');
  let [w, h, r] = SIZES[v.size] || SIZES.tiny;
  if (v.size.startsWith('p-')) {
    [w] = PANEL_SIZE[v.size.slice(2)];
    // fit the height to what the panel actually shows
    const m = $('measure');
    m.style.width = w + 'px';
    m.innerHTML = `<div class="content">${panelHtml(currentPanel())}</div>`;
    h = Math.ceil(m.firstChild.offsetHeight) + (panels().length > 1 ? 34 : 0);
    m.innerHTML = '';
    r = 30;
    const want = v.size === 'p-stats';
    if (want !== render.statsOn) { render.statsOn = want; api.islandStats(want); }
  } else if (v.kind === 'game') {
    if (!render.statsOn) { render.statsOn = true; api.islandStats(true); }
  } else if (render.statsOn) { render.statsOn = false; api.islandStats(false); }
  islandEl.style.width = w + 'px';
  islandEl.style.height = h + 'px';
  islandEl.style.borderRadius = r + 'px';
  islandEl.classList.toggle('card', ['card', 'shot'].includes(v.size) || v.size.startsWith('p-'));
  islandEl.classList.toggle('alarm', v.kind === 'timer' && timer && timer.done);
  islandEl.title = privacyOn() ? [use.cam.length ? 'Camera: ' + use.cam.map(useName).join(', ') : '', use.mic.length ? 'Microphone: ' + use.mic.map(useName).join(', ') : ''].filter(Boolean).join('\n') : '';
  contentEl.innerHTML = html(v);
  // keep the side bubble just beside the pill
  if (S.align === 'right') { bubbleEl.style.left = 'auto'; bubbleEl.style.right = (w + 8) + 'px'; }
  else if (S.align === 'left') { bubbleEl.style.left = (w + 8) + 'px'; bubbleEl.style.right = 'auto'; }
  else { bubbleEl.style.left = `calc(50% + ${w / 2 + 8}px)`; bubbleEl.style.right = 'auto'; }
  bubbleEl.style.top = Math.round((h - 32) / 2) + 'px';
  if (sizeChanged) { contentEl.classList.remove('enter'); void contentEl.offsetWidth; contentEl.classList.add('enter'); }

  // small extra bubble for a second activity, like the iPhone's split island
  const showBubble = v.second && v.size !== 'gone' && !v.expanded;
  bubbleEl.classList.toggle('gone', !showBubble);
  if (showBubble) bubbleEl.innerHTML = bubbleHtml(v.second);

  const shot = $('shotImg');
  if (shot) shot.addEventListener('dragstart', (e) => { e.preventDefault(); api.islandShotDrag(); });
  const seek = $('seek');
  if (seek) {
    seek.addEventListener('pointerdown', () => { seek.dragging = true; });
    seek.addEventListener('change', () => { seek.dragging = false; api.media('seek ' + seek.value); media.pos = +seek.value; mediaAt = performance.now(); });
  }
}

// ---------- clicks ----------
contentEl.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'update') { api.updateInstall(); return; }
  if (act === 'panel') { panel = b.dataset.p; store.set('panel', panel); render(); return; }
  if (act === 'clip') { api.islandClip(+b.dataset.id); copiedFlash = Date.now(); render(); setTimeout(() => { lastSig = ''; render(); }, 1300); return; }
  if (act === 'launch') { api.islandLaunch(b.dataset.path); hover = false; render(); return; }
  if (act === 'resume') {
    if (media && !media.playing) { api.media('toggle'); media.playing = true; mediaAt = performance.now(); lastPlayingAt = Date.now(); }
    else api.islandResume();
    hover = false; render(); return;
  }
  if (['prev', 'next', 'toggle'].includes(act)) {
    api.media(act);
    if (act === 'toggle' && media) { media.pos = mediaPos(); mediaAt = performance.now(); media.playing = !media.playing; lastSig = ''; render(); }
  }
  if (act === 'timer') { const ms = +b.dataset.min * 60000; timer = { total: ms, end: Date.now() + ms, left: ms, paused: false, done: false }; hover = false; render(); }
  if (act === 'timer-pause' && timer) {
    if (timer.paused) { timer.end = Date.now() + timer.left; timer.paused = false; } else { timer.left = timer.end - Date.now(); timer.paused = true; }
    lastSig = ''; render();
  }
  if (act === 'timer-add' && timer) { timer.end += 60000; timer.left += 60000; timer.total += 60000; }
  if (act === 'timer-cancel' || act === 'timer-ok') { timer = null; stopChime(); render(); }
  if (act === 'shot-save') { const file = await api.islandShotSave(); if (file && transient) { transient.data.saved = true; transient.until = Date.now() + 2500; render(); } }
  if (act === 'dl-open' && transient) { api.islandOpen(transient.data.path); transient = null; render(); }
  if (act === 'dl-show' && transient) { api.islandReveal(transient.data.path); transient = null; render(); }
});
islandEl.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); if (!hover) { hover = true; render(); } });
islandEl.addEventListener('mouseleave', () => {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    if ($('seek') && $('seek').dragging) return;
    hover = false; render();
  }, 350);
});

// ---------- live updates (every frame) ----------
const mediaPos = () => (media ? media.pos + (media.playing ? (performance.now() - mediaAt) / 1000 : 0) : 0);
let lastClock = '';
function frame() {
  if (S) {
    // timer
    if (timer && !timer.paused && !timer.done && Date.now() >= timer.end) { timer.done = true; chime(); render(); }
    const tt = $('tTime');
    if (tt && timer) tt.textContent = fmtTime(timerLeft() / 1000);
    const ring = $('ringFg');
    if (ring && timer) ring.setAttribute('stroke-dashoffset', (56.55 * (1 - Math.max(0, timerLeft()) / timer.total)).toFixed(2));
    const bt = $('bubbleT');
    if (bt && timer) bt.textContent = Math.ceil(timerLeft() / 60000) + 'm';
    // music position + bars
    const pos = mediaPos();
    if ($('posT')) $('posT').textContent = fmtTime(pos);
    const mp = $('miniProg');
    if (mp && media && media.len > 0) mp.style.width = Math.min(100, (pos / media.len) * 100).toFixed(2) + '%';
    const seek = $('seek');
    if (seek && !seek.dragging) seek.value = pos;
    updateBars();
    // clock
    const c = clock();
    if (c !== lastClock) { lastClock = c; if ($('clockSmall')) $('clockSmall').textContent = c; if ($('clockBig')) $('clockBig').textContent = c; }
    // expire transients
    if (transient && transient.until < Date.now()) render();
    // tell the main process where the pill is, so only the pill catches the mouse
    reportRect();
  }
  requestAnimationFrame(frame);
}
let lastRect = '';
function reportRect() {
  const r = islandEl.getBoundingClientRect();
  const gone = islandEl.classList.contains('gone');
  const sig = gone ? 'gone' : [r.x, r.y, r.width, r.height].map(Math.round).join(',');
  if (sig === lastRect) return;
  lastRect = sig;
  api.islandRect(gone ? { x: -999, y: -999, width: 0, height: 0 } : { x: r.x, y: r.y, width: r.width, height: r.height });
}
requestAnimationFrame(frame);

// ---------- music bars (react to the real sound when possible) ----------
let audio = null;
async function startAudio() {
  if (audio) return;
  audio = { starting: true };
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) throw new Error('no sound source');
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    ctx.createMediaStreamSource(stream).connect(an);
    audio = { ctx, an, stream, data: new Uint8Array(an.frequencyBinCount) };
  } catch (e) {
    console.error('[island] could not listen to the PC sound:', e && e.message);
    audio = { failed: true };
  }
}
function stopAudio() {
  if (!audio || audio.starting || audio.failed) return;
  audio.stream.getTracks().forEach((t) => t.stop());
  audio.ctx.close();
  audio = null;
}
const BANDS = [[40, 120], [120, 400], [400, 1200], [1200, 4000], [4000, 10000]];
function updateBars() {
  const bars = $('bars');
  const playing = media && media.playing;
  if (playing && S.music && !audio) startAudio();
  let target;
  if (playing && audio && audio.an) {
    const { an, data, ctx } = audio;
    an.getByteFrequencyData(data);
    const hz = ctx.sampleRate / an.fftSize;
    target = BANDS.map(([lo, hi]) => {
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.max(a + 1, Math.floor(hi / hz));
      let s = 0; for (let i = a; i < b; i++) s += data[i];
      return Math.min(1, Math.pow(s / (b - a) / 255, 1.3) * 1.6);
    });
  } else if (playing) {
    const t = performance.now() / 1000; // gentle fallback motion
    target = [0, 1, 2, 3, 4].map((i) => 0.35 + 0.3 * Math.abs(Math.sin(t * (2.1 + i * 0.7) + i)));
  } else {
    target = [0.2, 0.2, 0.2, 0.2, 0.2];
  }
  level = level.map((v, i) => v + (target[i] - v) * (target[i] > v ? 0.6 : 0.18));
  if (bars) bars.querySelectorAll('i').forEach((el, i) => { el.style.height = Math.round(18 + level[i] * 82) + '%'; });
}

// ---------- timer chime ----------
let chimeCtx = null, chimeTimer = null;
function chime() {
  try {
    chimeCtx = chimeCtx || new AudioContext();
    let n = 0;
    const beep = () => {
      const o = chimeCtx.createOscillator(), g = chimeCtx.createGain();
      o.frequency.value = n % 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, chimeCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, chimeCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, chimeCtx.currentTime + 0.35);
      o.connect(g).connect(chimeCtx.destination);
      o.start(); o.stop(chimeCtx.currentTime + 0.4);
      if (++n < 6) chimeTimer = setTimeout(beep, n % 2 ? 180 : 700);
    };
    beep();
  } catch { /* sound not available */ }
}
function stopChime() { clearTimeout(chimeTimer); }

// ---------- data from the main process ----------
api.onMedia((m) => {
  media = m && !m.none ? m : null;
  mediaAt = performance.now();
  if (media && media.playing) lastPlayingAt = Date.now();
  if (media && media.title) {
    const keep = { title: media.title, artist: media.artist, app: media.app, art: media.art && media.art.length < 400000 ? media.art : '' };
    if (!lastMedia || lastMedia.title !== keep.title || (!lastMedia.art && keep.art)) { lastMedia = keep; store.set('lastMedia', keep); }
  }
  if (!media || !media.playing) setTimeout(() => { if (!media || !media.playing) stopAudio(); }, 5000);
  render();
});
api.onSound((st) => {
  if (st.use) use = { mic: st.use.mic || [], cam: st.use.cam || [] };
  if (snd && S && S.volume) {
    const outNow = (st.out || []).find((d) => d.def), outBefore = (snd.out || []).find((d) => d.def);
    const inNow = (st.in || []).find((d) => d.def), inBefore = (snd.in || []).find((d) => d.def);
    if (outNow && outBefore && outNow.id !== outBefore.id) show('device', 2400, { name: outNow.name });
    else if (inNow && inBefore && inNow.id !== inBefore.id) show('device', 2400, { name: inNow.name, input: true });
    else if (Math.abs(st.vol - snd.vol) > 0.004 || st.mute !== snd.mute) {
      if (transient && transient.kind === 'volume') { transient.data = st; transient.until = Date.now() + 1500; lastSig = ''; }
      else show('volume', 1500, st);
    }
  }
  snd = st;
  render();
});
api.onUpdate((u) => show('update', 15000, u));
api.onGame((g) => { game = g; lastSig = ''; render(); });
api.onWorkspaceNote((m) => show('ws', m.phase === 'start' ? 20000 : 2200, m));
api.onWeather((w) => { weather = w; render(); });
api.onStats((st) => {
  const reshape = !stats || (stats.gpu == null) !== (st.gpu == null); // number of rows changed: refit the panel
  stats = st;
  if (game && game.on) { lastSig = ''; render(); return; }
  if (reshape) { lastSig = ''; render(); return; }
  const box = $('statsBox');
  if (box) box.innerHTML = statsInner();
});
api.onClips((list) => { clips = list || []; render(); });
api.onShot((d) => { if (S && S.shots) show('shot', 6000, d); });
api.onDownloads((list) => { downloads = list; render(); });
api.onDownloadDone((d) => { if (S && S.downloads) show('done', 7000, d); });

function applySettings(all) {
  S = all.island;
  gameMode = all.gameIsland || 'stats';
  stageEl.className = 'stage align-' + (S.align || 'center');
  if (!S.music) stopAudio();
  lastSig = '';
  render();
}
api.onSettings(applySettings);
api.getState().then(({ settings, media: m, sound: st }) => {
  applySettings(settings);
  if (m && !m.none) { media = m; mediaAt = performance.now(); if (m.playing) lastPlayingAt = Date.now(); }
  if (st) { snd = st; if (st.use) use = { mic: st.use.mic || [], cam: st.use.cam || [] }; }
  render();
});
