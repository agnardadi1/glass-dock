// Workspaces: save which apps are open and exactly where their windows sit (on which screen),
// then bring the whole set back with one click: open what's missing, move every window into place,
// minimise everything else and close the previous workspace's apps.
const { screen, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const ZONES = {
  full: [0, 0, 1, 1], left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1],
  left3: [0, 0, 1 / 3, 1], mid3: [1 / 3, 0, 1 / 3, 1], right3: [2 / 3, 0, 1 / 3, 1],
  left23: [0, 0, 2 / 3, 1], right23: [1 / 3, 0, 2 / 3, 1],
  left4: [0, 0, 0.25, 1], right4: [0.75, 0, 0.25, 1],
  top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5],
};
// Browsers we know how to open one window at a time, with their private-window switch
const BROWSERS = { 'brave.exe': '--incognito', 'chrome.exe': '--incognito', 'msedge.exe': '--inprivate', 'firefox.exe': '--private-window' };
const SKIP_EXE =/\\(applicationframehost|textinputhost|searchhost|startmenuexperiencehost|shellexperiencehost|lockapp)\.exe$/i;

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

  // Read the page address of each browser window from its address bar (UI Automation), in one PowerShell run
  function readUrls(addrs) {
    if (!addrs.length || process.platform !== 'win32') return Promise.resolve({});
    const script = `$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$A=[System.Windows.Automation.AutomationElement]
$cond=New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
$r=@{}
foreach($h in @(${addrs.map(String).join(',')})){
  try{
    $el=$A::FromHandle([IntPtr][Int64]$h)
    foreach($e in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)){
      $p=$null
      if($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){
        $v=[string]$p.Current.Value
        if($v -match '^(https?://)?[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+(:\\d+)?([/?#]\\S*)?$'){ $r[[string]$h]=$v; break }
      }
    }
  }catch{}
}
$r | ConvertTo-Json -Compress`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        try {
          const j = JSON.parse(out.trim() || '{}');
          const res = {};
          for (const [k, v] of Object.entries(j || {})) if (typeof v === 'string' && v) res[k] = /^https?:\/\//i.test(v) ? v : `https://${v}`;
          resolve(res);
        } catch { resolve({}); }
      };
      try {
        const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
        p.stdout.on('data', (d) => { out += d; });
        p.on('error', finish);
        p.on('close', finish);
        setTimeout(() => { try { p.kill(); } catch { /* gone */ } finish(); }, 12000);
      } catch { finish(); }
    });
  }

  // Turn the open windows into a workspace's app list (browser windows also remember their page)
  async function capture() {
    const apps = [];
    const browserAddrs = [];
    for (const w of appWindows()) {
      if (w.minimized || !w.rect) continue;
      const d = displayOfRect(w.rect);
      const wa = physBounds(d);
      const key = keyOf(w.exe);
      if (BROWSERS[key]) browserAddrs.push(w.addr);
      apps.push({
        key, exe: w.exe, name: appName(key), title: w.title, addr: String(w.addr),
        display: { id: String(d.id), label: d.label || '' },
        rel: { x: w.rect.left - wa.x, y: w.rect.top - wa.y, w: w.rect.right - w.rect.left, h: w.rect.bottom - w.rect.top },
        maximized: !!w.maximized, zone: '',
      });
    }
    const urls = await readUrls(browserAddrs).catch(() => ({}));
    for (const a of apps) { if (urls[a.addr]) a.url = urls[a.addr]; delete a.addr; }
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

  const PRIVATE_FLAG = BROWSERS;
  let privateOpen = null; // { addrs: Set } windows a private workspace opened, so they can be closed again

  function closeTracked(addrs) {
    for (const w of appWindows()) if (addrs.has(w.addr)) win32.close(w.hwnd);
  }

  // The engine behind every workspace switch. opts.quiet: no island message, not remembered as "active".
  async function run(ws, opts = {}) {
    if (!ws || busy) return null;
    busy = true;
    const prevId = getState().activeWorkspace;
    if (!opts.quiet) notify({ kind: 'ws', name: ws.name, icon: ws.icon, phase: 'start', count: ws.apps.length });
    try {
      if (ws.look && !opts.quiet) saveSettings({ look: ws.look });
      let wins = appWindows();
      const before = new Set(wins.map((w) => w.addr));
      const wanted = new Set(ws.apps.map((a) => a.key));

      // Leaving a private workspace: close the windows it opened
      if (privateOpen && !opts.quiet) { closeTracked(privateOpen.addrs); privateOpen = null; await sleep(300); wins = appWindows(); }

      // Close the previous workspace's apps that this one doesn't use
      const prev = wsList().find((w) => w.id === prevId);
      if (!opts.quiet && prev && prev.id !== ws.id && ws.closeOld !== false) {
        const closeKeys = new Set(prev.apps.map((a) => a.key).filter((k) => !wanted.has(k)));
        for (const w of wins) if (closeKeys.has(keyOf(w.exe))) win32.close(w.hwnd);
      }

      const urls = (ws.urls || []).filter((u) => /^https?:\/\//i.test(u));
      const priv = !!ws.privateBrowsing;

      const used = new Set();
      const placed = [];
      const pending = [];
      const browserQueue = []; // browser windows to open one by one, each with its own page
      const launched = new Set();
      const pick = (a, list, exactTitle) => {
        const same = list.filter((w) => keyOf(w.exe) === a.key && !used.has(w.addr));
        return same.find((w) => w.title === a.title) || (exactTitle ? null : same[0]) || null;
      };
      const apps = ws.apps.map((a) => ({ ...a }));
      for (const a of apps) {
        if (BROWSERS[a.key]) {
          // Private: always a new private window. Otherwise reuse a window already showing this page,
          // and open a new window for anything else.
          const w = priv ? null : pick(a, wins, !!a.url);
          if (w) { used.add(w.addr); placed.push([a, w]); } else browserQueue.push(a);
          continue;
        }
        const w = pick(a, wins);
        if (w) { used.add(w.addr); placed.push([a, w]); continue; }
        pending.push(a);
        if (!launched.has(a.key) || /\\(code|explorer)\.exe$/i.test(a.exe)) {
          launched.add(a.key);
          const pinned = getState().items.find((i) => i.key === a.key);
          Promise.resolve(launchThing(launchPathFor(a), pinned && pinned.aumid)).catch(() => {});
        }
      }

      // Extra pages with no browser window saved for them
      if (urls.length && !browserQueue.length) {
        const known = priv && (ws.apps.find((a) => BROWSERS[a.key])
          || getState().items.find((i) => BROWSERS[i.key] && /\.exe$/i.test(i.path || ''))
          || wins.find((w) => BROWSERS[keyOf(w.exe)]));
        if (known) {
          const exe = known.exe || known.path;
          browserQueue.push({ key: keyOf(exe), exe, name: appName(keyOf(exe)), noPlace: true });
        } else for (const url of urls) shell.openExternal(url).catch(() => {});
      }

      for (const [a, w] of placed) safe('workspace', () => { const t = targetRect(a); win32.place(w.hwnd, t.rect, t.maximize); });

      // Open the browser windows one at a time: start one, wait for it, put it in place, then the next.
      // Starting them all at once makes the browser merge them into one window while it starts up.
      let extra = urls;
      for (const a of browserQueue) {
        const flag = priv ? BROWSERS[a.key] : null;
        const pages = [a.url, ...extra].filter(Boolean);
        extra = [];
        const args = a.key === 'firefox.exe'
          ? [priv ? '--private-window' : '-new-window', ...pages]
          : ['--new-window', ...(flag ? [flag] : []), ...pages];
        const seen = new Set(appWindows().map((w) => w.addr));
        try { spawn(a.exe, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* not there */ }
        let w = null;
        const until = Date.now() + 15000;
        while (!w && Date.now() < until) {
          await sleep(300);
          w = appWindows().find((x) => keyOf(x.exe) === a.key && !seen.has(x.addr) && !used.has(x.addr) && x.rect) || null;
        }
        if (!w) { pending.push(a); continue; }
        used.add(w.addr);
        await sleep(500); // let it finish opening before moving it
        if (!a.noPlace) {
          safe('workspace', () => { const t = targetRect(a); win32.place(w.hwnd, t.rect, t.maximize); });
          placed.push([a, w]);
        }
        await sleep(400); // give the browser a moment before asking for the next window
      }

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

      // One more pass: browsers sometimes move a window again while they finish starting
      await sleep(700);
      for (const [a, w] of placed) safe('workspace', () => { const t = targetRect(a); win32.place(w.hwnd, t.rect, t.maximize); });

      // Minimise everything that isn't part of this workspace
      if (ws.minimizeOthers !== false) {
        for (const w of appWindows()) if (!used.has(w.addr) && !w.minimized) win32.minimize(w.hwnd);
      }
      // Bring the workspace's windows to the front, keeping their saved stacking order
      for (const [, w] of placed) safe('workspace', () => win32.raise(w.hwnd));

      if (!opts.quiet) {
        getState().activeWorkspace = ws.id;
        persist();
        broadcast();
        notify({ kind: 'ws', name: ws.name, icon: ws.icon, phase: 'done', missing: pending.map((a) => a.name) });
      }
      // Windows this run opened (not ones that were already open): what a private workspace closes again
      return { used, opened: new Set([...used].filter((a) => !before.has(a))) };
    } finally {
      busy = false;
    }
  }

  async function activate(id) {
    return run(wsList().find((w) => w.id === id));
  }
  async function runPrivate(ws) {
    const r = await run(ws, { quiet: true });
    if (r) privateOpen = { addrs: ws.closeAll ? r.used : r.opened };
    return r;
  }
  function closePrivate() {
    if (!privateOpen) return false;
    closeTracked(privateOpen.addrs);
    privateOpen = null;
    return true;
  }

  async function create(name) {
    const n = wsList().length + 1;
    const apps = await capture();
    const ws = {
      id: newId(), name: name || `Workspace ${n}`, icon: ['📘', '🎮', '🎧', '💼', '🎬', '🛠️', '🌙', '⚡'][(n - 1) % 8],
      apps, urls: [], look: null, closeOld: true, minimizeOthers: true,
    };
    wsList().push(ws);
    persist(); broadcast();
    return ws;
  }
  async function recapture(id) {
    const ws = wsList().find((w) => w.id === id);
    if (!ws) return;
    const apps = await capture();
    ws.apps = apps;
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

  // "Opens by itself when…" settings coming back from the settings window
  function cleanTrigger(t) {
    if (!t || !['app', 'time', 'device'].includes(t.type)) return null;
    const out = { type: t.type, on: t.on !== false };
    if (t.type === 'app') out.key = String(t.key || '').toLowerCase().slice(0, 80);
    if (t.type === 'time') { out.time = /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '08:00'; out.days = (Array.isArray(t.days) ? t.days : []).map(Number).filter((d) => d >= 0 && d <= 6); }
    if (t.type === 'device') out.device = String(t.device || '').slice(0, 80);
    return out;
  }

  // An app entry coming back from settings: valid zone, and a page address only if it's a web address
  function cleanApp(a) {
    const out = { ...a, zone: ZONES[a.zone] ? a.zone : '' };
    let u = String(a.url || '').trim();
    if (u && !/^https?:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+/.test(u)) u = `https://${u}`;
    if (/^https?:\/\/\S+$/i.test(u)) out.url = u.slice(0, 2000); else delete out.url;
    return out;
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
      apps: (ws.apps || []).map(cleanApp),
      trigger: cleanTrigger(ws.trigger),
    };
    persist(); broadcast();
  });

  return { activate, create, recapture, addApp, list: wsList, ZONES: Object.keys(ZONES), capture, cleanApp, targetRect, isBusy: () => busy, cleanTrigger, runPrivate, closePrivate, isPrivateOpen: () => !!privateOpen };
};
