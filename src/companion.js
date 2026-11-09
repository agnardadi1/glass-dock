// The companion panel: a dock-styled strip along one edge of a chosen screen (made for a second,
// portrait monitor) with the time, what's playing, PC stats over time, clipboard history and downloads.
// Tucks itself away during games. Runs in the main process; drawn by renderer/companion.html.
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

module.exports = function createCompanion({ getSettings, webPrefs, safe, stats, isGame, media, onClip }) {
  let win = null, shown = false, lastBounds = '';
  const opts = () => getSettings().companion || {};
  const alive = () => win && !win.isDestroyed();
  const send = (ch, data) => { if (alive()) win.webContents.send(ch, data); };

  // The chosen screen; by default the one that isn't the main one (your portrait screen)
  function pickDisplay() {
    const all = screen.getAllDisplays();
    const o = opts();
    if (o.display) { const d = all.find((x) => String(x.id) === String(o.display)); if (d) return d; }
    const primary = screen.getPrimaryDisplay();
    return all.find((d) => d.id !== primary.id) || primary;
  }
  function boundsFor(d) {
    const o = opts();
    const h = Math.round(o.height || 320);
    const wa = d.workArea;
    const y = o.side === 'top' ? wa.y : wa.y + wa.height - h;
    return { x: wa.x, y, width: wa.width, height: h };
  }

  function create() {
    win = new BrowserWindow({
      ...boundsFor(pickDisplay()),
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000', webPreferences: webPrefs,
    });
    win.setAlwaysOnTop(true, 'floating');
    win.loadFile(path.join(__dirname, 'renderer', 'companion.html'));
    win.webContents.on('did-finish-load', () => {
      send('settings', getSettings());
      send('stats-history', stats.history());
      if (media && media.last) send('media', media.last);
    });
  }

  // Runs ~5 times a second
  function tick() {
    if (!alive()) return;
    const o = opts();
    const want = !!o.on && !(o.hideInGame !== false && isGame());
    if (want) {
      const b = boundsFor(pickDisplay());
      const sig = JSON.stringify(b);
      if (sig !== lastBounds) { lastBounds = sig; win.setBounds(b); }
      if (!shown) { shown = true; win.showInactive(); stats.want('companion', true); send('stats-history', stats.history()); }
    } else if (shown) {
      shown = false; win.hide(); stats.want('companion', false);
    }
  }

  ipcMain.on('companion-clip', (_e, id) => onClip(id));
  ipcMain.handle('companion-displays', () => screen.getAllDisplays().map((d) => ({ id: String(d.id), label: d.label || `${d.size.width}×${d.size.height}`, primary: d.id === screen.getPrimaryDisplay().id })));

  return {
    start() {
      create();
      setInterval(() => safe('companion', tick), 200);
    },
    apply() { lastBounds = ''; send('settings', getSettings()); },
    send,
    displays: () => screen.getAllDisplays().map((d) => ({ id: String(d.id), label: d.label || `${d.size.width}×${d.size.height}`, primary: d.id === screen.getPrimaryDisplay().id })),
  };
};
