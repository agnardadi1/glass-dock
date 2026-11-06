const {
  app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage, globalShortcut, dialog, session, desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const store = require('./store');
const win32 = require('./win32');
const { Media } = require('./media');
const { Sound } = require('./audio');
const createIsland = require('./island');
const createWorkspaces = require('./workspaces');
const createStacks = require('./stacks');
const createUpdater = require('./updater');
const createPrivate = require('./private');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const DOCK_HEIGHT = 300; // room for magnified icons + name labels; the empty part is click-through
const ICON_PX = 160;
const EV = win32.EVENTS;

let state;                    // { items, settings, restore }
let dock = null, overlay = null, settingsWin = null, tray = null, soundWin = null;
let soundHiddenAt = 0;
let windowsByKey = new Map(); // app key (exe name) -> { exe, windows: [...] }
let winByAddr = new Map();    // window address -> { key, title, rect, pid }
let unpinnedOrder = [];       // open-but-not-pinned apps, in the order they appeared
let lastAppFg = null;         // address of the last focused app window (not the dock)
let barRect = null;           // where the bar is inside the dock window (only while shown)
let capturing = false;        // mouse is over the bar
let shown = true;             // dock slid in (true) or away (false)
let revealUntil = 0, edgeSince = 0;
let ghostsRunning = 0;
let unhookEvents = () => {};
let quitting = false;
const iconCache = new Map();
let island = null;
let workspaces = null;
let stacks = null;
let updater = null;
let privateWs = null;
const media = new Media((m) => {
  if (dock && !dock.isDestroyed()) dock.webContents.send('media', m);
  if (island) island.send('media', m);
});
const sound = new Sound((st) => {
  if (dock && !dock.isDestroyed()) dock.webContents.send('sound', st);
  if (soundWin && !soundWin.isDestroyed()) soundWin.webContents.send('sound', st);
  if (island) island.send('sound', st);
});

// ---------- helpers ----------
const norm = (p) => (p || '').toLowerCase();
const KEY_ALIAS = { 'steamwebhelper.exe': 'steam.exe' };
const NAMES = {
  'explorer.exe': 'File Explorer', 'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox', 'spotify.exe': 'Spotify', 'code.exe': 'VS Code', 'discord.exe': 'Discord',
  'steam.exe': 'Steam', 'windowsterminal.exe': 'Terminal', 'notepad.exe': 'Notepad', 'brave.exe': 'Brave',
};
const keyOf = (exe) => { const k = path.basename(exe || '').toLowerCase(); return KEY_ALIAS[k] || k; };
const prettify = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const appName = (key) => NAMES[key] || prettify(key.replace(/\.exe$/, ''));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const persist = () => store.save(state);
const uidId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const alive = (w) => w && !w.isDestroyed();
// One Windows feature failing must never take the whole dock down
const safe = (label, fn) => { try { return fn(); } catch (e) { console.error(`[${label}]`, e && e.message ? e.message : e); return undefined; } };

// Finding an app's logo, best source first:
//  1. Windows' own large icon for the file
//  2. the small file icon
//  3. Microsoft Store apps: the logo files inside the app's package (Windows locks the .exe itself)
//  4. (for open apps, later) the icon shown on the app's window
const usable = (img) => img && !img.isEmpty() && !looksBlank(img) && !isGenericIcon(img);
// Windows hands out the same plain "program" icon for apps it can't read a logo from.
// Learn what it looks like (from an empty .exe) so it counts as "no logo found".
let genericPrints = [];
const printOf = (img) => img.resize({ width: 16, height: 16, quality: 'good' }).toBitmap();
function isGenericIcon(img) {
  if (!genericPrints.length) return false;
  const p = printOf(img);
  return genericPrints.some((g) => {
    let d = 0;
    for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - p[i]);
    return d / g.length < 14;
  });
}
async function learnGenericIcon() {
  const tmp = path.join(os.tmpdir(), 'glass-dock-no-icon.exe');
  try { fs.writeFileSync(tmp, ''); } catch { return; }
  const tries = [
    () => nativeImage.createThumbnailFromPath(tmp, { width: ICON_PX, height: ICON_PX }),
    () => app.getFileIcon(tmp, { size: 'large' }),
    () => app.getFileIcon(tmp, { size: 'normal' }),
  ];
  for (const t of tries) { try { const img = await t(); if (img && !img.isEmpty()) genericPrints.push(printOf(img)); } catch { /* skip */ } }
}
function looksBlank(img) {
  // Some locked files come back as a fully transparent square
  const { width, height } = img.getSize();
  const px = img.resize({ width: 16, height: 16 }).toBitmap();
  for (let i = 3; i < px.length; i += 4) if (px[i] > 16) return false;
  return width > 0 && height > 0;
}
// Microsoft Store apps live in a locked folder (…\WindowsApps\Publisher.App_version_arch__id\…),
// so they can't be started by opening their .exe. They're started by their app ID instead,
// "PackageFamilyName!AppId", the same way the Start menu does it.
const storeIds = new Map();
function storeAppId(file) {
  const m = /\\WindowsApps\\([^\\_]+)_[^\\]*__([a-z0-9]+)\\(.+)$/i.exec(file || '');
  if (!m) return null;
  const family = `${m[1]}_${m[2]}`;
  const exeRel = m[3].toLowerCase();
  if (storeIds.has(file)) return storeIds.get(file);
  let appId = null;
  try {
    const pkgDir = file.slice(0, file.length - m[3].length - 1);
    const xml = fs.readFileSync(path.join(pkgDir, 'AppxManifest.xml'), 'utf8');
    for (const a of xml.matchAll(/<Application\b[^>]*>/g)) {
      const id = (/\bId="([^"]+)"/.exec(a[0]) || [])[1];
      const exe = ((/\bExecutable="([^"]+)"/.exec(a[0]) || [])[1] || '').toLowerCase().replace(/\//g, '\\');
      if (id && (exe === exeRel || exe.endsWith('\\' + path.basename(exeRel)) || exe === path.basename(exeRel))) { appId = id; break; }
      if (id && !appId) appId = id; // first app in the package as a fallback
    }
  } catch { /* manifest unreadable (e.g. the app updated to a new folder) */ }
  const aumid = appId ? `${family}!${appId}` : null;
  storeIds.set(file, aumid);
  return aumid;
}
// Opens an app, shortcut, folder or file; Store apps go through their app ID
async function launchThing(p, savedAumid) {
  const aumid = savedAumid || storeAppId(p);
  if (aumid) {
    spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], { detached: true, stdio: 'ignore' }).unref();
    return '';
  }
  return shell.openPath(p);
}

function storeAppLogo(file) {
  const m = /^(.*\\WindowsApps\\[^\\]+)\\/i.exec(file || '');
  if (!m) return null;
  try {
    const pkg = m[1];
    const xml = fs.readFileSync(path.join(pkg, 'AppxManifest.xml'), 'utf8');
    const ref = (/Square44x44Logo="([^"]+)"/.exec(xml) || /Square150x150Logo="([^"]+)"/.exec(xml) || /<Logo>([^<]+)<\/Logo>/.exec(xml) || [])[1];
    if (!ref) return null;
    const dir = path.join(pkg, path.dirname(ref));
    const base = path.basename(ref, path.extname(ref)).toLowerCase();
    let best = null, bestScore = -1;
    for (const f of fs.readdirSync(dir)) {
      const lf = f.toLowerCase();
      if (!lf.startsWith(base) || !lf.endsWith('.png') || /contrast|lightunplated/.test(lf)) continue;
      const size = +((/targetsize-(\d+)/.exec(lf) || [])[1] || 0) || Math.round(44 * (+((/scale-(\d+)/.exec(lf) || [])[1] || 100)) / 100);
      const score = Math.min(size, 256) + (lf.includes('unplated') ? 300 : 0);
      if (score > bestScore) { bestScore = score; best = path.join(dir, f); }
    }
    const img = best ? nativeImage.createFromPath(best) : null;
    return usable(img) ? img : null;
  } catch { return null; }
}
async function iconFor(p, extra = []) {
  const k = norm(p);
  if (iconCache.has(k) && iconCache.get(k)) return iconCache.get(k);
  let img = null;
  for (const src of [p, ...extra].filter(Boolean)) {
    try { img = await nativeImage.createThumbnailFromPath(src, { width: ICON_PX, height: ICON_PX }); } catch { img = null; }
    if (!usable(img)) { try { img = await app.getFileIcon(src, { size: 'large' }); } catch { img = null; } }
    if (!usable(img)) img = storeAppLogo(src);
    if (usable(img)) break;
  }
  const url = usable(img) ? img.resize({ width: ICON_PX, quality: 'best' }).toDataURL() : null;
  iconCache.set(k, url);
  return url;
}
// Last resort for an open app: the icon on its own window
function iconFromWindow(hwnd) {
  const ic = win32.windowIcon(hwnd);
  if (!ic) return null;
  const img = nativeImage.createFromBitmap(ic.bgra, { width: ic.width, height: ic.height });
  return usable(img) ? img.resize({ width: ICON_PX, quality: 'best' }).toDataURL() : null;
}
// Shortcuts can name their own icon (IconLocation / IconFile), which is often the better logo
function shortcutIcon(p) {
  try {
    if (/\.lnk$/i.test(p)) { const l = shell.readShortcutLink(p); return l.icon && fs.existsSync(l.icon) ? l.icon : null; }
    if (/\.url$/i.test(p)) { const m = /^IconFile=(.+)$/mi.exec(fs.readFileSync(p, 'utf8')); return m && fs.existsSync(m[1].trim()) ? m[1].trim() : null; }
  } catch { /* no icon */ }
  return null;
}

// What a dropped/pinned path launches, and which running app it matches.
function resolve(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.lnk') {
    try {
      const link = shell.readShortcutLink(p);
      const target = link.target || p;
      const m = /--processStart\s+"?([^"\s]+)"?/i.exec(link.args || ''); // Discord, Slack: Update.exe --processStart App.exe
      return { target, key: m ? keyOf(m[1]) : (/\.exe$/i.test(target) ? keyOf(target) : null) };
    } catch { return { target: p, key: null }; }
  }
  if (ext === '.exe') return { target: p, key: keyOf(p) };
  return { target: p, key: null };
}

async function makeItem(p) {
  const ext = path.extname(p);
  const { target, key } = resolve(p);
  let name = path.basename(p, ext) || p;
  if (ext.toLowerCase() === '.exe' && NAMES[key]) name = NAMES[key];
  const own = shortcutIcon(p);
  const first = own || (fs.existsSync(target) ? target : p);
  const icon = await iconFor(first, [target, p]);
  const aumid = storeAppId(target) || storeAppId(p) || undefined; // remembered, so it still opens after the Store updates the app
  return { id: uidId(), name: prettify(name), path: p, target, key, icon, aumid, kind: isDir(target) ? 'folder' : 'app' };
}

function seedPaths() {
  const env = process.env;
  const PF = env.ProgramFiles || 'C:\\Program Files';
  const PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const L = env.LOCALAPPDATA || '';
  const A = env.APPDATA || '';
  return [
    'C:\\Windows\\explorer.exe',
    path.join(PF, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(PF86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(PF, 'Mozilla Firefox\\firefox.exe'),
    path.join(A, 'Spotify\\Spotify.exe'),
    path.join(A, 'Microsoft\\Windows\\Start Menu\\Programs\\Discord Inc\\Discord.lnk'),
    path.join(L, 'Programs\\Microsoft VS Code\\Code.exe'),
    path.join(PF86, 'Steam\\steam.exe'),
  ];
}

// ---------- the list the dock shows ----------
function uidForKey(key) {
  const item = state.items.find((i) => i.key === key);
  return item ? 'p:' + item.id : 'r:' + key;
}
function iconForKey(key) {
  const item = state.items.find((i) => i.key === key);
  if (item) return item.icon;
  const g = windowsByKey.get(key);
  return g ? iconCache.get(norm(g.exe)) || null : null;
}
function dockList() {
  const pinnedKeys = new Set(state.items.map((i) => i.key).filter(Boolean));
  const out = state.items.map((i) => {
    const g = i.key && windowsByKey.get(i.key);
    return {
      uid: 'p:' + i.id, key: i.key, name: i.name, icon: i.icon, kind: i.kind, pinned: true,
      running: !!g, count: g ? g.windows.length : 0, active: !!g && g.windows.some((w) => w.addr === lastAppFg),
      badge: (state.settings.badges !== false && g && g.badge) || 0, attention: state.settings.badges !== false && !!i.key && attention.has(i.key),
    };
  });
  for (const key of unpinnedOrder) {
    const g = windowsByKey.get(key);
    if (!g || pinnedKeys.has(key)) continue;
    out.push({
      uid: 'r:' + key, key, name: appName(key), icon: iconCache.get(norm(g.exe)) || null, kind: 'app',
      pinned: false, running: true, count: g.windows.length, active: g.windows.some((w) => w.addr === lastAppFg),
      badge: (state.settings.badges !== false && g.badge) || 0, attention: state.settings.badges !== false && attention.has(key),
    });
  }
  return out;
}
let lastSent = '';
function sendDock(force) {
  if (!alive(dock)) return;
  const list = dockList();
  const sig = JSON.stringify(list.map((i) => [i.uid, i.name, i.running, i.active, i.count, i.icon ? i.icon.length : 0, i.badge, i.attention]));
  if (!force && sig === lastSent) return;
  lastSent = sig;
  dock.webContents.send('dock', list);
}

// ---------- watching open windows ----------
function pollRunning() { safe('window list', pollRunningNow); }
function pollRunningNow() {
  if (!win32.available || !dock) return;
  let wins;
  try { wins = win32.listWindows(); } catch (e) { console.error(e); return; }
  wins = wins.filter((w) => w.pid !== process.pid && w.exe && !/\\applicationframehost\.exe$/i.test(w.exe));

  const groups = new Map();
  const byAddr = new Map();
  for (const w of wins) {
    const key = keyOf(w.exe);
    if (!groups.has(key)) groups.set(key, { key, exe: w.exe, windows: [] });
    groups.get(key).windows.push(w);
    const old = winByAddr.get(w.addr);
    byAddr.set(w.addr, { key, title: w.title, pid: w.pid, rect: w.rect || (old && old.rect) || null });
  }
  windowsByKey = groups;
  winByAddr = byAddr;
  unpinnedOrder = unpinnedOrder.filter((k) => groups.has(k));
  for (const [key, g] of groups) {
    // Unread counts that apps put in their window title: "(3) WhatsApp", "Inbox (12) – Gmail"
    g.badge = 0;
    for (const w of g.windows) {
      const m = /^\((\d{1,4})\)\s/.exec(w.title) || /\binbox \((\d{1,4})\)/i.exec(w.title);
      if (m) g.badge = Math.max(g.badge, +m[1]);
    }
    if (!unpinnedOrder.includes(key)) unpinnedOrder.push(key);
    if (!iconCache.has(norm(g.exe))) {
      iconFor(g.exe).then((url) => {
        if (!url) { // locked or icon-less file: use the app's window icon
          const w = (windowsByKey.get(key) || g).windows[0];
          const fromWin = w && safe('window icon', () => iconFromWindow(w.hwnd));
          if (fromWin) iconCache.set(norm(g.exe), fromWin);
        }
        // pinned apps that never got a logo pick this one up too
        const got = iconCache.get(norm(g.exe));
        for (const it of state.items) if (it.key === key && !it.icon && !it.customIcon && got) { it.icon = got; persist(); }
        sendDock(true);
      });
    }
  }
  const fg = wins.find((w) => w.foreground);
  if (fg) { lastAppFg = fg.addr; attention.delete(keyOf(fg.exe)); } // you looked at it
  for (const k of [...attention.keys()]) if (!groups.has(k)) attention.delete(k);
  if (state.settings.replaceTaskbar) { // Windows sometimes brings the taskbar back
    win32.showTaskbars(false);
    if (++pollCount % 5 === 0) safe('screen space', fixWorkAreas);
  }
  sendDock();
}
let pollCount = 0;
let gameActive = false;
const GAME_DIRS = /\\(steamapps\\common|epic games|riot games|gog galaxy\\games|xboxgames|ea games|ubisoft game launcher\\games|rockstar games|battle\.net|games)\\/i;
const GAME_LAUNCHERS = /\\(steam\.exe|steamwebhelper\.exe|epicgameslauncher\.exe|riotclientux\.exe|riotclientservices\.exe|galaxyclient\.exe|eadesktop\.exe|upc\.exe|battle\.net\.exe|launcher\.exe)$/i;
const attention = new Map(); // app key -> when it asked for attention (flashing, like an orange taskbar button)
function listenForAttention() {
  const msg = win32.registerShellHook(dock.getNativeWindowHandle());
  if (!msg) return;
  dock.hookWindowMessage(msg, (wParam, lParam) => {
    const code = Number(wParam.readBigUInt64LE(0) & 0xffffn);
    if (code !== 0x8006) return; // HSHELL_FLASH
    const addr = lParam.readBigUInt64LE(0);
    const info = winByAddr.get(addr);
    const key = info ? info.key : null;
    if (!key || addr === lastAppFg) return;
    attention.set(key, Date.now());
    sendDock(true);
  });
}
let pollSoonTimer = null;
const pollSoon = (ms = 60) => { clearTimeout(pollSoonTimer); pollSoonTimer = setTimeout(pollRunning, ms); };

// ---------- clicking an app ----------
async function activate(uid, opts = {}) {
  let key = null, launch = null;
  if (uid.startsWith('p:')) {
    const item = state.items.find((i) => i.id === uid.slice(2));
    if (!item) return 'missing';
    key = item.key; launch = item.path;
  } else if (uid.startsWith('r:')) {
    key = uid.slice(2);
    launch = windowsByKey.get(key)?.exe;
  }
  const g = key && windowsByKey.get(key);
  if (g && g.windows.length) {
    const wins = g.windows;                      // top-most first
    const top = wins[0];
    const inApp = wins.some((w) => w.addr === lastAppFg && !w.minimized);
    if (opts.minimizeAll) {
      wins.forEach((w) => win32.minimize(w.hwnd));
    } else if (inApp && wins.length > 1) {
      // Several windows and you're already in this app: go to the next one (a steady order, so repeated clicks go round them all)
      const order = [...wins].sort((a, b) => (a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0));
      const i = order.findIndex((w) => w.addr === lastAppFg);
      const next = order[(i + 1) % order.length];
      if (next.minimized && state.settings.minimizeToDock) await ghostRestore(next, key, uid);
      win32.focus(next.hwnd);
    } else if (inApp) {
      wins.forEach((w) => win32.minimize(w.hwnd)); // one window and you're in it: minimise, like the taskbar
    } else {
      // Coming from another app: bring all of this app's open windows forward, the last-used one on top
      const shown = wins.filter((w) => !w.minimized);
      if (!shown.length) {
        if (state.settings.minimizeToDock) await ghostRestore(top, key, uid);
        win32.focus(top.hwnd);
      } else {
        for (const w of shown.slice(1).reverse()) safe('raise', () => win32.toTop(w.hwnd));
        win32.focus(shown[0].hwnd);
      }
    }
    pollSoon(200);
    return 'focused';
  }
  if (launch) {
    const item = uid.startsWith('p:') ? state.items.find((i) => i.id === uid.slice(2)) : null;
    if (item && !item.aumid) { const id = storeAppId(item.path) || storeAppId(item.target); if (id) { item.aumid = id; persist(); } }
    const err = await launchThing(launch, item && item.aumid);
    pollSoon(800);
    return err ? 'error' : 'launched';
  }
  return 'missing';
}

// ---------- minimise into the dock ----------
const physToDip = (r) => screen.screenToDipRect(null, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
const centerIn = (r, b) => { const cx = r.x + r.width / 2, cy = r.y + r.height / 2; return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height; };

async function iconScreenRect(uid) {
  if (!alive(dock)) return null;
  let r = null;
  try { r = await dock.webContents.executeJavaScript(`window.__iconRect(${JSON.stringify(uid)})`); } catch { /* page busy */ }
  if (!r) return null;
  const wb = dock.getBounds();
  return { x: wb.x + r.x, y: wb.y + r.y, width: r.width, height: r.height };
}

function playGhost(g) {
  if (!alive(overlay)) return Promise.resolve();
  const b = targetDisplay().bounds;
  if (JSON.stringify(overlay.getBounds()) !== JSON.stringify(b)) overlay.setBounds(b);
  const rel = (r) => ({ x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height });
  ghostsRunning++;
  if (!overlay.isVisible()) overlay.showInactive();
  overlay.webContents.send('ghost', { ...g, from: rel(g.from), to: rel(g.to) });
  return new Promise((res) => setTimeout(res, g.dir === 'min' ? 400 : 300));
}
ipcMain.on('ghost-done', () => {
  ghostsRunning = Math.max(0, ghostsRunning - 1);
  if (!ghostsRunning && alive(overlay)) setTimeout(() => { if (!ghostsRunning) overlay.hide(); }, 60);
});

async function ghostMinimize(hwnd, addr) {
  const info = winByAddr.get(addr);
  if (!info || info.pid === process.pid) return;
  const uid = uidForKey(info.key);
  let r = win32.rect(hwnd);
  if (!r || r.left <= -30000) r = info.rect;
  if (!r) return;
  const from = physToDip(r);
  if (!shown || !centerIn(from, targetDisplay().bounds)) { dock.webContents.send('catch', uid); return; }
  const to = await iconScreenRect(uid);
  if (!to) return;
  await playGhost({ dir: 'min', from, to, icon: iconForKey(info.key), title: info.title });
  dock.webContents.send('catch', uid);
}

async function ghostRestore(win, key, uid) {
  const info = winByAddr.get(win.addr);
  if (!info || !info.rect || !shown) return;
  const to = physToDip(info.rect);
  if (!centerIn(to, targetDisplay().bounds)) return;
  const from = await iconScreenRect(uid);
  if (!from) return;
  await playGhost({ dir: 'restore', from, to, icon: iconForKey(key), title: info.title });
}

// Start, Quick Settings and the notification panel close as soon as the dock is clicked.
// Remember which one was open, so clicking its tile again closes it instead of reopening it.
let openFlyout = null;
let flyoutClosed = { kind: null, at: 0 };
function flyoutKind(info) {
  const exe = path.basename((info && info.exe) || '').toLowerCase();
  if (['startmenuexperiencehost.exe', 'searchhost.exe', 'searchapp.exe'].includes(exe)) return 'start';
  if (exe === 'shellexperiencehost.exe') {
    if (/notification|calendar/i.test(info.title)) return 'notify';
    if (/quick|control|action/i.test(info.title)) return 'quick';
    return 'shell';
  }
  return null;
}

function onWinEvent(event, hwnd, addr) {
  if (event === EV.FOREGROUND) {
    const info = win32.windowInfo(hwnd);
    if (info && info.pid === process.pid) { // the dock itself was clicked
      if (openFlyout) flyoutClosed = { kind: openFlyout, at: Date.now() };
      openFlyout = null;
      return;
    }
    openFlyout = flyoutKind(info);
    pollSoon(40);
    return;
  }
  if (event === EV.MOVESIZEEND) {
    const info = winByAddr.get(addr);
    const r = win32.rect(hwnd);
    if (info && r && r.left > -30000) info.rect = r;
    return;
  }
  if (event === EV.MINIMIZESTART) {
    if (state.settings.minimizeToDock) ghostMinimize(hwnd, addr);
    pollSoon(150);
  }
  if (event === EV.MINIMIZEEND) pollSoon(150);
}

function applyMinimizeSetting() { safe('minimise animation', applyMinimizeSettingNow); }
function applyMinimizeSettingNow() {
  if (!win32.available) return;
  if (state.settings.minimizeToDock) {
    if (state.restore.minAnimate == null) { state.restore.minAnimate = win32.getMinAnimate(); persist(); }
    win32.setMinAnimate(false); // our own animation replaces Windows' fly-to-taskbar one
  } else if (state.restore.minAnimate != null) {
    win32.setMinAnimate(!!state.restore.minAnimate);
    state.restore.minAnimate = null; persist();
  }
}

// ---------- replacing the Windows taskbar ----------
function applyTaskbarSetting() { safe('taskbar', applyTaskbarSettingNow); }
function applyTaskbarSettingNow() {
  if (!win32.available) return;
  if (state.settings.replaceTaskbar) {
    if (state.restore.taskbarAutoHide == null) { state.restore.taskbarAutoHide = win32.taskbarAutoHide(); persist(); }
    win32.setTaskbarAutoHide(true); // stops the taskbar from reserving space...
    // ...but Windows applies that a moment later, so hide it afterwards and reclaim the space it held
    setTimeout(() => safe('taskbar', () => { win32.showTaskbars(false); fixWorkAreas(); }), 700);
  } else {
    win32.showTaskbars(true);
    if (state.restore.taskbarAutoHide != null) {
      win32.setTaskbarAutoHide(state.restore.taskbarAutoHide);
      state.restore.taskbarAutoHide = null; persist();
    }
  }
}

const reserving = () => state.settings.autoHide === 'off' || state.settings.autoHide === 'fullscreen';
const reserveHeight = (d) => Math.round((state.settings.size * 1.28 + 10) * d.scaleFactor); // physical px

// With the taskbar replaced, no screen should keep an empty strip where the taskbar used to be.
// If Windows (or a taskbar tool) keeps taking the space back, stop after a few tries instead of
// fighting it, because every round makes maximised windows jump.
const workAreaTries = new Map(); // display id -> { count, since, gaveUp }
function fixWorkAreas() {
  if (!win32.available || !state.settings.replaceTaskbar) return;
  const dockDisplay = targetDisplay();
  const now = Date.now();
  for (const d of screen.getAllDisplays()) {
    const pb = screen.dipToScreenRect(null, d.bounds);
    const pw = screen.dipToScreenRect(null, d.workArea);
    const want = { left: pb.x, top: pb.y, right: pb.x + pb.width, bottom: pb.y + pb.height };
    if (d.id === dockDisplay.id && reserving()) want.bottom -= reserveHeight(d);
    const have = { left: pw.x, top: pw.y, right: pw.x + pw.width, bottom: pw.y + pw.height };
    const off = Object.keys(want).some((k) => Math.abs(want[k] - have[k]) > 2);
    if (!off) continue;
    let t = workAreaTries.get(d.id);
    if (!t || now - t.since > 120000) { t = { count: 0, since: now, gaveUp: false }; workAreaTries.set(d.id, t); }
    if (t.gaveUp) continue;
    if (t.count >= 3) {
      t.gaveUp = true;
      console.error(`[screen space] Windows keeps reserving part of "${d.label || 'a screen'}" (${have.left},${have.top} to ${have.right},${have.bottom}). Leaving it alone so windows stop jumping.`);
      continue;
    }
    t.count++;
    win32.setWorkArea(want);
  }
}

// Keep maximised windows above the dock when it's always showing.
function applyReservedSpace() { safe('reserve space', applyReservedSpaceNow); }
function applyReservedSpaceNow() {
  if (!win32.available || !alive(dock)) return;
  const s = state.settings;
  if (reserving()) {
    const d = targetDisplay();
    const pb = screen.dipToScreenRect(null, d.bounds);
    win32.appbarSet(dock.getNativeWindowHandle(), { left: pb.x, top: pb.y, right: pb.x + pb.width, bottom: pb.y + pb.height }, reserveHeight(d));
  } else {
    win32.appbarRemove();
  }
  setTimeout(() => safe('screen space', fixWorkAreas), 300);
}

function restoreWindowsSettings() { safe('restore', restoreWindowsSettingsNow); }
function restoreWindowsSettingsNow() {
  if (!win32.available) return;
  try { win32.appbarRemove(); } catch { /* ignore */ }
  try { win32.showTaskbars(true); } catch { /* ignore */ }
  if (state.restore.taskbarAutoHide != null) { win32.setTaskbarAutoHide(state.restore.taskbarAutoHide); state.restore.taskbarAutoHide = null; }
  if (state.restore.minAnimate != null) { win32.setMinAnimate(!!state.restore.minAnimate); state.restore.minAnimate = null; }
  store.flush(state);
}

// ---------- auto-hide ----------
function setShown(v, deep) {
  if (v === shown) return;
  shown = v;
  if (v) {
    if (!dock.isVisible()) dock.showInactive();
    dock.webContents.send('visible', true);
  } else {
    barRect = null;
    if (capturing) { capturing = false; dock.setIgnoreMouseEvents(true, { forward: true }); }
    dock.webContents.send('visible', false);
    if (deep) setTimeout(() => { if (!shown && alive(dock)) dock.hide(); }, 480); // fully out of the way of games
  }
}

let restRect = null; // the bar's screen position while shown, in DIP
function visibilityTick() { safe('auto-hide', visibilityTickNow); }
// Is a full-screen app (game, video, F11 browser) covering this display right now?
function fullscreenOn(d) {
  const fg = win32.foregroundInfo();
  if (!fg || fg.pid === process.pid || fg.minimized || fg.maximized || fg.hasCaption || !fg.rect) return false;
  if (['Progman', 'WorkerW', 'Shell_TrayWnd'].includes(fg.cls)) return false;
  const pb = screen.dipToScreenRect(null, d.bounds);
  const r = fg.rect;
  return r.left <= pb.x && r.top <= pb.y && r.right >= pb.x + pb.width && r.bottom >= pb.y + pb.height;
}

function visibilityTickNow() {
  if (!alive(dock)) return;
  const s = state.settings;
  const disp = targetDisplay();
  const b = disp.bounds;
  const now = Date.now();
  const c = screen.getCursorScreenPoint();
  const nearBarX = !restRect || (c.x >= restRect.x - 160 && c.x <= restRect.x + restRect.width + 160);
  const atEdge = c.y >= b.y + b.height - 3 && c.x >= b.x && c.x < b.x + b.width && nearBarX;
  if (atEdge) { if (!edgeSince) edgeSince = now; } else edgeSince = 0;

  let fullscreen = false, overlaps = false;
  const fg = win32.foregroundInfo();
  if (fg && fg.pid !== process.pid && !fg.minimized && fg.rect && !['Progman', 'WorkerW', 'Shell_TrayWnd'].includes(fg.cls)) {
    const pb = screen.dipToScreenRect(null, b);
    const r = fg.rect;
    fullscreen = !fg.hasCaption && !fg.maximized && r.left <= pb.x && r.top <= pb.y && r.right >= pb.x + pb.width && r.bottom >= pb.y + pb.height;
    if (restRect) {
      const fr = physToDip(r);
      overlaps = fr.x < restRect.x + restRect.width && fr.x + fr.width > restRect.x && fr.y + fr.height > restRect.y - 4 && fr.y < restRect.y + restRect.height;
    }
  }

  // Game mode: a full-screen app, or anything running from a game library folder
  const gameNow = s.gameMode !== false && !!fg && fg.pid !== process.pid && (fullscreen || (GAME_DIRS.test(fg.exe || '') && !GAME_LAUNCHERS.test(fg.exe || '')));
  if (gameNow !== gameActive) {
    gameActive = gameNow;
    if (island) island.send('game', { on: gameNow, name: gameNow && fg.exe ? appName(keyOf(fg.exe)) : '' });
  }

  let wantHide = false;
  if (gameActive) wantHide = true;
  else if (s.autoHide === 'always') wantHide = true;
  else if (s.autoHide === 'smart') wantHide = fullscreen || overlaps;
  else if (s.autoHide === 'fullscreen') wantHide = fullscreen;

  // Pushing the mouse to the bottom edge brings it back. In full-screen games it needs a short hold.
  // In a game the dock stays away until you Alt+Tab out or close it (unless you allow the edge reveal)
  const edgeOk = gameActive && !s.gameEdgeReveal ? false : atEdge && (!(fullscreen || gameActive) || now - edgeSince > 350);
  if ((alive(soundWin) && soundWin.isVisible()) || (stacks && stacks.isOpen())) revealUntil = now + 600; // keep the dock up while a panel is open
  // ...and the whole time the settings window is open (not minimised), so you can see your changes
  if (alive(settingsWin) && settingsWin.isVisible() && !settingsWin.isMinimized()) revealUntil = now + 600;
  if (edgeOk || capturing) revealUntil = now + (s.autoHide === 'always' || s.autoHide === 'smart' ? 650 : 900);
  if (wantHide && now < revealUntil) wantHide = false;
  setShown(!wantHide, wantHide && (fullscreen || gameActive));
}

// ---------- right-click menus ----------
function itemFor(uid) { return uid && uid.startsWith('p:') ? state.items.find((i) => i.id === uid.slice(2)) : null; }

async function changeIcon(item) {
  const res = await dialog.showOpenDialog({
    title: `Choose an icon for ${item.name}`,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return;
  const img = nativeImage.createFromPath(res.filePaths[0]);
  if (img.isEmpty()) return;
  item.icon = img.resize({ width: ICON_PX, quality: 'best' }).toDataURL();
  item.customIcon = true;
  persist(); sendDock(true);
}

async function pinRunning(key, index) {
  const g = windowsByKey.get(key);
  if (!g) return;
  const item = await makeItem(g.exe);
  item.name = appName(key);
  state.items.splice(index ?? state.items.length, 0, item);
  persist(); sendDock(true);
}

const HIDE_LABELS = { off: 'Never', fullscreen: 'Only for full-screen apps', smart: 'When a window touches the dock', always: 'Always (show at the bottom edge)' };
function workspaceMenu() {
  const list = state.workspaces || [];
  return [
    ...list.map((w, i) => ({ label: `${w.icon} ${w.name}`, type: 'radio', checked: state.activeWorkspace === w.id, accelerator: i < 9 ? `Alt+Shift+${i + 1}` : undefined, registerAccelerator: false, click: () => workspaces.activate(w.id) })),
    ...(list.length ? [{ type: 'separator' }] : []),
    { label: 'New workspace from open windows', click: () => { workspaces.create().then(() => openSettings('workspaces')).catch(() => {}); } },
    { label: 'Edit workspaces…', click: () => openSettings('workspaces') },
  ];
}
function broadcastWorkspaces() {
  const data = { list: state.workspaces, active: state.activeWorkspace };
  if (alive(dock)) dock.webContents.send('workspaces', data);
  if (alive(settingsWin)) settingsWin.webContents.send('workspaces', data);
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(dockMenuTemplate()));
  registerHotkeys();
}

ipcMain.on('ws-menu', (_e, id) => {
  const w = state.workspaces.find((x) => x.id === id);
  if (!w) return;
  Menu.buildFromTemplate([
    { label: `Switch to ${w.name}`, click: () => workspaces.activate(id) },
    { label: 'Update with the windows open now', click: () => workspaces.recapture(id) },
    { label: 'Edit…', click: () => openSettings('workspaces') },
    { type: 'separator' },
    { label: 'Delete workspace', click: () => { const i = state.workspaces.indexOf(w); state.workspaces.splice(i, 1); if (state.activeWorkspace === id) state.activeWorkspace = null; persist(); broadcastWorkspaces(); } },
  ]).popup({ window: dock });
});

function dockMenuTemplate() {
  const ready = updater && updater.state.status === 'ready';
  return [
    ...(ready ? [{ label: `Restart to update to ${updater.state.version}`, click: () => updater.install() }, { type: 'separator' }] : []),
    { label: 'Dock settings…', click: openSettings },
    { label: 'Workspaces', submenu: workspaceMenu() },
    { label: 'Show the music player on the dock', type: 'checkbox', checked: !!state.settings.media, click: (m) => saveSettings({ media: m.checked }) },
    { label: 'Auto-hide', submenu: Object.entries(HIDE_LABELS).map(([v, label]) => ({
      label, type: 'radio', checked: state.settings.autoHide === v, click: () => saveSettings({ autoHide: v }),
    })) },
    { label: 'Replace the Windows taskbar', type: 'checkbox', checked: state.settings.replaceTaskbar,
      click: (m) => saveSettings({ replaceTaskbar: m.checked }) },
    { type: 'separator' },
    { label: 'Quit Glass Dock', click: () => app.quit() },
  ];
}

ipcMain.on('dock-menu', () => Menu.buildFromTemplate(dockMenuTemplate()).popup({ window: dock }));

ipcMain.on('context', (_e, uid) => {
  const item = itemFor(uid);
  const key = item ? item.key : uid.startsWith('r:') ? uid.slice(2) : null;
  const g = key && windowsByKey.get(key);
  const launchPath = item ? item.path : g ? g.exe : null;
  const tpl = [];
  if (g) {
    for (const w of g.windows.slice(0, 10)) {
      tpl.push({ label: w.title.length > 60 ? w.title.slice(0, 57) + '…' : w.title, click: () => win32.focus(w.hwnd) });
    }
    tpl.push({ type: 'separator' });
  }
  if (launchPath) {
    tpl.push({ label: g ? 'New window' : 'Open', click: () => launchThing(launchPath, item && item.aumid) });
    const showPath = item && fs.existsSync(item.target) ? item.target : launchPath;
    tpl.push({ label: 'Show in folder', click: () => shell.showItemInFolder(showPath) });
    tpl.push({ type: 'separator' });
  }
  if (item) {
    tpl.push({ label: 'Change icon…', click: () => changeIcon(item) });
    if (item.customIcon) {
      tpl.push({ label: 'Use original icon', click: async () => {
        iconCache.delete(norm(item.target)); iconCache.delete(norm(item.path));
        item.icon = await iconFor(fs.existsSync(item.target) ? item.target : item.path);
        item.customIcon = false; persist(); sendDock(true);
      } });
    }
    tpl.push({ label: 'Remove from dock', click: () => { state.items = state.items.filter((i) => i !== item); persist(); sendDock(true); } });
  } else if (g) {
    tpl.push({ label: 'Keep in dock', click: () => pinRunning(key) });
  }
  if (g && key) {
    const list = state.workspaces || [];
    tpl.push({ label: 'Add to workspace', submenu: [
      ...list.map((w) => ({ label: `${w.icon} ${w.name}`, enabled: !w.apps.some((a) => a.key === key), click: () => workspaces.addApp(w.id, key) })),
      ...(list.length ? [{ type: 'separator' }] : []),
      { label: 'New workspace from open windows', click: () => { workspaces.create().then(() => openSettings('workspaces')).catch(() => {}); } },
    ] });
  }
  if (g) {
    tpl.push({ type: 'separator' });
    if (g.windows.length > 1) tpl.push({ label: `Minimise all windows (${g.windows.length})`, click: () => g.windows.forEach((w) => win32.minimize(w.hwnd)) });
    tpl.push({ label: g.windows.length > 1 ? `Quit (${g.windows.length} windows)` : 'Quit',
      click: () => { g.windows.forEach((w) => win32.close(w.hwnd)); pollSoon(600); } });
  }
  Menu.buildFromTemplate(tpl).popup({ window: dock });
});

// ---------- drag & drop ----------
const pinnable = (p) => /\.(exe|lnk|url|appref-ms)$/i.test(p) || isDir(p);

ipcMain.handle('drop', async (_e, { paths, index, overUid }) => {
  paths = (paths || []).filter(Boolean);
  if (!paths.length) return 'none';
  if (overUid && !paths.every(pinnable)) { // plain files dropped on an app open with that app
    const item = itemFor(overUid);
    const exe = item ? item.target : overUid.startsWith('r:') ? windowsByKey.get(overUid.slice(2))?.exe : null;
    if (exe && /\.exe$/i.test(exe)) {
      spawn(exe, paths, { detached: true, stdio: 'ignore' }).unref();
      return 'opened';
    }
  }
  const fresh = [];
  for (const p of paths) {
    if (state.items.some((i) => norm(i.path) === norm(p))) continue;
    fresh.push(await makeItem(p));
  }
  const at = Math.max(0, Math.min(index ?? state.items.length, state.items.length));
  state.items.splice(at, 0, ...fresh);
  persist(); sendDock(true);
  return 'pinned';
});

ipcMain.handle('reorder', async (_e, { uid, index }) => {
  if (uid.startsWith('r:')) return pinRunning(uid.slice(2), index);
  // index = how many pinned apps should come before it once it's moved
  const from = state.items.findIndex((i) => 'p:' + i.id === uid);
  if (from < 0) return;
  const [item] = state.items.splice(from, 1);
  state.items.splice(Math.max(0, Math.min(index, state.items.length)), 0, item);
  persist(); sendDock(true);
});

ipcMain.handle('trash', async (_e, paths) => {
  for (const p of paths || []) { try { await shell.trashItem(p); } catch (e) { console.error(e); } }
});

const VK_WIN = 0x5B;
ipcMain.on('open-system', (_e, which) => {
  if (which === 'settings') { openSettings(); return; }
  if (which === 'downloads') shell.openPath(app.getPath('downloads'));
  if (which === 'trash') spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref();
  if (['start', 'quick', 'notify'].includes(which)) {
    const f = flyoutClosed;
    flyoutClosed = { kind: null, at: 0 };
    const sameOne = f.kind === which || (f.kind === 'shell' && which !== 'start');
    if (sameOne && Date.now() - f.at < 900) return; // this click already closed it
  }
  if (which === 'start') win32.pressKeys([VK_WIN]);
  if (which === 'quick') win32.pressKeys([VK_WIN, 0x41]);  // Win + A
  if (which === 'notify') win32.pressKeys([VK_WIN, 0x4E]); // Win + N
});

// ---------- music ----------
ipcMain.on('media', (_e, cmd) => { if (['toggle', 'next', 'prev', 'switch'].includes(cmd) || /^seek \d+(\.\d+)?$/.test(cmd)) media.send(cmd); });
ipcMain.on('media-focus', (_e, aumid) => {
  const a = String(aumid || '').toLowerCase();
  let key = a.includes('spotify') ? 'spotify.exe' : a.split('!')[0];
  if (!key.endsWith('.exe')) key += '.exe';
  const g = windowsByKey.get(key);
  if (g) win32.focus(g.windows[0].hwnd);
});
// The dock player and the island both use the music reader; it runs while either is on
function applyMediaSetting() {
  const s = state.settings;
  if (s.media || (s.island && s.island.on && s.island.music)) media.start(); else media.stop();
}

// ---------- sound panel ----------
function applySoundSetting() { if (state.settings.soundButton) sound.start(); else { sound.stop(); if (alive(soundWin)) soundWin.hide(); } }

function createSoundWin() {
  soundWin = new BrowserWindow({
    width: 340, height: 420, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    show: false, backgroundColor: '#00000000', webPreferences: webPrefs,
  });
  soundWin.setAlwaysOnTop(true, 'pop-up-menu');
  soundWin.loadFile(path.join(__dirname, 'renderer', 'sound.html'));
  soundWin.on('blur', () => { if (soundWin.isVisible()) { soundWin.hide(); soundHiddenAt = Date.now(); } });
}

let soundAnchor = null; // { cx, bottom }: the panel sits centred above this point, clear of the tile
function placeSound(height) {
  if (!alive(soundWin) || !soundAnchor) return;
  const b = targetDisplay().bounds;
  const width = 340;
  const x = Math.round(Math.max(b.x + 8, Math.min(soundAnchor.cx - width / 2, b.x + b.width - width - 8)));
  const y = Math.round(Math.max(b.y + 8, soundAnchor.bottom - height));
  soundWin.setBounds({ x, y, width, height });
}
ipcMain.on('sound-open', async (_e, r) => {
  if (!alive(dock)) return;
  if (!alive(soundWin)) createSoundWin();
  if (soundWin.isVisible()) { soundWin.hide(); return; }
  if (soundWin.webContents.isLoading()) await new Promise((res) => soundWin.webContents.once('did-finish-load', res));
  if (Date.now() - soundHiddenAt < 300) return; // the click that closed it shouldn't reopen it
  const wb = dock.getBounds();
  const tileTop = wb.y + r.y;                   // top of the (enlarged) tile
  const barTop = restRect ? restRect.y : tileTop;
  soundAnchor = { cx: wb.x + r.x + r.width / 2, bottom: Math.min(tileTop, barTop) - 12 };
  placeSound(soundWin.getBounds().height);
  soundWin.show();
  soundWin.focus();
  if (sound.last) soundWin.webContents.send('sound', sound.last);
});
ipcMain.on('sound-size', (_e, h) => {
  if (!alive(soundWin)) return;
  const height = Math.max(120, Math.min(900, Math.ceil(h)));
  if (soundAnchor) placeSound(height); // grow upwards, never down over the tile
  else { const b = soundWin.getBounds(); soundWin.setBounds({ ...b, height }); }
});
ipcMain.on('sound-cmd', (_e, cmd) => { if (/^(set|vol|micvol|mute|micmute) \S/.test(cmd)) sound.send(cmd); });
ipcMain.on('sound-settings', () => { shell.openExternal('ms-settings:sound'); if (alive(soundWin)) soundWin.hide(); });

ipcMain.handle('activate', (_e, uid, opts) => activate(uid, opts || {}));
ipcMain.handle('get-state', () => ({ settings: state.settings, list: dockList(), media: media.last, sound: sound.last, workspaces: { list: state.workspaces, active: state.activeWorkspace } }));
ipcMain.on('bar-rect', (_e, r) => {
  if (!shown || !alive(dock)) return;
  barRect = r;
  const wb = dock.getBounds();
  if (!capturing) restRect = { x: wb.x + r.x, y: wb.y + r.y, width: r.width, height: r.height };
});

// ---------- click-through: only the bar itself catches the mouse ----------
function capturePoll() { safe('mouse', capturePollNow); }
let dragLock = false; // while you drag an icon around, the dock keeps hold of the mouse
ipcMain.on('dock-drag', (_e, on) => {
  dragLock = !!on;
  if (dragLock && alive(dock) && !capturing) { capturing = true; dock.setIgnoreMouseEvents(false); }
});
ipcMain.handle('remove-item', (_e, uid) => {
  const it = itemFor(uid);
  if (!it) return;
  state.items = state.items.filter((x) => x !== it);
  persist(); sendDock(true);
});
function capturePollNow() {
  if (dragLock) return;
  if (!alive(dock) || !barRect || !shown || !dock.isVisible()) return;
  const c = screen.getCursorScreenPoint();
  const wb = dock.getBounds();
  const x = c.x - wb.x, y = c.y - wb.y;
  const inBar = x >= barRect.x && x <= barRect.x + barRect.width && y >= barRect.y && y <= wb.height;
  const inHead = x >= barRect.x - 24 && x <= barRect.x + barRect.width + 24 && y >= barRect.y - barRect.head && y <= wb.height;
  const want = capturing ? inHead : inBar;
  if (want !== capturing) {
    capturing = want;
    dock.setIgnoreMouseEvents(!want, { forward: true });
  }
}

// ---------- windows ----------
function targetDisplay() {
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(state.settings.displayId)) || screen.getPrimaryDisplay();
}
function dockBounds() {
  const b = targetDisplay().bounds;
  return { x: b.x, y: b.y + b.height - DOCK_HEIGHT, width: b.width, height: DOCK_HEIGHT };
}
function reposition() {
  if (!alive(dock)) return;
  dock.setBounds(dockBounds());
  restRect = null;
  applyReservedSpace();
}

const webPrefs = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };

function createDock() {
  dock = new BrowserWindow({
    ...dockBounds(),
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: webPrefs,
  });
  dock.setAlwaysOnTop(true, 'pop-up-menu');
  dock.setIgnoreMouseEvents(true, { forward: true });
  dock.loadFile(path.join(__dirname, 'renderer', 'dock.html'));
  dock.once('ready-to-show', () => {
    dock.showInactive(); applyReservedSpace(); safe('attention', listenForAttention);
    if (!alive(soundWin)) createSoundWin(); // ready before the first click, so it opens complete
  });
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...targetDisplay().bounds,
    frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: webPrefs,
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
}

function openSettings(tab) {
  const show = () => { if (typeof tab === 'string') settingsWin.webContents.send('settings-tab', tab); };
  if (alive(settingsWin)) { settingsWin.show(); settingsWin.focus(); show(); return; }
  settingsWin = new BrowserWindow({
    width: 480, height: 820, minWidth: 400, title: 'Glass Dock settings', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: webPrefs,
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.webContents.once('did-finish-load', show);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')); // tray@2x.png is picked up on high-DPI screens
  tray = new Tray(img);
  tray.setToolTip('Glass Dock');
  tray.on('click', openSettings);
  tray.setContextMenu(Menu.buildFromTemplate(dockMenuTemplate()));
}

// ---------- settings ----------
function saveSettings(patch) {
  const prev = state.settings;
  state.settings = { ...prev, ...patch, look: { ...prev.look, ...(patch.look || {}) } };
  const s = state.settings;
  persist();
  registerHotkeys();
  if (String(s.displayId) !== String(prev.displayId)) reposition();
  if (s.replaceTaskbar !== prev.replaceTaskbar) { workAreaTries.clear(); applyTaskbarSetting(); }
  if (s.minimizeToDock !== prev.minimizeToDock) applyMinimizeSetting();
  if (s.media !== prev.media || JSON.stringify(s.island) !== JSON.stringify(prev.island)) applyMediaSetting();
  if (s.soundButton !== prev.soundButton) applySoundSetting();
  if (s.autoHide !== prev.autoHide || s.size !== prev.size) { applyReservedSpace(); revealUntil = 0; }
  if (alive(dock)) dock.webContents.send('settings', s);
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(dockMenuTemplate()));
  if (alive(settingsWin)) settingsWin.webContents.send('settings', s);
  if (island) island.apply();
  return s;
}

ipcMain.handle('save-settings', (_e, s) => saveSettings(s));
ipcMain.handle('pv-shortcut', (_e, accel) => {
  const a = String(accel || '').trim();
  if (!/^((Ctrl|Alt|Shift|Super)\+)+[A-Z0-9]$|^((Ctrl|Alt|Shift|Super)\+)+F([1-9]|1[0-2])$/i.test(a)) return { ok: false, error: 'Use something like Alt+Shift+0.' };
  const ok = privateWs.registerShortcut(a);
  if (!ok) { privateWs.registerShortcut(state.settings.privateShortcut || 'Alt+Shift+0'); return { ok: false, error: 'Windows or another app is already using that shortcut.' }; }
  saveSettings({ privateShortcut: a });
  return { ok: true };
});
// Quick launch favourites for the island: pick apps, shortcuts or folders
ipcMain.handle('island-launch-add', async (_e, folder) => {
  const res = await dialog.showOpenDialog(alive(settingsWin) ? settingsWin : undefined, {
    title: folder ? 'Choose a folder for quick launch' : 'Choose apps or shortcuts for quick launch',
    defaultPath: folder ? app.getPath('home') : path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
    properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
    filters: folder ? undefined : [{ name: 'Apps and shortcuts', extensions: ['exe', 'lnk', 'url', 'appref-ms'] }, { name: 'Any file', extensions: ['*'] }],
  });
  if (res.canceled) return state.settings;
  const list = [...(state.settings.island.launch || [])];
  for (const p of res.filePaths) {
    if (list.length >= 8 || list.some((x) => norm(x.path) === norm(p))) continue;
    const it = await makeItem(p);
    list.push({ path: p, name: it.name, icon: it.icon });
  }
  return saveSettings({ island: { ...state.settings.island, launch: list } });
});
ipcMain.handle('settings-info', () => ({
  settings: state.settings,
  displays: screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    label: `${d.label || 'Display'} (${d.size.width}×${d.size.height})`,
    primary: d.id === screen.getPrimaryDisplay().id,
  })),
  login: app.getLoginItemSettings().openAtLogin,
  packaged: app.isPackaged,
}));
ipcMain.handle('set-login', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});

// ---------- keyboard shortcuts ----------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (privateWs) privateWs.registerShortcut(state.settings.privateShortcut || 'Alt+Shift+0'); // always on, even with other shortcuts off
  if (!state.settings.hotkeys) return;
  for (let n = 1; n <= 9; n++) {
    globalShortcut.register(`Alt+${n}`, () => {
      const it = dockList()[n - 1];
      if (it) activate(it.uid);
    });
    globalShortcut.register(`Alt+Shift+${n}`, () => { // not Ctrl+Alt: that is AltGr, which types { [ ] } on Icelandic keyboards
      const w = (state.workspaces || [])[n - 1];
      if (w) workspaces.activate(w.id);
    });
  }
}

// ---------- start up / shut down ----------
app.whenReady().then(async () => {
  await learnGenericIcon();
  // Music glow: lets the dock listen to what the PC is playing (system sound only, nothing is recorded)
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });
  state = store.load();
  // Put back anything a crash may have left changed
  if (!state.settings.replaceTaskbar && state.restore.taskbarAutoHide != null) applyTaskbarSetting();
  if (!state.settings.minimizeToDock && state.restore.minAnimate != null) applyMinimizeSetting();
  if (!state.items) {
    state.items = [];
    for (const p of seedPaths()) if (fs.existsSync(p)) state.items.push(await makeItem(p));
    persist();
  }
  for (const it of state.items) if (!it.aumid) { const id = storeAppId(it.target) || storeAppId(it.path); if (id) { it.aumid = id; persist(); } }
  // Give pinned apps that are still missing a logo (or only have the blank one) another try
  for (const it of state.items) {
    if (it.customIcon) continue;
    if (it.icon) {
      let img = null;
      try { img = nativeImage.createFromDataURL(it.icon); } catch { /* bad data */ }
      if (img && !img.isEmpty() && !isGenericIcon(img)) continue;
      it.icon = null;
    }
    it.icon = await iconFor(shortcutIcon(it.path) || it.target || it.path, [it.target, it.path]);
    if (it.icon) persist();
  }
  createDock();
  island = createIsland({
    getSettings: () => state.settings, win32, dockDisplay: targetDisplay, fullscreenOn, webPrefs, safe, media, isGame: () => gameActive,
  });
  island.start();
  updater = createUpdater({
    notify: (m) => island.send('update', m),
    onChange: (st) => {
      if (alive(settingsWin)) settingsWin.webContents.send('update-state', { ...st, current: app.getVersion() });
      if (tray) tray.setContextMenu(Menu.buildFromTemplate(dockMenuTemplate()));
    },
  });
  stacks = createStacks({
    webPrefs, safe, dockWin: () => (alive(dock) ? dock : null), restRect: () => restRect,
    resolveDir: (uid) => { const it = itemFor(uid); return it && it.kind === 'folder' ? it.target : null; },
  });
  workspaces = createWorkspaces({
    getState: () => state, persist, win32, keyOf, appName, safe, saveSettings, launchThing,
    notify: (m) => island.send('workspace', m), broadcast: broadcastWorkspaces,
  });
  privateWs = createPrivate({ getState: () => state, persist, workspaces, webPrefs, safe, newId: uidId });
  registerHotkeys();
  createOverlay();
  createTray();
  registerHotkeys();
  applyTaskbarSetting();
  applyMinimizeSetting();
  applyMediaSetting();
  applySoundSetting();
  unhookEvents = safe('window events', () => win32.onWinEvents(onWinEvent)) || (() => {});
  pollRunning();
  setInterval(pollRunning, 1000);
  setInterval(capturePoll, 30);
  setInterval(visibilityTick, 90);
  screen.on('display-metrics-changed', (_e, _d, changed) => {
    if (changed.every((c) => c === 'workArea')) return; // only the usable area moved (often because of us) – nothing to redo
    workAreaTries.clear();
    reposition();
  });
  screen.on('display-added', () => { workAreaTries.clear(); reposition(); });
  screen.on('display-removed', () => { workAreaTries.clear(); reposition(); });
  const welcome = path.join(app.getPath('userData'), '.welcomed-0.2');
  if (!fs.existsSync(welcome)) { fs.writeFileSync(welcome, '1'); openSettings(); }
});

function cleanup() {
  if (quitting) return;
  quitting = true;
  try { unhookEvents(); } catch { /* ignore */ }
  try { media.stop(); } catch { /* ignore */ }
  try { sound.stop(); } catch { /* ignore */ }
  try { if (island) island.stop(); } catch { /* ignore */ }
  globalShortcut.unregisterAll();
  if (state) restoreWindowsSettings();
}

app.on('second-instance', openSettings);
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', cleanup);
app.on('will-quit', cleanup);
process.on('uncaughtException', (e) => console.error('[unexpected]', e)); // log it and keep the dock running
process.on('unhandledRejection', (e) => console.error('[unexpected]', e));
