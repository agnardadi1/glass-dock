const api = window.dockApi;
const $ = (id) => document.getElementById(id);
let s;

const DEF_LOOK = { tint: 'glass', custom: '#7c5cff', alpha: 0.62, glow: 'off', glowCol: '#7aa8ff', glowSize: 22, glowArt: false, shape: 'rounded', icon: 'squircle', ind: 'dot', tiles: true };
const TINTS = { glass: null, graphite: '30 32 38', frost: '214 230 255', rose: '255 122 168', aurora: '56 196 168', ember: '255 138 60' };
const PRESETS = {
  Classic: {},
  Neon: { tint: 'graphite', alpha: 0.78, glow: 'neon', glowCol: '#ff3df2', glowSize: 26, shape: 'pill', ind: 'glow' },
  Minimal: { tint: 'frost', alpha: 0.35, shape: 'sharp', icon: 'square', ind: 'line', tiles: false },
  Party: { tint: 'graphite', alpha: 0.75, glow: 'music', glowArt: true, glowSize: 30, shape: 'pill', ind: 'glow' },
  Sunset: { tint: 'ember', alpha: 0.55, glow: 'pulse', glowCol: '#ff8a3c', glowSize: 24, shape: 'edge', icon: 'circle', ind: 'glow' },
};
const SEGS = [
  ['glowSeg', 'glow', [['off', 'Off'], ['soft', 'Soft'], ['neon', 'Neon'], ['pulse', 'Pulse'], ['music', 'Music']]],
  ['shapeSeg', 'shape', [['rounded', 'Rounded'], ['pill', 'Pill'], ['sharp', 'Sharp'], ['edge', 'Edge']]],
  ['iconSeg', 'icon', [['squircle', 'Squircle'], ['circle', 'Circle'], ['square', 'Square']]],
  ['indSeg', 'ind', [['dot', 'Dot'], ['line', 'Line'], ['glow', 'Glow']]],
];

const HIDE = [['off', 'Never'], ['fullscreen', 'Full screen'], ['smart', 'Smart'], ['always', 'Always']];
const HIDE_HINTS = {
  off: 'The dock always shows, and maximised windows stop above it.',
  fullscreen: 'The dock always shows, except over full-screen games and video. Maximised windows stop above it.',
  smart: 'The dock slides away when the window you\'re using touches it, and comes back when you move the mouse to the bottom edge.',
  always: 'The dock stays hidden until you move the mouse to the bottom edge of the screen.',
};

function save(patch) {
  s = { ...s, ...patch, look: { ...s.look, ...(patch.look || {}) } };
  sync();
  api.saveSettings(s);
}
const look = (patch) => save({ look: patch });

function build(info) {
  // tabs
  const tabs = document.querySelectorAll('.tabs button');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', x === t));
    $('paneLook').hidden = t.dataset.p !== 'look';
    $('paneBehave').hidden = t.dataset.p !== 'behave';
    $('paneIsland').hidden = t.dataset.p !== 'island';
    $('paneWorkspaces').hidden = t.dataset.p !== 'workspaces';
    $('paneGaming').hidden = t.dataset.p !== 'gaming';
    $('paneCompanion').hidden = t.dataset.p !== 'companion';
  }));
  // segmented controls
  for (const [id, key, opts] of SEGS) {
    $(id).innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
    $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) look({ [key]: b.dataset.v }); });
  }
  $('presets').innerHTML = Object.keys(PRESETS).map((k) => `<button type="button" data-v="${k}">${k}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) save({ look: { ...DEF_LOOK, ...PRESETS[b.dataset.v] } });
  });
  // colours
  $('tints').innerHTML = Object.entries(TINTS).map(([k, v]) =>
    `<button type="button" class="sw" data-v="${k}" aria-label="${k}" title="${k[0].toUpperCase() + k.slice(1)}" style="background:${v ? `rgb(${v})` : 'linear-gradient(135deg,#fff,#c9d2de)'}"></button>`).join('')
    + '<input type="color" id="customTint" aria-label="Custom colour" title="Custom colour">';
  $('tints').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (b) look({ tint: b.dataset.v }); });
  $('customTint').addEventListener('input', (e) => look({ tint: 'custom', custom: e.target.value }));
  $('alpha').addEventListener('input', (e) => look({ alpha: +e.target.value }));
  $('glowCol').addEventListener('input', (e) => look({ glowCol: e.target.value, glow: s.look.glow === 'off' ? 'soft' : s.look.glow }));
  $('glowSize').addEventListener('input', (e) => look({ glowSize: +e.target.value, glow: s.look.glow === 'off' ? 'soft' : s.look.glow }));
  $('tiles').addEventListener('change', (e) => look({ tiles: e.target.checked }));
  $('glowArt').addEventListener('change', (e) => look({ glowArt: e.target.checked, glow: s.look.glow === 'off' ? 'soft' : s.look.glow }));
  $('reset').addEventListener('click', () => save({ look: { ...DEF_LOOK } }));
  // behaviour
  $('size').addEventListener('input', (e) => save({ size: +e.target.value }));
  $('mag').addEventListener('input', (e) => save({ mag: +e.target.value }));
  $('magOn').addEventListener('change', (e) => save({ magOn: e.target.checked }));
  $('hotkeys').addEventListener('change', (e) => save({ hotkeys: e.target.checked }));
  $('gameIsland').innerHTML = [['stats', 'GPU temp + time'], ['hide', 'Hide it'], ['normal', 'Show everything']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('gameIsland').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) save({ gameIsland: b.dataset.v }); });
  for (const k of ['replaceTaskbar', 'minimizeToDock', 'media', 'soundButton', 'settingsButton', 'startButton', 'gameEdgeReveal', 'badges', 'stacks', 'gameMode', 'gameFps']) $(k).addEventListener('change', (e) => save({ [k]: e.target.checked }));
  $('hideSeg').innerHTML = HIDE.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('hideSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) save({ autoHide: b.dataset.v }); });
  // island
  const isl = (patch) => save({ island: { ...s.island, ...patch } });
  const ISW = { iOn: 'on', iFull: 'fullscreenHide', iMusic: 'music', iVolume: 'volume', iPrivacy: 'privacy', iShots: 'shots', iDownloads: 'downloads', iTimer: 'timer' };
  for (const [id, key] of Object.entries(ISW)) $(id).addEventListener('change', (e) => isl({ [key]: e.target.checked }));
  $('iAlign').innerHTML = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('iAlign').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) isl({ align: b.dataset.v }); });
  $('iIdle').innerHTML = [['hide', 'Hide it'], ['pill', 'Small pill'], ['clock', 'Pill with clock']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('iIdle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) isl({ idle: b.dataset.v }); });
  $('iTop').addEventListener('input', (e) => isl({ top: +e.target.value }));
  $('iScale').addEventListener('input', (e) => isl({ scale: +e.target.value }));
  $('iDisplay').innerHTML = '<option value="dock">Same screen as the dock</option><option value="mouse">The screen the mouse is on</option>'
    + info.displays.map((d) => `<option value="${d.id}">${d.label}${d.primary ? ' – main' : ''}</option>`).join('');
  $('iDisplay').addEventListener('change', (e) => isl({ display: e.target.value }));
  const PSW = { pClock: 'clock', pWeather: 'weather', pStats: 'stats', pResume: 'resume', pClipboard: 'clipboard', pLaunch: 'launch' };
  for (const [id, key] of Object.entries(PSW)) $(id).addEventListener('change', (e) => isl({ panels: { ...s.island.panels, [key]: e.target.checked } }));

  // gaming: HUD
  const hud = (patch) => save({ hud: { ...s.hud, ...patch } });
  $('gameSummary').addEventListener('change', (e) => save({ gameSummary: e.target.checked }));
  $('hudOn').addEventListener('change', (e) => hud({ on: e.target.checked }));
  $('hudCorner').innerHTML = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('hudCorner').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) hud({ corner: b.dataset.v }); });
  $('hudOpacity').addEventListener('input', (e) => hud({ opacity: +e.target.value }));
  $('hudScale').addEventListener('input', (e) => hud({ scale: +e.target.value }));
  const HSW = { hFps: 'fps', hLow: 'low', hGpu: 'gpu', hCpu: 'cpu', hVram: 'vram', hClock: 'clock' };
  for (const [id, key] of Object.entries(HSW)) $(id).addEventListener('change', (e) => hud({ show: { ...(s.hud.show || {}), [key]: e.target.checked } }));

  // companion panel
  const comp = (patch) => save({ companion: { ...s.companion, ...patch } });
  $('cOn').addEventListener('change', (e) => comp({ on: e.target.checked }));
  $('cDisplay').innerHTML = '<option value="">The screen that isn\'t the main one</option>' + info.displays.map((d) => `<option value="${d.id}">${d.label}${d.primary ? ' – main' : ''}</option>`).join('');
  $('cDisplay').addEventListener('change', (e) => comp({ display: e.target.value }));
  $('cSide').innerHTML = [['bottom', 'Bottom'], ['top', 'Top']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('cSide').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) comp({ side: b.dataset.v }); });
  $('cHeight').addEventListener('input', (e) => comp({ height: +e.target.value }));
  $('cScale').addEventListener('input', (e) => comp({ scale: +e.target.value }));
  $('cHideGame').addEventListener('change', (e) => comp({ hideInGame: e.target.checked }));
  const CSW = { cClock: 'clock', cMusic: 'music', cStats: 'stats', cClips: 'clips', cDl: 'downloads' };
  for (const [id, key] of Object.entries(CSW)) $(id).addEventListener('change', (e) => comp({ sections: { ...(s.companion.sections || {}), [key]: e.target.checked } }));
  let placeTimer;
  $('iPlace').addEventListener('input', (e) => { clearTimeout(placeTimer); placeTimer = setTimeout(() => isl({ weatherPlace: e.target.value.trim() }), 700); });
  $('iUnits').innerHTML = [['c', '°C'], ['f', '°F']].map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('');
  $('iUnits').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) isl({ units: b.dataset.v }); });
  $('addApp').addEventListener('click', async () => { const next = await api.islandLaunchAdd(false); if (next) { s = next; sync(); } });
  $('addFolder').addEventListener('click', async () => { const next = await api.islandLaunchAdd(true); if (next) { s = next; sync(); } });
  $('favs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const list = [...(s.island.launch || [])];
    list.splice(+b.dataset.i, 1);
    isl({ launch: list });
  });

  $('display').innerHTML = info.displays.map((d) => `<option value="${d.id}">${d.label}${d.primary ? ' – main' : ''}</option>`).join('');
  $('display').value = String(s.displayId || info.displays.find((d) => d.primary)?.id || '');
  $('display').addEventListener('change', (e) => save({ displayId: e.target.value }));
  $('login').checked = info.login;
  $('login').disabled = !info.packaged;
  $('loginHint').textContent = info.packaged
    ? 'The dock opens by itself when you sign in to Windows.'
    : 'Available once you install the dock with the installer (not while testing with npm start).';
  $('login').addEventListener('change', async (e) => { e.target.checked = await api.setLogin(e.target.checked); });
}

function sync() {
  const L = s.look;
  for (const [id, key] of SEGS) $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === L[key]));
  $('tints').querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === L.tint));
  $('customTint').value = L.custom;
  $('customTint').classList.toggle('on', L.tint === 'custom');
  $('alpha').value = L.alpha; $('alphaOut').textContent = Math.round(L.alpha * 100) + '%';
  $('glowCol').value = L.glowCol;
  $('glowSize').value = L.glowSize; $('glowOut').textContent = L.glowSize + ' px';
  $('tiles').checked = !!L.tiles;
  $('glowArt').checked = !!L.glowArt;
  $('glowHint').hidden = L.glow !== 'music';
  $('size').value = s.size; $('sizeOut').textContent = s.size + ' px';
  $('mag').value = s.mag; $('magOut').textContent = (+s.mag).toFixed(1) + '×';
  $('mag').disabled = !s.magOn;
  $('magOn').checked = s.magOn;
  $('hotkeys').checked = s.hotkeys;
  for (const k of ['replaceTaskbar', 'minimizeToDock', 'media', 'soundButton', 'settingsButton', 'startButton', 'gameEdgeReveal', 'badges', 'stacks', 'gameMode', 'gameFps']) $(k).checked = !!s[k];
  $('hideSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === s.autoHide));
  $('hideHint').textContent = HIDE_HINTS[s.autoHide] || '';
  $('gameIsland').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === (s.gameIsland || 'stats')));
  const I = s.island || {};
  const ISW = { iOn: 'on', iFull: 'fullscreenHide', iMusic: 'music', iVolume: 'volume', iPrivacy: 'privacy', iShots: 'shots', iDownloads: 'downloads', iTimer: 'timer' };
  for (const [id, key] of Object.entries(ISW)) $(id).checked = !!I[key];
  $('iAlign').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === I.align));
  $('iIdle').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === I.idle));
  $('iTop').value = I.top; $('iTopOut').textContent = I.top + ' px';
  $('iScale').value = I.scale; $('iScaleOut').textContent = Math.round(I.scale * 100) + '%';
  $('iDisplay').value = String(I.display || 'dock');
  const P = I.panels || {};
  const PSW = { pClock: 'clock', pWeather: 'weather', pStats: 'stats', pResume: 'resume', pClipboard: 'clipboard', pLaunch: 'launch' };
  for (const [id, key] of Object.entries(PSW)) $(id).checked = !!P[key];
  $('weatherOpts').hidden = !P.weather;
  // gaming
  $('gameSummary').checked = s.gameSummary !== false;
  const H = s.hud || {};
  $('hudOn').checked = !!H.on;
  $('hudCorner').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === (H.corner || 'tr')));
  $('hudOpacity').value = H.opacity == null ? 0.8 : H.opacity; $('hudOpacityOut').textContent = Math.round((H.opacity == null ? 0.8 : H.opacity) * 100) + '%';
  $('hudScale').value = H.scale || 1; $('hudScaleOut').textContent = Math.round((H.scale || 1) * 100) + '%';
  const HS = H.show || {};
  for (const [id, key] of Object.entries({ hFps: 'fps', hLow: 'low', hGpu: 'gpu', hCpu: 'cpu', hVram: 'vram', hClock: 'clock' })) $(id).checked = HS[key] !== false;
  // companion
  const C = s.companion || {};
  $('cOn').checked = !!C.on;
  $('cDisplay').value = String(C.display || '');
  $('cSide').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === (C.side || 'bottom')));
  $('cHeight').value = C.height || 320; $('cHeightOut').textContent = (C.height || 320) + ' px';
  $('cScale').value = C.scale || 1; $('cScaleOut').textContent = Math.round((C.scale || 1) * 100) + '%';
  $('cHideGame').checked = C.hideInGame !== false;
  const CS = C.sections || {};
  for (const [id, key] of Object.entries({ cClock: 'clock', cMusic: 'music', cStats: 'stats', cClips: 'clips', cDl: 'downloads' })) $(id).checked = CS[key] !== false;
  $('launchOpts').hidden = !P.launch;
  if (document.activeElement !== $('iPlace')) $('iPlace').value = I.weatherPlace || '';
  $('iUnits').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === (I.units || 'c')));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('favs').innerHTML = (I.launch || []).length
    ? I.launch.map((x, i) => `<div class="fav">${x.icon ? `<img src="${x.icon}" alt="">` : '<span></span>'}<span title="${esc(x.path)}">${esc(x.name)}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(x.name)}">×</button></div>`).join('')
    : '<p class="hint">Nothing added yet. Up to 8 apps or folders.</p>';
  $('addApp').disabled = $('addFolder').disabled = (I.launch || []).length >= 8;
}

// Keep in step if the setting is changed from the dock's right-click menu
api.onSettings && api.onSettings((next) => { if (s) { s = next; sync(); } });

api.getSettingsInfo().then((info) => { s = info.settings; build(info); sync(); });


// ---------- workspaces ----------
const ZONE_LABELS = [['', 'Where it was saved'], ['full', 'Full screen'], ['left', 'Left half'], ['right', 'Right half'],
  ['left3', 'Left third'], ['mid3', 'Middle third'], ['right3', 'Right third'], ['left23', 'Left two-thirds'], ['right23', 'Right two-thirds'],
  ['left4', 'Left quarter'], ['right4', 'Right quarter'], ['top', 'Top half'], ['bottom', 'Bottom half']];
let ws = { list: [], active: null, displays: [] };
const escH = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BROWSER_KEYS = ['brave.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe'];
// Page address under a browser window, so each window reopens on its own page
const urlField = (a, j) => (BROWSER_KEYS.includes(a.key)
  ? `<input class="wsurl" data-f="url" data-j="${j}" type="text" value="${escH(a.url || '')}" placeholder="Page for this window (https://…)" aria-label="Page for this ${escH(a.name)} window" spellcheck="false">`
  : '');
// "Update with open windows" reads the browsers' address bars, which takes a moment
async function busyBtn(b, fn) { const t = b.textContent; b.disabled = true; b.textContent = 'Reading windows…'; try { return await fn(); } finally { if (b.isConnected) { b.disabled = false; b.textContent = t; } } }

function wsCard(w, i) {
  const lookVal = !w.look ? 'keep' : 'saved';
  const opt = (v, l, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(l)}</option>`;
  const apps = w.apps.length ? w.apps.map((a, j) => `<div class="wsapp" data-j="${j}">
      <div class="nm"><b>${escH(a.name)}</b><small title="${escH(a.title)}">${escH(a.title)}</small></div>
      <select data-f="display" aria-label="Screen for ${escH(a.name)}">${ws.displays.map((d) => opt(d.id, d.label, String(a.display && a.display.id))).join('')}${ws.displays.some((d) => d.id === String(a.display && a.display.id)) ? '' : opt(String(a.display && a.display.id), (a.display && a.display.label) || 'Missing screen', String(a.display && a.display.id))}</select>
      <select data-f="zone" aria-label="Position for ${escH(a.name)}">${ZONE_LABELS.map(([v, l]) => opt(v, l, a.zone || '')).join('')}</select>
      <button type="button" class="x" data-act="rm" aria-label="Remove ${escH(a.name)}">×</button></div>${urlField(a, j)}`).join('')
    : '<p class="hint">No windows yet. Arrange your windows and click "Update with open windows".</p>';
  return `<div class="card" data-id="${w.id}">
    <div class="ws-head"><input class="emoji-in" data-f="icon" value="${escH(w.icon)}" maxlength="4" aria-label="Icon"><input data-f="name" type="text" value="${escH(w.name)}" aria-label="Name"></div>
    <div class="row" style="grid-template-columns:1fr auto"><span class="hint">Alt + Shift + ${i + 1}</span>${ws.active === w.id ? '<span class="active-badge">In use</span>' : ''}</div>
    <div class="btns"><button type="button" class="btn-s primary" data-act="go">Switch to it</button><button type="button" class="btn-s" data-act="capture">Update with open windows</button><button type="button" class="btn-s danger" data-act="del">Delete</button></div>
    <span class="label">Windows</span>
    <div class="wsapps">${apps}</div>
    <label class="row">Close the previous workspace's apps <input type="checkbox" class="switch" data-f="closeOld"${w.closeOld !== false ? ' checked' : ''}></label>
    <label class="row">Minimise other windows <input type="checkbox" class="switch" data-f="minimizeOthers"${w.minimizeOthers !== false ? ' checked' : ''}></label>
    <label class="row">Dock look <select data-f="look">${opt('keep', "Don't change it", lookVal)}${w.look ? opt('saved', 'The look saved with it', lookVal) : ''}${opt('current', 'Use the current look', '')}${Object.keys(PRESETS).map((k) => opt('preset:' + k, k, '')).join('')}</select></label>
    <span class="label">Web pages to open</span>
    <textarea data-f="urls" placeholder="https://… (one per line)">${escH((w.urls || []).join('\n'))}</textarea>
    ${triggerHtml(w)}
  </div>`;
}
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
let ruleInfo = { rules: [], displays: [], apps: [] };
// "Opens by itself when…" for a workspace card
function triggerHtml(w) {
  const t = w.trigger || { type: 'none' };
  const opt = (v, l, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(l)}</option>`;
  const apps = ruleInfo.apps.some((a) => a.key === t.key) || !t.key ? ruleInfo.apps : [{ key: t.key, name: t.key }, ...ruleInfo.apps];
  let extra = '';
  if (t.type === 'app') extra = `<label class="row">App <select data-f="trigKey">${opt('', 'Choose an app…', t.key || '')}${apps.map((a) => opt(a.key, a.name, t.key || '')).join('')}</select></label>`;
  if (t.type === 'time') extra = `<label class="row">Time <input type="time" data-f="trigTime" value="${escH(t.time || '08:00')}"></label>
      <div class="seg" style="margin-top:4px">${DAYS.map(([d, l]) => `<button type="button" data-f="trigDay" data-d="${d}" aria-pressed="${!(t.days || []).length || (t.days || []).includes(d)}">${l}</button>`).join('')}</div>`;
  if (t.type === 'device') extra = `<label class="row">Device name contains <input type="text" data-f="trigDevice" value="${escH(t.device || '')}" placeholder="e.g. Headphones, Arctis, Speakers"></label>`;
  return `<span class="label">Opens by itself</span>
    <label class="row">When <select data-f="trigType">${opt('none', 'Never (only by hand)', t.type || 'none')}${opt('app', 'an app starts', t.type)}${opt('time', 'at a time of day', t.type)}${opt('device', 'the sound switches to a device', t.type)}</select></label>
    ${extra}`;
}
function renderWs() {
  const box = $('wsList');
  if (!box) return;
  if (box.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return; // don't wipe what you're typing
  box.innerHTML = ws.list.map(wsCard).join('') || '';
  $('wsInDock').checked = !s || s.workspacesInDock !== false;
}
async function loadWs() { [ws, ruleInfo] = await Promise.all([api.wsList(), api.rulesList()]); renderWs(); renderRules(); }

const wsTimers = {};
function pushWs(w, now) {
  clearTimeout(wsTimers[w.id]);
  const send = () => api.wsUpdate(w);
  if (now) send(); else wsTimers[w.id] = setTimeout(send, 500);
}
function renderRules() {
  const opt = (v, l, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(l)}</option>`;
  const used = new Set(ruleInfo.rules.map((r) => r.key));
  $('ruleApp').innerHTML = opt('', 'Choose an app…', '') + ruleInfo.apps.filter((a) => !used.has(a.key)).map((a) => opt(a.key, a.name, '')).join('');
  $('rulesList').innerHTML = ruleInfo.rules.length ? ruleInfo.rules.map((r, j) => `<div class="wsapp" data-j="${j}" style="grid-template-columns:minmax(0,1fr) auto auto auto auto">
      <div class="nm"><b>${escH(r.name || r.key)}</b><small>${escH(r.key)}</small></div>
      <select data-f="display" aria-label="Screen for ${escH(r.name)}">${opt('', 'Main screen', r.display ? r.display.id : '')}${ruleInfo.displays.map((d) => opt(d.id, d.label, r.display ? r.display.id : '')).join('')}</select>
      <select data-f="zone" aria-label="Position for ${escH(r.name)}">${ZONE_LABELS.filter(([v]) => v).map(([v, l]) => opt(v, l, r.zone || 'full')).join('')}</select>
      <input type="checkbox" class="switch" data-f="on" aria-label="Rule on"${r.on !== false ? ' checked' : ''}>
      <button type="button" class="x" data-act="rm" aria-label="Remove rule">×</button></div>`).join('')
    : '<p class="hint">No rules yet.</p>';
}
function wsFrom(el) { const card = el.closest('.card[data-id]'); return card && ws.list.find((w) => w.id === card.dataset.id); }

document.addEventListener('DOMContentLoaded', () => {});
(function wireWs() {
  const box = $('wsList');
  box.addEventListener('input', (e) => {
    const w = wsFrom(e.target); if (!w) return;
    const f = e.target.dataset.f;
    if (f === 'name' || f === 'icon') { w[f] = e.target.value; pushWs(w); }
    if (f === 'urls') { w.urls = e.target.value.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean); pushWs(w); }
    if (f === 'url') { w.apps[+e.target.dataset.j].url = e.target.value.trim(); pushWs(w); }
    if (f === 'trigDevice') { w.trigger = { ...w.trigger, device: e.target.value }; pushWs(w); }
  });
  box.addEventListener('change', (e) => {
    const w = wsFrom(e.target); if (!w) return;
    const f = e.target.dataset.f;
    if (f === 'trigType') { w.trigger = e.target.value === 'none' ? null : { type: e.target.value, on: true, ...(e.target.value === 'time' ? { time: '08:00', days: [1, 2, 3, 4, 5] } : {}) }; pushWs(w, true); renderWs(); return; }
    if (f === 'trigKey') { w.trigger = { ...w.trigger, key: e.target.value }; pushWs(w, true); return; }
    if (f === 'trigTime') { w.trigger = { ...w.trigger, time: e.target.value || '08:00' }; pushWs(w, true); return; }
    const row = e.target.closest('.wsapp');
    if (row && (f === 'display' || f === 'zone')) {
      const a = w.apps[+row.dataset.j];
      if (f === 'zone') a.zone = e.target.value;
      else { const d = ws.displays.find((x) => x.id === e.target.value); a.display = { id: e.target.value, label: d ? d.label : '' }; }
      pushWs(w, true);
    }
    if (f === 'closeOld' || f === 'minimizeOthers') { w[f] = e.target.checked; pushWs(w, true); }
    if (f === 'look') {
      const v = e.target.value;
      if (v === 'keep') w.look = null;
      else if (v === 'current') w.look = { ...s.look };
      else if (v.startsWith('preset:')) w.look = { ...DEF_LOOK, ...PRESETS[v.slice(7)] };
      pushWs(w, true);
    }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const w = wsFrom(b); if (!w) return;
    const act = b.dataset.act;
    if (b.dataset.f === 'trigDay') {
      const d = +b.dataset.d;
      let days = (w.trigger && w.trigger.days && w.trigger.days.length) ? [...w.trigger.days] : DAYS.map(([x]) => x);
      days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
      if (!days.length) days = [d];
      w.trigger = { ...w.trigger, days }; pushWs(w, true); renderWs(); return;
    }
    if (act === 'go') { b.disabled = true; b.textContent = 'Switching…'; await api.wsActivate(w.id); loadWs(); }
    if (act === 'capture') { await busyBtn(b, () => api.wsCapture(w.id)); loadWs(); }
    if (act === 'rm') { w.apps.splice(+b.closest('.wsapp').dataset.j, 1); pushWs(w, true); renderWs(); }
    if (act === 'del') {
      if (b.dataset.sure) { await api.wsDelete(w.id); loadWs(); }
      else { b.dataset.sure = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Delete'; } }, 3000); }
    }
  });
  // window rules
  $('ruleAdd').addEventListener('click', async () => {
    const key = $('ruleApp').value; if (!key) return;
    const app = ruleInfo.apps.find((a) => a.key === key);
    ruleInfo.rules.push({ key, name: app ? app.name : key, display: null, zone: 'full', on: true });
    ruleInfo.rules = await api.rulesSave(ruleInfo.rules); renderRules();
  });
  $('rulesList').addEventListener('change', async (e) => {
    const row = e.target.closest('.wsapp'); if (!row) return;
    const r = ruleInfo.rules[+row.dataset.j]; if (!r) return;
    const f = e.target.dataset.f;
    if (f === 'display') { const d = ruleInfo.displays.find((x) => x.id === e.target.value); r.display = d ? { id: d.id, label: d.label } : null; }
    if (f === 'zone') r.zone = e.target.value;
    if (f === 'on') r.on = e.target.checked;
    ruleInfo.rules = await api.rulesSave(ruleInfo.rules); renderRules();
  });
  $('rulesList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="rm"]'); if (!b) return;
    ruleInfo.rules.splice(+b.closest('.wsapp').dataset.j, 1);
    ruleInfo.rules = await api.rulesSave(ruleInfo.rules); renderRules();
  });
  $('wsNew').addEventListener('click', async (e) => { await busyBtn(e.currentTarget, () => api.wsCreate()); loadWs(); });
  $('wsInDock').addEventListener('change', (e) => save({ workspacesInDock: e.target.checked }));
  api.onWorkspaces(() => loadWs());
  api.onSettingsTab((tab) => { const t = document.querySelector(`.tabs button[data-p="${tab}"]`); if (t) t.click(); });
  loadWs();
})();


// ---------- updates ----------
function showUpdate(u) {
  if (!u) return;
  $('updVersion').textContent = 'Glass Dock ' + u.current;
  $('updMsg').textContent = u.message || '';
  $('updInstall').hidden = u.status !== 'ready';
  $('updCheck').disabled = ['dev', 'off', 'checking', 'downloading'].includes(u.status);
}
api.updateState().then(showUpdate);
api.onUpdateState(showUpdate);
$('updCheck').addEventListener('click', async () => { showUpdate({ ...(await api.updateState()), status: 'checking', message: 'Checking for updates…' }); api.updateCheck(); });
$('updInstall').addEventListener('click', () => api.updateInstall());


// ---------- private workspaces ----------
let pv = { hasPassword: false, unlocked: false, list: null, shortcut: 'Alt+Shift+0' };
const pvTimers = {};
async function loadPv() { pv = await api.pvStatus(); renderPv(); }
function pvField(id, label, type = 'password') { return `<label class="row" for="${id}">${label} <input id="${id}" type="${type}" autocomplete="off"></label>`; }
function renderPv() {
  const card = $('pvCard'), box = $('pvList');
  if (!card) return;
  const head = '<span class="label">Private workspaces</span>';
  if (!pv.hasPassword) {
    card.innerHTML = `${head}<p class="hint">Hidden from the dock, menus and island, stored encrypted, and opened with a password and a shortcut (<kbd>${escH(pv.shortcut)}</kbd>). Pressing the shortcut again closes the windows it opened. Set a password to start.</p>
      ${pvField('pvNew', 'Password')}${pvField('pvNew2', 'Type it again')}
      <div class="btns"><button type="button" class="btn-s primary" id="pvSet">Set password</button></div><p class="hint" id="pvMsg"></p>`;
    box.innerHTML = '';
    return;
  }
  if (!pv.unlocked) {
    card.innerHTML = `${head}<p class="hint">Locked. Press <kbd>${escH(pv.shortcut)}</kbd> anywhere to open one, or unlock here to change them.</p>
      ${pvField('pvPw', 'Password')}
      <div class="btns"><button type="button" class="btn-s primary" id="pvUnlock">Unlock</button><button type="button" class="btn-s danger" id="pvWipe">Forgot it? Delete all private workspaces</button></div><p class="hint" id="pvMsg"></p>`;
    box.innerHTML = '';
    return;
  }
  card.innerHTML = `${head}<p class="hint">Unlocked. It locks itself again after 5 minutes, or when you open one.</p>
    <div class="btns"><button type="button" class="btn-s primary" id="pvNewWs">New private workspace from open windows</button><button type="button" class="btn-s" id="pvLockNow">Lock</button></div>
    <label class="row" for="pvKey">Shortcut <input id="pvKey" type="text" value="${escH(pv.shortcut)}" autocomplete="off" style="width:140px"></label>
    ${pvField('pvChange', 'New password')}
    <div class="btns"><button type="button" class="btn-s" id="pvChangeBtn">Change password</button></div><p class="hint" id="pvMsg"></p>`;
  const opt = (v, l, cur) => `<option value="${escH(v)}"${v === cur ? ' selected' : ''}>${escH(l)}</option>`;
  box.innerHTML = (pv.list || []).map((w) => `<div class="card" data-pv="${w.id}">
    <div class="ws-head"><input class="emoji-in" data-f="icon" value="${escH(w.icon)}" maxlength="4" aria-label="Icon"><input data-f="name" type="text" value="${escH(w.name)}" aria-label="Name"></div>
    <div class="btns"><button type="button" class="btn-s primary" data-act="open">Open it now</button><button type="button" class="btn-s" data-act="capture">Update with open windows</button><button type="button" class="btn-s danger" data-act="del">Delete</button></div>
    <span class="label">Windows</span>
    <div class="wsapps">${(w.apps || []).map((a, j) => `<div class="wsapp" data-j="${j}"><div class="nm"><b>${escH(a.name)}</b><small>${escH(a.title)}</small></div>
      <select data-f="zone" aria-label="Position">${ZONE_LABELS.map(([v, l]) => opt(v, l, a.zone || '')).join('')}</select><span></span>
      <button type="button" class="x" data-act="rm" aria-label="Remove">×</button></div>${urlField(a, j)}`).join('') || '<p class="hint">No windows yet.</p>'}</div>
    <label class="row">Open the web pages in a private browser window <input type="checkbox" class="switch" data-f="privateBrowsing"${w.privateBrowsing !== false ? ' checked' : ''}></label>
    <p class="hint">Each Brave, Chrome, Edge or Firefox window above opens as its own new private window on its page. Pages then stay out of your history.</p>
    <label class="row">Minimise other windows <input type="checkbox" class="switch" data-f="minimizeOthers"${w.minimizeOthers !== false ? ' checked' : ''}></label>
    <label class="row">The shortcut also closes windows that were already open <input type="checkbox" class="switch" data-f="closeAll"${w.closeAll ? ' checked' : ''}></label>
    <span class="label">Web pages to open</span>
    <textarea data-f="urls" placeholder="https://… (one per line)">${escH((w.urls || []).join('\n'))}</textarea>
  </div>`).join('');
}
const pvMsg = (t) => { const m = $('pvMsg'); if (m) m.textContent = t; };
const pvFrom = (el) => { const c = el.closest('[data-pv]'); return c && (pv.list || []).find((w) => w.id === c.dataset.pv); };
function pvPush(w, now) { clearTimeout(pvTimers[w.id]); const go = async () => { pv.list = await api.pvUpdate(w); }; if (now) go(); else pvTimers[w.id] = setTimeout(go, 500); }

$('pvCard').addEventListener('click', async (e) => {
  const id = e.target.id;
  if (id === 'pvSet') {
    if ($('pvNew').value !== $('pvNew2').value) return pvMsg('The two passwords are different.');
    const r = await api.pvSetPassword({ pw: $('pvNew').value });
    if (!r.ok) return pvMsg(r.error);
    loadPv();
  }
  if (id === 'pvUnlock') { const r = await api.pvUnlock($('pvPw').value); if (!r.ok) return pvMsg('Wrong password.'); loadPv(); }
  if (id === 'pvWipe') {
    if (e.target.dataset.sure) { await api.pvRemoveAll(); loadPv(); }
    else { e.target.dataset.sure = '1'; e.target.textContent = 'Click again to delete them all'; }
  }
  if (id === 'pvNewWs') { pv.list = await busyBtn(e.target, () => api.pvCreate()); renderPv(); }
  if (id === 'pvLockNow') { await api.pvLock(); loadPv(); }
  if (id === 'pvChangeBtn') { const r = await api.pvSetPassword({ pw: $('pvChange').value }); pvMsg(r.ok ? 'Password changed.' : r.error); if (r.ok) $('pvChange').value = ''; }
});
$('pvCard').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'pvPw') $('pvUnlock').click();
  if (e.target.id === 'pvNew2') $('pvSet').click();
});
$('pvCard').addEventListener('change', async (e) => {
  if (e.target.id !== 'pvKey') return;
  const r = await api.pvShortcut(e.target.value);
  pvMsg(r.ok ? 'Shortcut saved.' : r.error);
  if (r.ok) pv.shortcut = e.target.value.trim();
});
$('pvList').addEventListener('input', (e) => {
  const w = pvFrom(e.target); if (!w) return;
  const f = e.target.dataset.f;
  if (f === 'name' || f === 'icon') { w[f] = e.target.value; pvPush(w); }
  if (f === 'urls') { w.urls = e.target.value.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean); pvPush(w); }
  if (f === 'url') { w.apps[+e.target.dataset.j].url = e.target.value.trim(); pvPush(w); }
});
$('pvList').addEventListener('change', (e) => {
  const w = pvFrom(e.target); if (!w) return;
  const f = e.target.dataset.f;
  if (f === 'zone') { w.apps[+e.target.closest('.wsapp').dataset.j].zone = e.target.value; pvPush(w, true); }
  if (['privateBrowsing', 'minimizeOthers', 'closeAll'].includes(f)) { w[f] = e.target.checked; pvPush(w, true); }
});
$('pvList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const w = pvFrom(b); if (!w) return;
  const act = b.dataset.act;
  if (act === 'open') { await api.pvOpenNow(w.id); loadPv(); }
  if (act === 'capture') { pv.list = await busyBtn(b, () => api.pvCapture(w.id)); renderPv(); }
  if (act === 'rm') { w.apps.splice(+b.closest('.wsapp').dataset.j, 1); pvPush(w, true); renderPv(); }
  if (act === 'del') {
    if (b.dataset.sure) { pv.list = await api.pvDelete(w.id); renderPv(); }
    else { b.dataset.sure = '1'; b.textContent = 'Click again to delete'; }
  }
});
loadPv();
