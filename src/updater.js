// Auto-updates from GitHub Releases. Downloads quietly in the background, then offers
// "Restart to update" in the island, the tray menu and settings.
const { app, ipcMain } = require('electron');

module.exports = function createUpdater({ notify, onChange }) {
  const state = { status: 'idle', version: null, message: '', progress: 0 };
  let au = null;
  // Where updates come from. The installer normally ships this in app-update.yml;
  // if that file is missing, the same details are set directly below.
  const FEED = { provider: 'github', owner: 'agnardadi1', repo: 'glass-dock' };
  const path = require('path');
  const fs = require('fs');
  const hasYml = fs.existsSync(path.join(process.resourcesPath || '', 'app-update.yml'));
  const configured = true;

  function set(patch) { Object.assign(state, patch); onChange(state); }

  if (!app.isPackaged) set({ status: 'dev', message: 'Updates work in the installed app (not while testing with npm start).' });
  else if (!configured) set({ status: 'off', message: 'This copy was built without update information, so it can\'t update itself. Install the latest version from github.com/agnardadi1/glass-dock/releases.' });
  else {
    try {
      ({ autoUpdater: au } = require('electron-updater'));
      if (!hasYml) au.setFeedURL(FEED);
      au.autoDownload = true;
      au.autoInstallOnAppQuit = true;
      au.on('checking-for-update', () => set({ status: 'checking', message: 'Checking for updates…' }));
      au.on('update-not-available', () => set({ status: 'latest', message: `You have the latest version (${app.getVersion()}).` }));
      au.on('update-available', (i) => set({ status: 'downloading', version: i.version, message: `Downloading version ${i.version}…`, progress: 0 }));
      au.on('download-progress', (p) => set({ progress: Math.round(p.percent), message: `Downloading version ${state.version}… ${Math.round(p.percent)}%` }));
      au.on('update-downloaded', (i) => {
        set({ status: 'ready', version: i.version, message: `Version ${i.version} is ready. Restart the dock to use it.` });
        notify({ version: i.version });
      });
      au.on('error', (e) => { console.error('[updates]', e && e.message); set({ status: 'error', message: 'Couldn\'t check for updates. It will try again later.' }); });
      setTimeout(() => au.checkForUpdates().catch(() => {}), 15000);
      setInterval(() => au.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
    } catch (e) {
      console.error('[updates]', e.message);
      set({ status: 'error', message: 'The updater could not start.' });
    }
  }

  ipcMain.handle('update-state', () => ({ ...state, current: app.getVersion() }));
  ipcMain.handle('update-check', () => { if (au) au.checkForUpdates().catch(() => {}); return state; });
  ipcMain.on('update-install', () => { if (au && state.status === 'ready') au.quitAndInstall(true, true); });

  return { state, install: () => { if (au && state.status === 'ready') au.quitAndInstall(true, true); } };
};
