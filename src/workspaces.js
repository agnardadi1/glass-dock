// Workspaces: save which apps are open and exactly where their windows sit (on which screen),
// then bring the whole set back with one click: open what's missing, move every window into place,
// minimise everything else and close the previous workspace's apps.
const { screen, shell, ipcMain } = require('electron');
const path = require('path');

const ZONES = {
  full: [0, 0, 1, 1], left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1],
  left3: [0, 0, 1 / 3, 1], mid3: [1 / 3, 0, 1 / 3, 1], right3: [2 / 3, 0, 1 / 3, 1],
  left23: [0, 0, 2 / 3, 1], right23: [1 / 3, 0, 2 / 3, 1],
  left4: [0, 0, 0.25, 1], right4: [0.75, 0, 0.25, 1],
  top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5],
};
const SKIP_EXE = /\\(applicationframehost|textinputhost|searchhost|startmenuexperiencehost|shellexperiencehost|lockapp)\.exe$/i;

module.exports = function createWorkspaces(ctx) {
  const { getState, persist, win32, keyOf, appName, safe, saveSettings, notify, broadcast, launchThing } = ctx;
  const wsList = () => getState().workspaces;
  let busy = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const physBounds = (d) => screen.dipToScreenRect(null, d.workArea);
  function findDisplay(ref) {
    const all = screen.getAllDisplays();
    return (ref && (all.find((d) => String(d.id) === String(ref.id)) || all.find((d) => d.label && d.label === ref.label))) || screen.getPrimaryDisplay();
  }
  function displayOfRect(r) {
    const dip = screen.screenToDipRect(null, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
    return screen.getDisplayMatching(dip);
  }

  function appWindows() {
    return win32.listWindows().filter((w) => w.pid !== process.pid && w.exe && !SKIP_EXE.test(w.exe));
  }

  // Turn the open windows into a workspace's app list
  function capture() {
    const apps = [];
    for (const w of appWindows()) {
      if (w.minimized || !w.rect) continue;
      const d = displayOfRect(w.rect);
      const wa = physBounds(d);
      apps.push({
        key: keyOf(w.exe), exe: w.exe, name: appName(keyOf(w.exe)), title: w.title,
        display: { id: String(d.id), label: d.label || '' },
        rel: { x: w.rect.left - wa.x, y: w.rect.top - wa.y, w: w.rect.right - w.rect.left, h: w.rect.bottom - w.rect.top },
        maximized: !!w.maximized, zone: '',
      });
    }
    return apps.reverse(); // bottom-most first, so restoring keeps the same stacking
  }

  // Where a workspace app's window should go, in physical pixels
  function targetRect(a) {
    const d = findDisplay(a.display);
    const wa = physBounds(d);
    if (a.zone && ZONES[a.zone]) {
      const [x, y, w, h] = ZONES[a.zone];
      return { rect: { left: Math.round(wa.x + wa.width * x), top: Math.round(wa.y + wa.height * y), right: Math.round(wa.x + wa.width * (x + w)), bottom: Math.round(wa.y + wa.height * (y + h)) }, maximize: false };
    }
    const w = Math.min(a.rel.w, wa.width + 16), h = Math.min(a.rel.h, wa.height + 16);
    const left = Math.max(wa.x - 8, Math.min(wa.x + a.rel.x, wa.x + wa.width - w + 8));
    const top = Math.max(wa.y - 8, Math.min(wa.y + a.rel.y, wa.y + wa.height - h + 8));
    return { rect: { left, top, right: left + w, bottom: top + h }, maximize: !!a.maximized };
  }

  function launchPathFor(a) {
    const pinned = getState().items.find((i) => i.key === a.key);
    return pinned ? pinned.path : a.exe;
  }

  async function activate(id) {
    const ws = wsList().find((w) => w.id === id);
    if (!ws || busy) return;
    busy = true;
    const prevId = getState().activeWorkspace;
    notify({ kind: 'ws', name: ws.name, icon: ws.icon, phase: 'start', count: ws.apps.length });
    try {
      if (ws.look) saveSettings({ look: ws.look });
      let wins = appWindows();
      const wanted = new Set(ws.apps.map((a) => a.key));

      // Close the previous workspace's apps that this one doesn't use
      const prev = wsList().find((w) => w.id === prevId);
      if (prev && prev.id !== ws.id && ws.closeOld !== false) {
        const closeKeys = new Set(prev.apps.map((a) => a.key).filter((k) => !wanted.has(k)));
        for (const w of wins) if (closeKeys.has(keyOf(w.exe))) win32.close(w.hwnd);
      }

      // Match each saved app to an open window (same title first), launch the ones that are missing
      const used = new Set();
      const placed = [];
      const pending = [];
      const launched = new Set();
      const pick = (a, list) => {
        const same = list.filter((w) => keyOf(w.exe) === a.key && !used.has(w.addr));
        return same.find((w) => w.title === a.title) || same[0] || null;
      };
      for (const a of ws.apps) {
        const w = pick(a, wins);
        if (w) { used.add(w.addr); placed.push([a, w]); continue; }
        pending.push(a);
        if (!launched.has(a.key) || /\\(chrome|msedge|brave|firefox|code|explorer)\.exe$/i.test(a.exe)) {
          launched.add(a.key);
          const pinned = getState().items.find((i) => i.key === a.key);
          Promise.resolve(launchThing(launchPathFor(a), pinned && pinned.aumid)).catch(() => {});
        }
      }
      for (const url of ws.urls || []) if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});

      for (const [a, w] of placed) safe('workspace', () => { const t = targetRect(a); win32.place(w.hwnd, t.rect, t.maximize); });

      // Wait (up to 20 s) for the launched apps' windows to appear, placing each one as it shows up
      const until = Date.now() + 20000;
      while (pending.length && Date.now() < until) {
        await sleep(400);
        wins = appWindows();
        for (let i = pending.length - 1; i >= 0; i--) {
          const a = pending[i];
          const w = pick(a, wins);
          if (!w) continue;
          used.add(w.addr);
          await sleep(250); // let the app finish opening before moving it
          safe('workspace', () => { const t = targetRect(a); win32.place(w.hwnd, t.rect, t.maximize); });
          placed.push([a, w]);
          pending.splice(i, 1);
        }
      }

      // Minimise everything that isn't part of this workspace
      if (ws.minimizeOthers !== false) {
        for (const w of appWindows()) if (!used.has(w.addr) && !w.minimized) win32.minimize(w.hwnd);
      }
      // Bring the workspace's windows to the front, keeping their saved stacking order
      for (const [, w] of placed) safe('workspace', () => win32.raise(w.hwnd));

      getState().activeWorkspace = ws.id;
      persist();
      broadcast();
      notify({ kind: 'ws', name: ws.name, icon: ws.icon, phase: 'done', missing: pending.map((a) => a.name) });
    } finally {
      busy = false;
    }
  }

  function create(name) {
    const n = wsList().length + 1;
    const ws = {
      id: newId(), name: name || `Workspace ${n}`, icon: ['📘', '🎮', '🎧', '💼', '🎬', '🛠️', '🌙', '⚡'][(n - 1) % 8],
      apps: capture(), urls: [], look: null, closeOld: true, minimizeOthers: true,
    };
    wsList().push(ws);
    persist(); broadcast();
    return ws;
  }
  function recapture(id) {
    const ws = wsList().find((w) => w.id === id);
    if (!ws) return;
    ws.apps = capture();
    persist(); broadcast();
  }
  function addApp(id, key) {
    const ws = wsList().find((w) => w.id === id);
    if (!ws) return;
    const w = appWindows().find((x) => keyOf(x.exe) === key && x.rect);
    if (!w) return;
    const d = displayOfRect(w.rect);
    const wa = physBounds(d);
    ws.apps.push({
      key, exe: w.exe, name: appName(key), title: w.title, display: { id: String(d.id), label: d.label || '' },
      rel: { x: w.rect.left - wa.x, y: w.rect.top - wa.y, w: w.rect.right - w.rect.left, h: w.rect.bottom - w.rect.top },
      maximized: !!w.maximized, zone: '',
    });
    persist(); broadcast();
  }

  ipcMain.handle('ws-list', () => ({ list: wsList(), active: getState().activeWorkspace, displays: screen.getAllDisplays().map((d) => ({ id: String(d.id), label: d.label || `${d.size.width}×${d.size.height}` })) }));
  ipcMain.handle('ws-create', (_e, name) => create(name));
  ipcMain.handle('ws-capture', (_e, id) => recapture(id));
  ipcMain.handle('ws-activate', (_e, id) => activate(id));
  ipcMain.handle('ws-delete', (_e, id) => {
    const list = wsList();
    const i = list.findIndex((w) => w.id === id);
    if (i >= 0) list.splice(i, 1);
    if (getState().activeWorkspace === id) getState().activeWorkspace = null;
    persist(); broadcast();
  });
  ipcMain.handle('ws-update', (_e, ws) => {
    const list = wsList();
    const i = list.findIndex((w) => w.id === ws.id);
    if (i < 0) return;
    const keep = list[i];
    list[i] = {
      ...keep,
      name: String(ws.name || keep.name).slice(0, 40), icon: String(ws.icon || keep.icon).slice(0, 8),
      look: ws.look || null, closeOld: ws.closeOld !== false, minimizeOthers: ws.minimizeOthers !== false,
      urls: (ws.urls || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 12),
      apps: (ws.apps || []).map((a) => ({ ...a, zone: ZONES[a.zone] ? a.zone : '' })),
    };
    persist(); broadcast();
  });

  return { activate, create, recapture, addApp, list: wsList, ZONES: Object.keys(ZONES) };
};
