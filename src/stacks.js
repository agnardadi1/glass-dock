// Folder stacks: clicking Downloads (or a pinned folder) shows its newest files right above the dock.
const { BrowserWindow, ipcMain, shell, nativeImage, app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const MAX = 16;

module.exports = function createStacks({ webPrefs, dockWin, restRect, safe, resolveDir }) {
  let win = null, folder = null, hiddenAt = 0, lastUid = null;
  const thumbs = new Map(); // path|mtime -> data URL
  const alive = () => win && !win.isDestroyed();

  function create() {
    win = new BrowserWindow({
      width: 460, height: 420, frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      show: false, backgroundColor: '#00000000', webPreferences: webPrefs,
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.loadFile(path.join(__dirname, 'renderer', 'stack.html'));
    win.on('blur', () => { if (win.isVisible()) { win.hide(); hiddenAt = Date.now(); } });
  }

  async function thumbFor(p, mtime, isDir) {
    const k = p + '|' + mtime;
    if (thumbs.has(k)) return thumbs.get(k);
    let img = null;
    if (!isDir) { try { img = await nativeImage.createThumbnailFromPath(p, { width: 112, height: 112 }); } catch { /* no preview */ } }
    if (!img || img.isEmpty()) { try { img = await app.getFileIcon(p, { size: 'large' }); } catch { /* none */ } }
    const url = img && !img.isEmpty() ? img.toDataURL() : null;
    thumbs.set(k, url);
    if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value);
    return url;
  }

  async function list(dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return { error: e.message, files: [] }; }
    const files = [];
    for (const n of names) {
      if (n.startsWith('.') || /^desktop\.ini$/i.test(n) || /\.(crdownload|part|partial|tmp)$/i.test(n)) continue;
      try {
        const st = fs.statSync(path.join(dir, n));
        files.push({ name: n, path: path.join(dir, n), mtime: st.mtimeMs, size: st.size, dir: st.isDirectory() });
      } catch { /* vanished */ }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const top = files.slice(0, MAX);
    for (const f of top) f.icon = await thumbFor(f.path, f.mtime, f.dir);
    return { files: top, total: files.length };
  }

  async function open(dir, title, tileRect, uid) {
    if (!alive()) create();
    if (win.isVisible() && lastUid === uid) { win.hide(); return; }
    if (Date.now() - hiddenAt < 300 && lastUid === uid) return; // the click that closed it
    lastUid = uid;
    folder = dir;
    if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
    const data = await list(dir);
    const n = Math.min(data.files.length, MAX);
    const cols = n <= 4 ? Math.max(n, 2) : 4;
    const rows = Math.max(1, Math.ceil(n / cols));
    const width = cols * 106 + 28, height = rows * 126 + 96;
    const d = screen.getDisplayMatching(tileRect);
    const b = d.bounds;
    const top = (restRect() ? restRect().y : tileRect.y) - height - 8;
    const x = Math.round(Math.max(b.x + 8, Math.min(tileRect.x + tileRect.width / 2 - width / 2, b.x + b.width - width - 8)));
    win.setBounds({ x, y: Math.round(top), width, height });
    win.webContents.send('stack', { title, dir, ...data });
    win.show();
    win.focus();
  }

  ipcMain.on('stack-open', (_e, { dir, title, rect, uid }) => {
    const dw = dockWin();
    if (!dw) return;
    const wb = dw.getBounds();
    const target = dir === 'downloads' ? app.getPath('downloads') : resolveDir(dir);
    if (!target) return;
    safe('stacks', () => open(target, title, { x: wb.x + rect.x, y: wb.y + rect.y, width: rect.width, height: rect.height }, uid));
  });
  ipcMain.on('stack-file', (_e, p) => { if (folder && p.startsWith(folder)) { shell.openPath(p); if (alive()) win.hide(); } });
  ipcMain.on('stack-reveal', (_e, p) => { if (folder && p.startsWith(folder)) shell.showItemInFolder(p); });
  ipcMain.on('stack-folder', () => { if (folder) shell.openPath(folder); if (alive()) win.hide(); });
  ipcMain.on('stack-drag', (e, p) => {
    if (!folder || !p.startsWith(folder)) return;
    let icon = nativeImage.createEmpty();
    try { const t = [...thumbs.entries()].find(([k]) => k.startsWith(p + '|')); if (t && t[1]) icon = nativeImage.createFromDataURL(t[1]).resize({ width: 64 }); } catch { /* plain drag */ }
    e.sender.startDrag({ file: p, icon: icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') : icon });
  });
  ipcMain.on('stack-close', () => { if (alive()) win.hide(); });

  return { isOpen: () => alive() && win.isVisible() };
};
