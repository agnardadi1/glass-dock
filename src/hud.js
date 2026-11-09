// Game HUD: a small always-on-top readout in a corner of the game's screen (FPS, 1% low, GPU, CPU,
// VRAM, clock), plus a session summary for the island when the game ends. Runs in the main process;
// the readout itself is drawn by renderer/hud.html.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const W = 260, H = 150; // window size at 100%; the card sits in the corner, the rest is transparent

module.exports = function createHud({ getSettings, win32, webPrefs, safe, stats, isGame, notify }) {
  let win = null, shown = false, lastBounds = '', gameDisplay = null;
  let session = null; // { name, exe, start, lastSeen, fps: [], temps: [], gpu: [] } while a game is in front
  let endTimer = null;
  const opts = () => getSettings().hud || {};
  const alive = () => win && !win.isDestroyed();
  const send = (ch, data) => { if (alive()) win.webContents.send(ch, data); };

  function create() {
    win = new BrowserWindow({
      x: 0, y: 0, width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, focusable: false,
      backgroundColor: '#00000000', webPreferences: webPrefs,
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, 'renderer', 'hud.html'));
    win.webContents.on('did-finish-load', () => { send('hud-settings', opts()); if (stats.last()) send('stats', stats.last()); });
  }

  // The display the game is on (the foreground window's), falling back to the primary one
  function displayForGame() {
    try {
      const fg = win32.foregroundInfo();
      if (fg && fg.rect) {
        const r = fg.rect;
        const dip = screen.screenToDipRect(null, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
        return screen.getDisplayMatching(dip);
      }
    } catch { /* no window */ }
    return screen.getPrimaryDisplay();
  }
  function boundsFor(d) {
    const o = opts();
    const z = o.scale || 1;
    const w = Math.round(W * z), h = Math.round(H * z);
    const b = d.bounds;
    const m = 12;
    const corner = o.corner || 'tr';
    const x = corner.endsWith('l') ? b.x + m : b.x + b.width - w - m;
    const y = corner.startsWith('t') ? b.y + m : b.y + b.height - h - m;
    return { x, y, width: w, height: h };
  }

  // Runs ~10 times a second
  function tick() {
    if (!alive()) return;
    const o = opts();
    const want = !!o.on && isGame() && getSettings().gameMode !== false;
    if (want) {
      if (!gameDisplay) gameDisplay = displayForGame();
      const b = boundsFor(gameDisplay);
      const sig = JSON.stringify([b, o.scale]);
      if (sig !== lastBounds) { lastBounds = sig; win.setBounds(b); win.webContents.setZoomFactor(o.scale || 1); }
      if (!shown) { shown = true; win.showInactive(); }
    } else if (shown) {
      shown = false; win.hide();
    }
  }

  // ---------- the game session ----------
  const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  function onStats(st) {
    if (!session || !st.inGame) return;
    session.lastSeen = Date.now();
    if (st.fps != null && st.fps > 0) session.fps.push(st.fps);
    if (st.gpuTemp != null) session.temps.push(st.gpuTemp);
    if (st.gpu != null) session.gpu.push(st.gpu);
    // rolling 1% low over the last two minutes of samples (the lowest 1% of per-second readings)
    const recent = session.fps.slice(-120);
    send('stats', { ...st, low1: pct(recent, 0.01), sessionMin: Math.round((Date.now() - session.start) / 60000) });
  }
  function finish() {
    const s = session; session = null; endTimer = null;
    if (!s) return;
    const minutes = Math.round((s.lastSeen - s.start) / 60000);
    if (getSettings().gameSummary === false || minutes < 1) return; // a quick look isn't a session
    notify({ name: s.name, minutes, avgFps: avg(s.fps), lowFps: pct(s.fps, 0.01), maxTemp: s.temps.length ? Math.max(...s.temps) : null, avgGpu: avg(s.gpu) });
  }
  function gameChanged(on, name, exe) {
    gameDisplay = null;
    lastBounds = '';
    if (on) {
      // Back in the same game within a minute and a half (an Alt+Tab): the same session continues
      if (session && session.exe !== exe) finish();
      clearTimeout(endTimer); endTimer = null;
      if (!session) session = { name, exe, start: Date.now(), fps: [], temps: [], gpu: [] };
      session.lastSeen = Date.now();
      stats.want('hud', !!opts().on || getSettings().gameSummary !== false);
      return;
    }
    stats.want('hud', false);
    if (!session) return;
    session.lastSeen = Date.now();
    clearTimeout(endTimer);
    endTimer = setTimeout(() => safe('hud', finish), 90000);
  }

  return {
    start() { create(); stats.on((st) => safe('hud', () => onStats(st))); setInterval(() => safe('hud', tick), 100); },
    apply() { lastBounds = ''; send('hud-settings', opts()); if (isGame()) stats.want('hud', !!opts().on || getSettings().gameSummary !== false); },
    gameChanged,
    send,
  };
};
