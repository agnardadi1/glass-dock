// The Dynamic Island: a small black pill at the top of the screen that grows to show
// what's happening (music, volume, mic/camera use, screenshots, downloads, a timer).
// This file runs in the main process; the pill itself is drawn by renderer/island.html.
const { app, BrowserWindow, screen, clipboard, nativeImage, ipcMain, shell, net } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const W = 480, H = 250; // window size at 100%; the pill lives inside it, the rest is click-through
const TEMP_EXT = /\.(crdownload|part|partial|download|opdownload|!ut)$/i;

module.exports = function createIsland({ getSettings, win32, dockDisplay, fullscreenOn, webPrefs, safe, media, isGame }) {
  let win = null;
  let pill = null;          // pill rectangle inside the window (DIP)
  let capturing = false;
  let shown = false;
  let lastBounds = '';
  const opts = () => getSettings().island;
  const alive = () => win && !win.isDestroyed();
  const send = (ch, data) => { if (alive()) win.webContents.send(ch, data); };

  function pickDisplay() {
    const o = opts();
    if (o.display === 'mouse') return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (o.display && o.display !== 'dock') {
      const d = screen.getAllDisplays().find((x) => String(x.id) === String(o.display));
      if (d) return d;
    }
    return dockDisplay();
  }
  function boundsFor(d) {
    const o = opts();
    const z = o.scale || 1;
    const w = Math.round(W * z), h = Math.round(H * z);
    const b = d.bounds;
    let x = b.x + Math.round((b.width - w) / 2);
    if (o.align === 'left') x = b.x + 16;
    if (o.align === 'right') x = b.x + b.width - w - 16;
    return { x, y: b.y + Math.round(o.top || 0), width: w, height: h };
  }

  function create() {
    win = new BrowserWindow({
      ...boundsFor(pickDisplay()),
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false,
      backgroundColor: '#00000000', webPreferences: webPrefs,
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, 'renderer', 'island.html'));
    win.webContents.on('did-finish-load', () => { win.webContents.setZoomFactor(opts().scale || 1); });
  }

  // Runs ~10 times a second: follows the chosen screen, hides over full-screen apps, click-through.
  function tick() {
    if (!alive()) return;
    const o = opts();
    const d = pickDisplay();
    const g = getSettings();
    const want = isGame() && g.gameMode !== false
      ? o.on && g.gameIsland !== 'hide'                 // game mode decides
      : o.on && !(o.fullscreenHide && fullscreenOn(d));
    if (want) {
      const b = boundsFor(d);
      const sig = JSON.stringify(b);
      if (sig !== lastBounds) { lastBounds = sig; win.setBounds(b); }
      if (!shown) { shown = true; win.showInactive(); }
    } else if (shown) {
      shown = false;
      win.hide();
      if (capturing) { capturing = false; win.setIgnoreMouseEvents(true, { forward: true }); }
    }
    if (!shown || !pill) return;
    const c = screen.getCursorScreenPoint();
    const wb = win.getBounds();
    const z = o.scale || 1;
    const x = (c.x - wb.x), y = (c.y - wb.y);
    const inside = x >= pill.x * z - 6 && x <= (pill.x + pill.width) * z + 6 && y >= pill.y * z - 6 && y <= (pill.y + pill.height) * z + 6;
    if (inside !== capturing) { capturing = inside; win.setIgnoreMouseEvents(!inside, { forward: true }); }
  }

  ipcMain.on('island-rect', (_e, r) => { pill = r; });

  // ---------- screenshots / copied images ----------
  let lastSeq = null, lastShot = null, lastImgSig = '';
  // ---------- clipboard history (kept in memory only, never saved) ----------
  let clips = [];             // newest first: { id, type, text | thumb }
  const clipImages = new Map();
  let clipId = 0, lastText = null;
  function addClip(c, img) {
    if (c.type === 'text') clips = clips.filter((x) => !(x.type === 'text' && x.text === c.text));
    c.id = ++clipId;
    if (img) clipImages.set(c.id, img);
    clips.unshift(c);
    for (const old of clips.splice(8)) clipImages.delete(old.id);
    send('clips', clips);
  }
  ipcMain.on('island-clip', (_e, id) => {
    const c = clips.find((x) => x.id === id);
    if (!c) return;
    if (c.type === 'text') { clipboard.writeText(c.text); lastText = c.text; } else clipboard.writeImage(clipImages.get(c.id));
    if (win32.available) lastSeq = win32.clipboardSeq(); // don't count our own copy as a new one
    clips = [c, ...clips.filter((x) => x !== c)];
    send('clips', clips);
  });

  function pollClipboard() {
    const o = opts();
    const wantClips = o.panels && o.panels.clipboard;
    if (!alive() || !o.on || (!o.shots && !wantClips)) return;
    if (win32.available) {
      const seq = win32.clipboardSeq();
      if (lastSeq === null) { lastSeq = seq; return; }
      if (seq === lastSeq) return;
      lastSeq = seq;
    }
    const formats = clipboard.availableFormats();
    if (!formats.some((f) => f.startsWith('image/'))) {
      const text = clipboard.readText();
      if (lastText === null && !win32.available) { lastText = text; return; }
      if (wantClips && text && text.trim() && text !== lastText) addClip({ type: 'text', text: text.slice(0, 2000) });
      lastText = text;
      return;
    }
    const img = clipboard.readImage();
    if (img.isEmpty()) return;
    const { width, height } = img.getSize();
    const sig = `${width}x${height}:${img.resize({ width: 8 }).toDataURL().length}`;
    if (!win32.available && !lastImgSig) { lastImgSig = sig; return; } // ignore what was already there
    if (sig === lastImgSig) return;
    lastImgSig = sig;
    lastShot = img;
    if (wantClips) addClip({ type: 'image', thumb: img.resize({ height: 96, quality: 'good' }).toDataURL(), width, height }, img);
    if (o.shots) send('shot', { thumb: img.resize({ width: Math.min(640, width), quality: 'good' }).toDataURL(), width, height });
  }
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  function saveShot(dir) {
    if (!lastShot) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `Screenshot ${stamp()}.png`);
    fs.writeFileSync(file, lastShot.toPNG());
    return file;
  }
  ipcMain.handle('island-shot-save', () => {
    const file = saveShot(path.join(app.getPath('pictures'), 'Screenshots'));
    if (file) shell.showItemInFolder(file);
    return file;
  });
  ipcMain.on('island-shot-drag', (e) => {
    const file = saveShot(path.join(os.tmpdir(), 'glass-dock-shots'));
    if (file) e.sender.startDrag({ file, icon: lastShot.resize({ width: 96 }) });
  });

  // ---------- downloads ----------
  const dlDir = app.getPath('downloads');
  let known = null;                 // file name -> mtime
  const active = new Map();         // temp name -> { size, since }
  let watcher = null, scanTimer = null, lastDone = null;
  function cleanName(n) {
    const base = n.replace(TEMP_EXT, '');
    return /^unconfirmed \d+$/i.test(base) ? 'Download' : base;
  }
  function scan() {
    if (!opts().on || !opts().downloads) return;
    let names;
    try { names = fs.readdirSync(dlDir); } catch { return; }
    const now = Date.now();
    const nowKnown = new Map();
    for (const n of names) {
      if (n.startsWith('.') || /^desktop\.ini$/i.test(n)) continue;
      let st; try { st = fs.statSync(path.join(dlDir, n)); } catch { continue; }
      if (!st.isFile()) continue;
      nowKnown.set(n, st.mtimeMs);
      if (TEMP_EXT.test(n)) active.set(n, { size: st.size, since: (active.get(n) || {}).since || now });
    }
    const finished = [];
    for (const n of [...active.keys()]) if (!nowKnown.has(n)) { active.delete(n); finished.push(n); }
    if (known) {
      // A download finished: its temp file vanished (renamed to the real name), or a quick
      // download appeared directly without a temp file.
      const recent = [...nowKnown.entries()].filter(([n, m]) => !TEMP_EXT.test(n) && now - m < 15000).sort((a, b) => b[1] - a[1]);
      let done = null;
      if (finished.length && recent.length) done = recent[0][0];
      else if (!active.size) { const brandNew = recent.find(([n]) => !known.has(n)); if (brandNew) done = brandNew[0]; }
      if (done && done !== lastDone) {
        lastDone = done;
        send('download-done', { name: done, path: path.join(dlDir, done) });
      }
    }
    known = nowKnown;
    send('downloads', [...active.entries()].map(([n, v]) => ({ name: cleanName(n), size: v.size })));
    clearTimeout(scanTimer);
    if (active.size) scanTimer = setTimeout(() => safe('downloads', scan), 700);
  }
  function startDownloads() {
    if (watcher) return;
    scan();
    try {
      watcher = fs.watch(dlDir, () => { clearTimeout(scanTimer); scanTimer = setTimeout(() => safe('downloads', scan), 250); });
    } catch (e) { console.error('[downloads]', e.message); }
  }
  ipcMain.on('island-open', (_e, p) => { if (p && p.startsWith(dlDir)) shell.openPath(p); });
  ipcMain.on('island-reveal', (_e, p) => { if (p) shell.showItemInFolder(p); });

  // ---------- weather (Open-Meteo, no account needed) ----------
  let place = null, placeKey = null, weatherTimer = null, lastWeather = null;
  async function getJson(url) {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'GlassDock/0.6' } });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return r.json();
  }
  async function findPlace() {
    const typed = (opts().weatherPlace || '').trim();
    if (placeKey === typed && place) return place;
    placeKey = typed;
    if (typed) {
      const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(typed)}`);
      const p = g.results && g.results[0];
      if (!p) throw new Error(`couldn't find "${typed}"`);
      place = { lat: p.latitude, lon: p.longitude, name: p.name };
    } else {
      // rough location from the internet connection (two services, in case one is busy)
      let ip = null;
      try { ip = await getJson('https://ipapi.co/json/'); if (ip.error) throw new Error(ip.reason || 'busy'); } catch { ip = await getJson('https://ipwho.is/'); }
      if (ip.latitude == null) throw new Error('could not tell where you are – type your town in Settings → Island');
      place = { lat: ip.latitude, lon: ip.longitude, name: ip.city || 'Your area' };
    }
    return place;
  }
  async function updateWeather() {
    clearTimeout(weatherTimer);
    weatherTimer = setTimeout(() => updateWeather(), 20 * 60 * 1000);
    const o = opts();
    if (!o.on || !o.panels || !o.panels.weather) return;
    try {
      const p = await findPlace();
      const f = o.units === 'f' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
      const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4${f}`);
      lastWeather = {
        place: p.name, units: o.units, temp: w.current.temperature_2m, feels: w.current.apparent_temperature,
        code: w.current.weather_code, wind: w.current.wind_speed_10m, day: !!w.current.is_day,
        days: w.daily.time.map((d, i) => ({ date: d, code: w.daily.weather_code[i], max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i] })),
      };
      send('weather', lastWeather);
    } catch (e) {
      console.error('[weather]', e.message);
      send('weather', { error: e.message });
      clearTimeout(weatherTimer);
      weatherTimer = setTimeout(() => updateWeather(), 2 * 60 * 1000);
    }
  }

  // ---------- PC stats (only measured while you're looking at them) ----------
  let statsTimer = null, prevCpu = null, gpuMissing = false;
  const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
  function gpuStats() {
    return new Promise((resolve) => {
      if (gpuMissing || process.platform !== 'win32') return resolve(null);
      execFile('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,name', '--format=csv,noheader,nounits'],
        { windowsHide: true, timeout: 2000 }, (err, out) => {
          if (err) { gpuMissing = true; console.error('[stats] no NVIDIA GPU info:', err.message); return resolve(null); }
          const [util, temp, used, total, name] = String(out).split('\n')[0].split(',').map((x) => x.trim());
          resolve({ gpu: +util, gpuTemp: +temp, vramUsed: +used, vramTotal: +total, gpuName: name });
        });
    });
  }
  async function sampleStats() {
    const now = cpuTimes();
    const cpu = prevCpu ? Math.round(100 * (1 - (now.idle - prevCpu.idle) / Math.max(1, now.total - prevCpu.total))) : null;
    prevCpu = now;
    const total = os.totalmem(), free = os.freemem();
    send('stats', { cpu, ramUsed: total - free, ramTotal: total, ...(await gpuStats()) });
  }
  ipcMain.on('island-stats', (_e, on) => {
    clearInterval(statsTimer);
    statsTimer = null;
    if (on) { prevCpu = cpuTimes(); sampleStats(); statsTimer = setInterval(() => safe('stats', sampleStats), 1500); }
  });

  // ---------- quick launch / resume music ----------
  ipcMain.on('island-launch', (_e, p) => { if ((opts().launch || []).some((x) => x.path === p)) shell.openPath(p); });
  ipcMain.on('island-resume', () => {
    const m = media && media.last;
    if (m && !m.none) media.send('toggle');
    else shell.openExternal('spotify:').catch(() => {});
  });

  function apply() {
    if (!alive()) return;
    lastBounds = '';
    win.webContents.setZoomFactor(opts().scale || 1);
    send('settings', getSettings());
    if (opts().on && opts().downloads) startDownloads();
    const o = opts();
    const key = JSON.stringify([o.on, o.panels && o.panels.weather, o.weatherPlace, o.units]);
    if (key !== apply.weatherKey) { apply.weatherKey = key; updateWeather(); }
    send('clips', clips);
  }

  return {
    start() {
      create();
      setInterval(() => safe('island', tick), 100);
      setInterval(() => safe('screenshots', pollClipboard), 500);
      if (opts().on && opts().downloads) startDownloads();
      win.webContents.on('did-finish-load', () => { if (lastWeather) send('weather', lastWeather); else updateWeather(); send('clips', clips); });
    },
    apply,
    send,
    stop() { if (watcher) watcher.close(); },
  };
};
