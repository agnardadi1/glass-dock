// Window rules and workspace triggers.
// Rules: "Spotify always opens on the portrait screen, top half" – applied to every new window of that app.
// Triggers: a workspace that opens by itself when an app starts, at a time of day, or when the sound
// switches to a certain device (headphones plugged in).
const { ipcMain, screen } = require('electron');

const COOLDOWN_MS = 60 * 1000;

module.exports = function createRules({ getState, persist, win32, keyOf, appName, workspaces, safe, broadcast }) {
  const rules = () => { const st = getState(); if (!Array.isArray(st.rules)) st.rules = []; return st.rules; };
  let prevAddrs = null;          // windows seen on the last poll
  let prevKeys = new Set();      // apps that had a window on the last poll
  const firedAt = new Map();     // workspace id -> when a trigger last opened it
  const firedDay = new Map();    // workspace id -> 'YYYY-MM-DD' its time trigger last fired
  let lastOut = null;            // default sound output's name
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  function fire(ws, why) {
    const at = firedAt.get(ws.id) || 0;
    if (Date.now() - at < COOLDOWN_MS) return;
    if (getState().activeWorkspace === ws.id && why !== 'time') return; // already in it
    firedAt.set(ws.id, Date.now());
    console.log(`[rules] opening workspace "${ws.name}" (${why})`);
    safe('trigger', () => workspaces.activate(ws.id));
  }
  const triggers = (type) => getState().workspaces.filter((w) => w.trigger && w.trigger.on !== false && w.trigger.type === type);

  // Called every second with the current window list
  function windowsSeen(wins) {
    const addrs = new Set(wins.map((w) => w.addr));
    const keys = new Set(wins.map((w) => keyOf(w.exe)));
    if (prevAddrs) {
      const fresh = wins.filter((w) => !prevAddrs.has(w.addr) && w.rect && !w.minimized);
      if (fresh.length && !workspaces.isBusy()) {
        for (const w of fresh) {
          const key = keyOf(w.exe);
          const r = rules().find((x) => x.on !== false && x.key === key);
          if (r) setTimeout(() => safe('window rule', () => applyRule(r, w)), 450); // let the app finish opening first
        }
      }
      // Apps that just started
      for (const ws of triggers('app')) {
        if (!ws.trigger.key || prevKeys.has(ws.trigger.key) || !keys.has(ws.trigger.key)) continue;
        fire(ws, 'app');
      }
    }
    prevAddrs = addrs;
    prevKeys = keys;
  }
  function applyRule(r, w) {
    // Still there, still not moved by a workspace?
    const now = win32.listWindows().find((x) => x.addr === w.addr);
    if (!now || now.minimized) return;
    const t = workspaces.targetRect({ display: r.display, zone: r.zone, rel: { x: 0, y: 0, w: 1200, h: 800 }, maximized: r.zone === 'full' });
    win32.place(now.hwnd, t.rect, r.zone === 'full' ? true : t.maximize);
  }

  // Every half minute: time-of-day triggers
  function timeTick() {
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const today = d.toDateString();
    for (const ws of triggers('time')) {
      const t = ws.trigger;
      if (t.time !== hhmm) continue;
      if (Array.isArray(t.days) && t.days.length && !t.days.includes(d.getDay())) continue;
      if (firedDay.get(ws.id) === today) continue;
      firedDay.set(ws.id, today);
      fire(ws, 'time');
    }
  }

  // The default speakers/headphones changed
  function soundChanged(st) {
    const out = ((st && st.out) || []).find((x) => x.def);
    const name = out ? out.name : null;
    if (name === lastOut) return;
    const was = lastOut; lastOut = name;
    if (was === null || !name) return; // first reading, or nothing to match
    for (const ws of triggers('device')) {
      const want = String(ws.trigger.device || '').trim().toLowerCase();
      if (want && name.toLowerCase().includes(want)) fire(ws, 'device');
    }
  }

  // ---------- settings ----------
  const clean = (r) => ({
    id: r.id || newId(), key: String(r.key || '').toLowerCase().slice(0, 80), name: String(r.name || appName(String(r.key || '').toLowerCase())).slice(0, 60),
    display: r.display && r.display.id ? { id: String(r.display.id), label: String(r.display.label || '') } : null,
    zone: workspaces.ZONES.includes(r.zone) ? r.zone : 'full', on: r.on !== false,
  });
  ipcMain.handle('rules-list', () => ({
    rules: rules(),
    displays: screen.getAllDisplays().map((d) => ({ id: String(d.id), label: d.label || `${d.size.width}×${d.size.height}` })),
    // apps you can pick: pinned ones and ones with a window open now
    apps: [...new Map([
      ...getState().items.filter((i) => i.key && /\.exe$/i.test(i.key)).map((i) => [i.key, i.name || appName(i.key)]),
      ...(win32.available ? win32.listWindows().filter((w) => w.exe && w.pid !== process.pid).map((w) => [keyOf(w.exe), appName(keyOf(w.exe))]) : []),
    ]).entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  ipcMain.handle('rules-save', (_e, list) => {
    getState().rules = (Array.isArray(list) ? list : []).filter((r) => r && r.key).map(clean).slice(0, 60);
    persist(); if (broadcast) broadcast();
    return rules();
  });

  return {
    start() { setInterval(() => safe('time triggers', timeTick), 30000); },
    windowsSeen,
    soundChanged,
  };
};
