// Private workspaces: kept encrypted with your password (AES-256-GCM, key from scrypt), never shown on
// the dock, menus, tray or island. A shortcut asks for the password and opens one; pressing it again
// closes the windows it opened.
const { BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const crypto = require('crypto');
const path = require('path');

const AUTO_LOCK_MS = 5 * 60 * 1000;

module.exports = function createPrivate({ getState, persist, workspaces, webPrefs, safe, newId }) {
  let key = null;          // derived key while unlocked
  let list = null;         // decrypted private workspaces while unlocked
  let lockTimer = null;
  let promptWin = null;
  let registered = null;

  const vault = () => getState().vault || null;
  const b64 = (b) => Buffer.from(b).toString('base64');
  const unb64 = (s) => Buffer.from(s, 'base64');
  const derive = (pw, salt) => crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });

  function seal(k, obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', k, iv);
    const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return { iv: b64(iv), tag: b64(c.getAuthTag()), data: b64(data) };
  }
  function open(k, v) {
    const d = crypto.createDecipheriv('aes-256-gcm', k, unb64(v.iv));
    d.setAuthTag(unb64(v.tag));
    return JSON.parse(Buffer.concat([d.update(unb64(v.data)), d.final()]).toString('utf8'));
  }
  function save() {
    const v = vault();
    getState().vault = { v: 1, salt: v.salt, ...seal(key, list) };
    persist();
  }
  function touch() {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(lock, AUTO_LOCK_MS);
  }
  function lock() { key = null; list = null; clearTimeout(lockTimer); }
  function unlock(pw) {
    const v = vault();
    if (!v) return false;
    try {
      const k = derive(pw, unb64(v.salt));
      const l = open(k, v);
      key = k; list = Array.isArray(l) ? l : [];
      touch();
      return true;
    } catch { return false; }
  }
  const brief = () => (list || []).map((w) => ({ id: w.id, name: w.name, icon: w.icon }));

  // ---------- the password box ----------
  function showPrompt() {
    if (promptWin && !promptWin.isDestroyed()) { promptWin.show(); promptWin.focus(); return; }
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const w = 340, h = 230;
    promptWin = new BrowserWindow({
      x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: Math.round(d.workArea.y + d.workArea.height * 0.32),
      width: w, height: h, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false,
      backgroundColor: '#00000000', webPreferences: webPrefs,
    });
    promptWin.setAlwaysOnTop(true, 'screen-saver');
    promptWin.loadFile(path.join(__dirname, 'renderer', 'lock.html'));
    promptWin.once('ready-to-show', () => { promptWin.show(); promptWin.focus(); });
    promptWin.on('blur', () => closePrompt());
  }
  function closePrompt() {
    if (promptWin && !promptWin.isDestroyed()) promptWin.close();
    promptWin = null;
  }

  async function openWorkspace(id) {
    const ws = (list || []).find((w) => w.id === id);
    if (!ws) return false;
    closePrompt();
    const copy = JSON.parse(JSON.stringify(ws));
    lock(); // nothing stays decrypted while it's in use
    await safe('private', () => workspaces.runPrivate(copy));
    return true;
  }

  function onShortcut() {
    if (workspaces.isPrivateOpen()) { workspaces.closePrivate(); return; } // second press: close it again
    if (!vault()) return;
    showPrompt();
  }
  function registerShortcut(accel) {
    if (registered) { try { globalShortcut.unregister(registered); } catch { /* not registered */ } registered = null; }
    if (!accel) return true;
    try {
      if (globalShortcut.register(accel, onShortcut)) { registered = accel; return true; }
    } catch { /* invalid */ }
    console.error('[private] could not use the shortcut', accel);
    return false;
  }

  // ---------- from the password box ----------
  ipcMain.handle('pv-try', (_e, pw) => {
    if (!unlock(pw)) return { ok: false };
    const l = brief();
    if (l.length === 1) { openWorkspace(l[0].id); return { ok: true, opening: true }; }
    return { ok: true, list: l };
  });
  ipcMain.handle('pv-open', (_e, id) => openWorkspace(id));
  ipcMain.on('pv-cancel', () => { closePrompt(); lock(); });

  // ---------- from settings (needs the password too) ----------
  ipcMain.handle('pv-status', () => ({ hasPassword: !!vault(), unlocked: !!key, list: key ? list : null, shortcut: getState().settings.privateShortcut || 'Alt+Shift+0' }));
  ipcMain.handle('pv-set-password', (_e, { pw, oldPw }) => {
    if (!pw || String(pw).length < 4) return { ok: false, error: 'Use at least 4 characters.' };
    if (vault()) {
      if (!key && !unlock(oldPw)) return { ok: false, error: 'The current password is wrong.' };
    } else { list = []; }
    const salt = crypto.randomBytes(16);
    key = derive(pw, salt);
    getState().vault = { v: 1, salt: b64(salt), ...seal(key, list) };
    persist(); touch();
    return { ok: true };
  });
  ipcMain.handle('pv-unlock', (_e, pw) => ({ ok: unlock(pw), list }));
  ipcMain.handle('pv-lock', () => { lock(); return true; });
  const needKey = () => { if (!key) throw new Error('locked'); touch(); };
  ipcMain.handle('pv-create', () => {
    needKey();
    list.push({ id: newId(), name: `Private ${list.length + 1}`, icon: '🔒', apps: workspaces.capture(), urls: [], privateBrowsing: true, closeOld: false, minimizeOthers: true });
    save(); return list;
  });
  ipcMain.handle('pv-capture', (_e, id) => { needKey(); const w = list.find((x) => x.id === id); if (w) { w.apps = workspaces.capture(); save(); } return list; });
  ipcMain.handle('pv-update', (_e, ws) => {
    needKey();
    const i = list.findIndex((x) => x.id === ws.id);
    if (i < 0) return list;
    const keep = list[i];
    list[i] = {
      ...keep, name: String(ws.name || keep.name).slice(0, 40), icon: String(ws.icon || keep.icon).slice(0, 8),
      privateBrowsing: ws.privateBrowsing !== false, minimizeOthers: ws.minimizeOthers !== false, closeAll: !!ws.closeAll,
      urls: (ws.urls || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 20), apps: ws.apps || keep.apps,
    };
    save(); return list;
  });
  ipcMain.handle('pv-delete', (_e, id) => { needKey(); list = list.filter((x) => x.id !== id); save(); return list; });
  ipcMain.handle('pv-open-now', async (_e, id) => openWorkspace(id));
  // Forgotten password: everything private can be deleted (it stays unreadable either way)
  ipcMain.handle('pv-remove-all', () => {
    delete getState().vault; lock(); persist();
    return { ok: true };
  });

  return { registerShortcut, lock };
};
