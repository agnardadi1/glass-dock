const api = window.dockApi;
const dock = document.getElementById('dock');
const sep = document.getElementById('sep');
const marker = document.getElementById('marker');
const wrap = document.getElementById('wrap');
const player = document.getElementById('player');
const playerWrap = document.getElementById('playerWrap');
const $ = (id) => document.getElementById(id);

const nodes = new Map(); // uid -> element
let list = [];
let settings = null;
let maxScale = 1.8, magOn = true, mouseX = null, dragUid = null, visible = true;

const S = 'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"';
const ICONS = {
  start: '<svg viewBox="0 0 24 24" fill="#fff">' + [5, 12, 19].flatMap((x) => [5, 12, 19].map((y) => `<circle cx="${x}" cy="${y}" r="2.1"/>`)).join('') + '</svg>',
  speaker: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
  speakerLow: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`,
  speakerOff: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>`,
  gear: `<svg ${S}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  quick: `<svg ${S}><path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.5 7.5 0 0 1 11 0M9.5 15.5a3 3 0 0 1 5 0"/><circle cx="12" cy="19" r=".6" fill="#fff"/></svg>`,
  downloads: `<svg ${S}><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`,
  trash: '<svg fill="none" stroke="#5a6274" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- building the icons ----------
function makeEl(uid) {
  const el = document.createElement('button');
  el.className = 'item';
  el.dataset.uid = uid;
  el.draggable = false; // arranging uses the live drag below; dropping files still works
  el.innerHTML = '<span class="tip"></span><span class="icon"></span><span class="dot"></span>';
  el.cur = 0;
  el.addEventListener('click', () => { if (el.justDragged) { el.justDragged = false; return; } onClick(el); });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (uid.startsWith('ws:')) api.wsMenu(uid.slice(3));
    else if (uid.startsWith('sys:')) api.dockMenu(); else api.context(uid);
  });
  el.addEventListener('animationiteration', () => { if (el.stopReq) { el.classList.remove('bounce'); el.stopReq = false; } });
  el.addEventListener('animationend', () => el.classList.remove('catch'));
  return el;
}

function sysTile(uid, name, cls, html, before) {
  const el = makeEl(uid);
  el.querySelector('.tip').textContent = name;
  el.setAttribute('aria-label', name);
  const ic = el.querySelector('.icon');
  ic.className = 'icon sys ' + cls;
  ic.innerHTML = html;
  dock.insertBefore(el, before);
  return el;
}

// Order: [Start] apps… | player Downloads Recycle-bin [| Quick-settings Clock]
const startEl = sysTile('sys:start', 'Start', 'start', ICONS.start, dock.firstChild);
// Workspace tiles sit between Start and the apps, with their own divider
const wsSep = document.createElement('div');
wsSep.className = 'sep';
wsSep.hidden = true;
dock.insertBefore(wsSep, startEl.nextSibling);
const WS_COLOURS = ['#5b8cff,#3a5bd9', '#ff8a5c,#e2557b', '#3ddc97,#1a9e6a', '#b07cff,#7a4dff', '#ffd166,#f39c12', '#4dd0e1,#1e88e5', '#ff6b9a,#c2185b', '#9aa5b8,#5c6375'];
let wsData = { list: [], active: null };
function renderWorkspaces(data) {
  if (data) wsData = data;
  dock.querySelectorAll('.item[data-uid^="ws:"]').forEach((el) => el.remove());
  const show = !!(settings && settings.workspacesInDock !== false) && wsData.list.length > 0;
  wsSep.hidden = !show;
  if (!show) return;
  wsData.list.forEach((w, i) => {
    const el = makeEl('ws:' + w.id);
    el.querySelector('.tip').textContent = `${w.name}  ·  Alt+Shift+${i + 1}`;
    el.setAttribute('aria-label', 'Workspace ' + w.name);
    const ic = el.querySelector('.icon');
    ic.className = 'icon sys ws';
    ic.style.background = `linear-gradient(145deg, ${WS_COLOURS[i % WS_COLOURS.length]})`;
    ic.innerHTML = `<span class="emoji">${esc(w.icon)}</span>`;
    el.classList.toggle('running', wsData.active === w.id);
    el.classList.toggle('active', wsData.active === w.id);
    dock.insertBefore(el, wsSep);
  });
}
api.onWorkspaces(renderWorkspaces);
const dlEl = sysTile('sys:downloads', 'Downloads', 'downloads', ICONS.downloads, marker);
dlEl.querySelector('.icon').style.background = 'linear-gradient(#8fc4ff,#4a8de6)';
const trashEl = sysTile('sys:trash', 'Recycle Bin', 'trash', ICONS.trash, marker);
trashEl.querySelector('.icon').style.background = 'linear-gradient(rgba(255,255,255,.65),rgba(205,212,222,.65))';
const gearEl = sysTile('sys:settings', 'Dock settings', 'gear', ICONS.gear, marker);
const sep2 = document.createElement('div');
sep2.className = 'sep';
dock.insertBefore(sep2, marker);
const soundEl = sysTile('sys:sound', 'Sound', 'sound', '', marker);
const quickEl = sysTile('sys:quick', 'Wi-Fi, sound and battery', 'quick', ICONS.quick, marker);
const clockEl = sysTile('sys:clock', 'Notifications and calendar', 'clock', '<b></b><small></small>', marker);

function tickClock() {
  const d = new Date();
  clockEl.querySelector('b').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]\.?M\.?$/i, '');
  clockEl.querySelector('small').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  clockEl.querySelector('.tip').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
tickClock();
setInterval(tickClock, 5000);

function update(el, it) {
  el.querySelector('.tip').textContent = it.name;
  el.setAttribute('aria-label', it.name);
  const ic = el.querySelector('.icon');
  const sig = (it.icon || '').length + ':' + it.name;
  if (ic.dataset.sig !== sig) {
    ic.dataset.sig = sig;
    ic.className = 'icon app';
    ic.innerHTML = it.icon ? `<img src="${it.icon}" alt="">` : `<span class="letter">${esc((it.name || '?')[0])}</span>`;
  }
  el.classList.toggle('running', !!it.running);
  el.classList.toggle('active', !!it.active);
  el.classList.toggle('attn', !!it.attention);
  let b = el.querySelector('.count');
  if (it.badge) {
    if (!b) { b = document.createElement('span'); b.className = 'count'; el.querySelector('.icon').after(b); }
    b.textContent = it.badge > 99 ? '99+' : it.badge;
  } else if (b) b.remove();
  if (it.running) stopBounce(el);
}

function render(next) {
  list = next;
  const keep = new Set(next.map((i) => i.uid));
  for (const [uid, el] of nodes) if (!keep.has(uid)) { el.remove(); nodes.delete(uid); }
  let prev = wsSep;
  for (const it of next) {
    let el = nodes.get(it.uid);
    if (!el) { el = makeEl(it.uid); nodes.set(it.uid, el); }
    update(el, it);
    if (prev.nextSibling !== el) dock.insertBefore(el, prev.nextSibling);
    prev = el;
  }
}

// Used by the main process to aim the minimise animation
window.__iconRect = (uid) => {
  const el = nodes.get(uid);
  const r = (el || dock).getBoundingClientRect();
  if (!el) return { x: r.x + r.width / 2 - 26, y: r.y + 8, width: 52, height: 52 };
  const ic = el.querySelector('.icon').getBoundingClientRect();
  return { x: ic.x, y: ic.y, width: ic.width, height: ic.height };
};

// ---------- clicking ----------
function startBounce(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.stopReq = false;
  el.classList.add('bounce');
  clearTimeout(el.bt);
  el.bt = setTimeout(() => stopBounce(el), 6000);
}
function stopBounce(el) {
  clearTimeout(el.bt);
  if (el.classList.contains('bounce')) el.stopReq = true; // finish the current hop, then stop
}

// ---------- sound ----------
let snd = null;
function renderSound(st) {
  if (!st) return;
  snd = st;
  const ic = soundEl.querySelector('.icon');
  const pct = Math.round(st.vol * 100);
  ic.innerHTML = (st.mute ? ICONS.speakerOff : pct < 40 ? ICONS.speakerLow : ICONS.speaker) + `<span class="lvl"><i style="width:${st.mute ? 0 : pct}%"></i></span>`;
  ic.classList.toggle('muted', !!st.mute);
  const out = (st.out || []).find((d) => d.def);
  soundEl.querySelector('.tip').textContent = `${st.mute ? 'Muted' : pct + '%'}${out ? ' · ' + out.name : ''}`;
}
api.onSound(renderSound);
soundEl.addEventListener('wheel', (e) => {
  if (!snd) return;
  e.preventDefault();
  snd.vol = Math.max(0, Math.min(1, snd.vol + (e.deltaY < 0 ? 0.04 : -0.04)));
  if (snd.mute) { snd.mute = false; api.soundCmd('mute 0'); }
  api.soundCmd('vol ' + snd.vol.toFixed(2));
  renderSound(snd);
}, { passive: false });
soundEl.querySelector('.icon').innerHTML = ICONS.speaker;

const SYS_ACTIONS = { 'sys:settings': 'settings', 'sys:downloads': 'downloads', 'sys:trash': 'trash', 'sys:start': 'start', 'sys:quick': 'quick', 'sys:clock': 'notify' };
async function onClick(el) {
  const uid = el.dataset.uid;
  const stackOn = settings && settings.stacks !== false;
  if (stackOn && (uid === 'sys:downloads' || (uid.startsWith('p:') && (list.find((i) => i.uid === uid) || {}).kind === 'folder'))) {
    const r = el.querySelector('.icon').getBoundingClientRect();
    const it = list.find((i) => i.uid === uid);
    return api.stackOpen({ dir: uid === 'sys:downloads' ? 'downloads' : uid, title: it ? it.name : 'Downloads', uid, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
  }
  if (uid.startsWith('ws:')) { startBounce(el); await api.wsActivate(uid.slice(3)); stopBounce(el); return; }
  if (uid === 'sys:sound') {
    const r = soundEl.querySelector('.icon').getBoundingClientRect(); // the enlarged tile, not just the bar slot
    return api.soundOpen({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  if (SYS_ACTIONS[uid]) return api.openSystem(SYS_ACTIONS[uid]);
  const it = list.find((i) => i.uid === uid);
  if (it && !it.running && it.kind === 'app') startBounce(el);
  const r = await api.activate(uid);
  if (r !== 'launched') stopBounce(el);
}

dock.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.item, .player')) { e.preventDefault(); api.dockMenu(); }
});

api.onCatch((uid) => {
  const el = nodes.get(uid);
  if (!el) return;
  el.classList.remove('catch');
  void el.offsetWidth;
  el.classList.add('catch');
});

// ---------- magnification ----------
dock.addEventListener('mousemove', (e) => { mouseX = e.clientX; });
dock.addEventListener('mouseleave', () => { mouseX = null; });
const baseSize = () => parseFloat(getComputedStyle(dock).getPropertyValue('--base')) || 52;

let lastRect = '';
function frame(t) {
  const dt = Math.min(64, t - (frame.last || t)) || 16.7;
  frame.last = t;
  const k = 1 - Math.pow(0.74, dt / 16.7); // same feel at 60, 144 or 165 Hz
  const bs = baseSize();
  const range = bs * 3.2;
  for (const el of dock.querySelectorAll('.item:not([hidden])')) {
    let target = bs;
    if (magOn && mouseX !== null) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(mouseX - (r.left + r.width / 2));
      if (d < range) target = bs * (1 + (maxScale - 1) * (Math.cos((d / range) * Math.PI) + 1) / 2);
    }
    const before = el.cur;
    el.cur = el.cur ? el.cur + (target - el.cur) * k : bs;
    if (Math.abs(el.cur - target) < 0.05) el.cur = target;
    if (el.cur !== before) {
      el.style.width = el.cur + 'px';
      el.style.setProperty('--s', el.cur + 'px');
    }
  }
  // Tell the main process where the bar is, so only the bar catches clicks
  if (visible) {
    const r = dock.getBoundingClientRect();
    const head = Math.round((magOn ? bs * (maxScale - 1) : 0) + 44);
    const sig = [r.x, r.y, r.width, r.height, head].map(Math.round).join(',');
    if (sig !== lastRect) {
      lastRect = sig;
      api.barRect({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), head });
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- auto-hide ----------
api.onVisible((v) => {
  visible = v;
  wrap.classList.toggle('away', !v);
  if (!v) mouseX = null;
  lastRect = '';
});

// ---------- music player ----------
let media = null, mediaAt = 0;
$('pPrev').innerHTML = ICONS.prev;
$('pNext').innerHTML = ICONS.next;
const APP_LABELS = [[/spotify/i, 'Spotify'], [/chrome/i, 'Chrome'], [/msedge|edge/i, 'Edge'], [/firefox/i, 'Firefox'], [/brave/i, 'Brave'], [/vlc/i, 'VLC'], [/zune|media/i, 'Media Player']];
const appLabel = (a) => (APP_LABELS.find(([re]) => re.test(a || '')) || [null, (a || 'Media').replace(/\.exe$/i, '').split('!')[0]])[1];

function renderMedia(m) {
  media = m && !m.none ? m : null;
  mediaAt = performance.now();
  if (!media && renderMedia.lastArt) { renderMedia.lastArt = ''; readArtColour(''); }
  playerWrap.hidden = !media || !(settings && settings.media);
  if (!media) return;
  const cover = $('pCover');
  if (media.art !== renderMedia.lastArt) { renderMedia.lastArt = media.art; readArtColour(media.art); }
  cover.style.backgroundImage = media.art ? `url("${media.art}")` : '';
  cover.classList.toggle('has-art', !!media.art);
  $('artCard').style.backgroundImage = media.art ? `url("${media.art}")` : '';
  $('artCard').classList.toggle('has-art', !!media.art);
  const icon = media.playing ? ICONS.pause : ICONS.play;
  $('pBadge').innerHTML = icon;
  $('pPlay').innerHTML = icon;
  $('pPlay').setAttribute('aria-label', media.playing ? 'Pause' : 'Play');
  const many = media.count > 1;
  $('pSrc').textContent = appLabel(media.app) + (many ? '  ⇄' : '');
  $('pSrc').classList.toggle('many', many);
  $('pTitle').textContent = media.title || 'Nothing playing';
  $('pArtist').textContent = media.artist || '';
  $('pProg').hidden = !(media.len > 0);
}
function tickProgress() {
  if (media && media.len > 0) {
    const pos = media.pos + (media.playing ? (performance.now() - mediaAt) / 1000 : 0);
    $('pProg').firstChild.style.width = Math.min(100, (pos / media.len) * 100) + '%';
  }
  requestAnimationFrame(tickProgress);
}
requestAnimationFrame(tickProgress);

$('pPlay').addEventListener('click', () => {
  api.media('toggle');
  if (media) { media.pos += media.playing ? (performance.now() - mediaAt) / 1000 : 0; media.playing = !media.playing; renderMedia(media); }
});
$('pNext').addEventListener('click', () => api.media('next'));
$('pPrev').addEventListener('click', () => api.media('prev'));
$('pSrc').addEventListener('click', () => { if (media && media.count > 1) api.media('switch'); });
$('pCover').addEventListener('click', () => { if (media) api.mediaFocus(media.app); });
api.onMedia(renderMedia);

// ---------- drag & drop ----------
function dropInfo(e) {
  const x = e.clientX;
  const tr = trashEl.getBoundingClientRect();
  if (x >= tr.left && x <= tr.right) return { trash: true };
  const pinned = [...dock.querySelectorAll('.item[data-uid^="p:"]')];
  let index = pinned.length;
  for (let i = 0; i < pinned.length; i++) {
    const r = pinned[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) { index = i; break; }
  }
  let overUid = null;
  for (const el of dock.querySelectorAll('.item[data-uid^="p:"], .item[data-uid^="r:"]')) {
    const r = el.getBoundingClientRect();
    if (x > r.left + r.width * 0.25 && x < r.right - r.width * 0.25) { overUid = el.dataset.uid; break; }
  }
  const gap = baseSize() * 0.1;
  let mx;
  if (!pinned.length) mx = startEl.getBoundingClientRect().right + gap / 2;
  else if (index < pinned.length) mx = pinned[index].getBoundingClientRect().left - gap / 2;
  else mx = pinned[pinned.length - 1].getBoundingClientRect().right + gap / 2;
  return { index, overUid, mx };
}
function showDrop(info) {
  dock.querySelectorAll('.drop-on').forEach((el) => el.classList.remove('drop-on'));
  trashEl.classList.toggle('drop-on', !!info.trash);
  if (info.trash) { marker.hidden = true; return; }
  if (!dragUid && info.overUid) { nodes.get(info.overUid)?.classList.add('drop-on'); marker.hidden = true; return; }
  marker.hidden = false;
  marker.style.left = (info.mx - dock.getBoundingClientRect().left - 1.5) + 'px';
}
function clearDrop() {
  marker.hidden = true;
  dock.classList.remove('dragging');
  dock.querySelectorAll('.drop-on').forEach((el) => el.classList.remove('drop-on'));
}

// ---------- arranging icons: grab one and slide it, the others make room ----------
let pd = null; // the icon being pressed / dragged
const arrangeable = () => [...dock.querySelectorAll('.item[data-uid^="p:"], .item[data-uid^="r:"]')];
dock.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.item[data-uid^="p:"], .item[data-uid^="r:"]');
  if (el) pd = { el, uid: el.dataset.uid, x0: e.clientX, y0: e.clientY, dragging: false };
});
function beginArrange() {
  pd.dragging = true;
  api.dockDrag(true);
  pd.wasMag = magOn; magOn = false; // icons settle to normal size so the slots stay put
  const bs = baseSize();
  pd.slot = bs + bs * 0.1;
  pd.list = arrangeable();
  pd.from = pd.list.indexOf(pd.el);
  pd.others = pd.list.filter((x) => x !== pd.el);
  pd.others.forEach((x) => { x.shift = 0; });
  pd.index = pd.from;
  dock.classList.add('arranging');
  pd.el.classList.add('lifted');
  // keep working out the gap every frame: the icons are still settling from the hover zoom
  const tick = () => { if (!pd || !pd.dragging) return; if (pd.last) moveArrange(pd.last); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function moveArrange(e) {
  const dx = e.clientX - pd.x0, dy = Math.min(0, e.clientY - pd.y0);
  const removing = pd.uid.startsWith('p:') && dy < -baseSize() * 1.2;
  pd.el.classList.toggle('removing', removing);
  pd.el.style.transform = `translate(${dx}px, ${dy}px)`;
  // which gap is the pointer over?
  let t = 0;
  for (const o of pd.others) {
    const r = o.getBoundingClientRect();
    if (e.clientX > r.left + r.width / 2 - o.shift) t++;
  }
  pd.index = t;
  pd.removing = removing;
  pd.others.forEach((o, k) => {
    const finalIdx = k < t ? k : k + 1;
    const nowIdx = pd.list.indexOf(o);
    o.shift = removing ? (nowIdx > pd.from ? -pd.slot : 0) : (finalIdx - nowIdx) * pd.slot;
    o.style.transform = o.shift ? `translateX(${o.shift}px)` : '';
  });
}
async function endArrange() {
  const { el, uid, others, index, removing } = pd;
  dock.classList.remove('arranging');
  el.classList.remove('lifted', 'removing');
  magOn = pd.wasMag;
  // put it in its new place straight away, so nothing jumps while the dock saves it
  const all = [el, ...others];
  all.forEach((x) => { x.style.transition = 'none'; x.style.transform = ''; x.shift = 0; });
  if (removing) {
    el.classList.add('poof');
    setTimeout(() => api.removeItem(uid), 220);
  } else {
    const ref = others[index] || null;
    if (ref) dock.insertBefore(el, ref);
    else if (others.length) dock.insertBefore(el, others[others.length - 1].nextSibling);
    const pinnedBefore = others.slice(0, index).filter((x) => x.dataset.uid.startsWith('p:')).length;
    api.reorder(uid, pinnedBefore);
  }
  requestAnimationFrame(() => all.forEach((x) => { x.style.transition = ''; }));
  el.justDragged = true;
  setTimeout(() => { el.justDragged = false; }, 50);
  api.dockDrag(false);
}
window.addEventListener('pointermove', (e) => {
  if (!pd) return;
  if (!pd.dragging) {
    if (Math.hypot(e.clientX - pd.x0, e.clientY - pd.y0) < 6) return;
    beginArrange();
  }
  pd.last = { clientX: e.clientX, clientY: e.clientY };
  moveArrange(pd.last);
});
window.addEventListener('pointerup', () => { if (pd && pd.dragging) endArrange(); pd = null; });
window.addEventListener('blur', () => { if (pd && pd.dragging) endArrange(); pd = null; });
dock.addEventListener('dragover', (e) => {
  e.preventDefault();
  mouseX = e.clientX;
  showDrop(dropInfo(e));
  e.dataTransfer.dropEffect = dragUid ? 'move' : 'copy';
});
dock.addEventListener('dragleave', (e) => { if (!dock.contains(e.relatedTarget)) { clearDrop(); mouseX = null; } });
dock.addEventListener('drop', async (e) => {
  e.preventDefault();
  const info = dropInfo(e);
  clearDrop();
  if (dragUid) {
    const uid = dragUid; dragUid = null;
    if (!info.trash) await api.reorder(uid, info.index);
    return;
  }
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
  if (!paths.length) return;
  if (info.trash) return api.trash(paths);
  api.drop({ paths, index: info.index, overUid: info.overUid });
});

// ---------- appearance ----------
const TINTS = { glass: null, graphite: '30 32 38', frost: '214 230 255', rose: '255 122 168', aurora: '56 196 168', ember: '255 138 60' };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return `${n >> 16} ${(n >> 8) & 255} ${n & 255}`; };

function applySettings(s) {
  settings = s;
  const L = s.look, d = dock.style;
  maxScale = s.mag; magOn = s.magOn;
  d.setProperty('--base', s.size + 'px');
  const t = L.tint === 'custom' ? hexRgb(L.custom) : TINTS[L.tint];
  if (t) d.setProperty('--tint', t); else d.removeProperty('--tint');
  d.setProperty('--alpha', L.alpha);
  applyGlow();
  wrap.classList.toggle('edge', L.shape === 'edge');
  d.setProperty('--radius', { rounded: 'calc(var(--base) * .4)', pill: '999px', sharp: '6px', edge: 'calc(var(--base) * .3)' }[L.shape]);
  d.setProperty('--icon-r', { squircle: '23%', circle: '50%', square: '12%' }[L.icon]);
  d.setProperty('--player-r', { squircle: 'calc(var(--base) * .23)', circle: '999px', square: 'calc(var(--base) * .12)' }[L.icon]);
  dock.classList.toggle('tiles', !!L.tiles);
  dock.dataset.ind = L.ind;
  // Start / Quick Settings / clock appear when the dock replaces the taskbar
  const sys = !!s.replaceTaskbar;
  startEl.hidden = !sys || s.startButton !== true; quickEl.hidden = !sys; clockEl.hidden = !sys;
  soundEl.hidden = !s.soundButton;
  gearEl.hidden = s.settingsButton === false;
  sep2.hidden = !sys && !s.soundButton;
  playerWrap.hidden = !media || !s.media;
  renderWorkspaces();
  dock.querySelectorAll('.item').forEach((el) => { el.cur = 0; });
}

// ---------- glow (incl. music-reactive and album-cover colour) ----------
let artColour = null;   // [r, g, b] taken from the album cover
let audio = null;       // live sound analyser for the Music glow
let level = 0;          // smoothed loudness 0..1

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
function glowRgb() {
  const L = settings.look;
  return L.glowArt && artColour ? artColour : hexToRgb(L.glowCol);
}

function applyGlow() {
  if (!settings) return;
  const L = settings.look, d = dock.style;
  const [r, g, b] = glowRgb();
  const col = `rgb(${r} ${g} ${b})`;
  const on = L.glow !== 'off';
  d.setProperty('--glow', on ? L.glowSize + 'px' : '0px');
  d.setProperty('--glow-c', on ? col : 'transparent');
  d.setProperty('--ind-c', col);
  if (L.glow === 'neon' || L.glow === 'music') d.setProperty('--edge', `rgb(${r} ${g} ${b} / .7)`); else d.removeProperty('--edge');
  dock.classList.toggle('pulse', L.glow === 'pulse');
  dock.classList.toggle('music', L.glow === 'music');
  if (L.glow === 'music') startAudio(); else stopAudio();
}

async function startAudio() {
  if (audio) return;
  audio = { starting: true };
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // only the sound is used
    if (!stream.getAudioTracks().length) throw new Error('no sound source');
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.55;
    ctx.createMediaStreamSource(stream).connect(an);
    audio = { ctx, an, stream, data: new Uint8Array(an.frequencyBinCount) };
    if (!(settings && settings.look.glow === 'music')) stopAudio();
  } catch (e) {
    console.error('[music glow] could not listen to the PC sound:', e && e.message);
    audio = null;
  }
}
function stopAudio() {
  if (!audio || audio.starting) return;
  audio.stream.getTracks().forEach((t) => t.stop());
  audio.ctx.close();
  audio = null;
  level = 0;
}

// Bass drives the glow; quick to rise on a beat, slower to fade.
function musicFrame() {
  if (audio && audio.an && visible) {
    const { an, data } = audio;
    an.getByteFrequencyData(data);
    const hzPerBin = audio.ctx.sampleRate / an.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hzPerBin)), b = Math.max(a + 1, Math.floor(hi / hzPerBin));
      let sum = 0;
      for (let i = a; i < b; i++) sum += data[i];
      return sum / (b - a) / 255;
    };
    const bass = band(30, 160), mids = band(160, 2000);
    const target = Math.min(1, Math.pow(bass * 0.75 + mids * 0.35, 1.6) * 1.5);
    level += (target - level) * (target > level ? 0.55 : 0.09);
    const L = settings.look;
    const [r, g, b] = glowRgb();
    const d = dock.style;
    d.setProperty('--glow', (L.glowSize * (0.35 + 1.9 * level)).toFixed(1) + 'px');
    d.setProperty('--glow-c', `rgb(${r} ${g} ${b} / ${(0.25 + 0.75 * level).toFixed(3)})`);
    d.setProperty('--edge', `rgb(${r} ${g} ${b} / ${(0.35 + 0.65 * level).toFixed(3)})`);
  }
  requestAnimationFrame(musicFrame);
}
requestAnimationFrame(musicFrame);

// Picks a bright, saturated colour from the album cover
function readArtColour(url) {
  if (!url) { artColour = null; applyGlow(); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 24, 24);
    const px = g.getImageData(0, 0, 24, 24).data;
    let best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
      const sat = max ? (max - min) / max : 0;
      const score = sat * (max / 255);
      sum[0] += r; sum[1] += gg; sum[2] += b; n++;
      if (score > bestScore) { bestScore = score; best = [r, gg, b]; }
    }
    let rgb = bestScore > 0.25 ? best : sum.map((v) => v / n);
    const max = Math.max(...rgb) || 1;
    rgb = rgb.map((v) => Math.round(Math.min(255, (v / max) * 235))); // brighten so it glows
    artColour = rgb;
    applyGlow();
  };
  img.onerror = () => { artColour = null; applyGlow(); };
  img.src = url;
}

// ---------- start ----------
api.onDock(render);
api.onSettings(applySettings);
api.getState().then(({ settings: s, list: l, media: m, sound: snd0, workspaces: wsd }) => { applySettings(s); render(l); renderMedia(m); renderSound(snd0); renderWorkspaces(wsd); });
