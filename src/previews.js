// Window previews: hover an open app on the dock to see its windows; click one to jump to it.
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('path');

const CARD_W = 232, CARD_H = 176, PAD = 10;

module.exports = function createPreviews({ webPrefs, getGroup, getIcon, win32, dockWin, restRect, safe, onFocus }) {
  let win = null;
  let current = null;      // { key, iconRect (screen DIP) }
  let refreshTimer = null, watchTimer = null, outSince = 0;
  const alive = () => win && !win.isDestroyed();

  function create() {
    win = new BrowserWindow({
      width: 400, height: CARD_H + PAD * 2, frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      focusable: false, show: false, backgroundColor: '#00000000', webPreferences: webPrefs,
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.loadFile(path.join(__dirname, 'renderer', 'preview.html'));
  }

  async function snapshot() {
    if (!current || !alive()) return;
    const g = getGroup(current.key);
    if (!g || !g.windows.length) { close(); return; }
    const wins = g.windows.slice(0, 6);
    let sources = [];
    try {
      sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 440, height: 280 }, fetchWindowIcons: false });
    } catch (e) { console.error('[previews]', e.message); }
    const byId = new Map(sources.map((s) => [s.id.split(':')[1], s]));
    if (!current) return;
    win.webContents.send('preview', {
      name: g.name, icon: getIcon(current.key),
      windows: wins.map((w) => {
        const src = byId.get(String(w.addr));
        const thumb = !w.minimized && src && !src.thumbnail.isEmpty() ? src.thumbnail.toDataURL() : null;
        return { addr: String(w.addr), title: w.title, minimized: w.minimized, thumb };
      }),
    });
  }

  function layout(count) {
    const n = Math.max(1, Math.min(6, count));
    const width = n * CARD_W + (n - 1) * 8 + PAD * 2;
    const height = CARD_H + PAD * 2;
    const r = current.iconRect;
    const d = screen.getDisplayMatching(r);
    const b = d.bounds;
    const top = (restRect() ? restRect().y : r.y) - height - 6;
    const x = Math.round(Math.max(b.x + 8, Math.min(r.x + r.width / 2 - width / 2, b.x + b.width - width - 8)));
    win.setBounds({ x, y: Math.round(top), width, height });
  }

  async function open(key, iconRect) {
    if (!alive()) create();
    const g = getGroup(key);
    if (!g || !g.windows.length) return;
    current = { key, iconRect };
    if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
    layout(Math.min(6, g.windows.length));
    await snapshot();
    if (!current || current.key !== key) return;
    if (!win.isVisible()) win.showInactive();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => safe('previews', snapshot), 1500);
    clearInterval(watchTimer);
    outSince = 0;
    watchTimer = setInterval(() => safe('previews', watch), 80);
  }

  // Close once the mouse has left both the icon and the preview for a moment
  function watch() {
    if (!current || !alive()) return;
    const c = screen.getCursorScreenPoint();
    const inside = (r, m) => c.x >= r.x - m && c.x <= r.x + r.width + m && c.y >= r.y - m && c.y <= r.y + r.height + m;
    const wb = win.getBounds();
    const r = current.iconRect;
    // the gap between the icon and the preview counts as "still hovering"
    const between = c.x >= r.x - 10 && c.x <= r.x + r.width + 10 && c.y >= wb.y + wb.height - 4 && c.y <= r.y + 4;
    if (inside(wb, 2) || inside(r, 8) || between) { outSince = 0; return; }
    if (!outSince) outSince = Date.now();
    if (Date.now() - outSince > 220) close();
  }

  function close() {
    current = null;
    clearInterval(refreshTimer); clearInterval(watchTimer);
    if (alive() && win.isVisible()) win.hide();
  }

  ipcMain.on('preview-open', (_e, { key, rect }) => {
    if (!dockWin()) return;
    const wb = dockWin().getBounds();
    open(key, { x: wb.x + rect.x, y: wb.y + rect.y, width: rect.width, height: rect.height });
  });
  ipcMain.on('preview-close', close);
  ipcMain.on('preview-focus', (_e, addr) => {
    const key = current && current.key;
    const g = key && getGroup(key);
    const w = g && g.windows.find((x) => String(x.addr) === addr);
    close();
    if (w) onFocus(w, key);
  });
  ipcMain.on('preview-close-window', (_e, addr) => {
    const g = current && getGroup(current.key);
    const w = g && g.windows.find((x) => String(x.addr) === addr);
    if (w) win32.close(w.hwnd);
    setTimeout(() => safe('previews', snapshot), 500);
  });
  ipcMain.on('preview-size', (_e, n) => { if (current && alive()) layout(n); });

  return { close, isOpen: () => !!current && alive() && win.isVisible(), bounds: () => (alive() && win.isVisible() ? win.getBounds() : null) };
};
