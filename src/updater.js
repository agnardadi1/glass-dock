// Auto-updates from GitHub Releases. Downloads quietly in the background, then offers
// "Restart to update" in the island, the tray menu and settings.
const { app, ipcMain } = require('electron');

module.exports = function createUpdater({ notify, onChange }) {
  const state = { status: 'idle', version: null, message: '', progress: 0 };
  let au = null;
  const pkg = require('../package.json');
  const pub = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
  const configured = pub.owner && pub.owner !== 'YOUR_GITHUB_NAME';

  function set(patch) { Object.assign(state, patch); onChange(state); }

  if (!app.isPackaged) set({ status: 'dev', message: 'Updates work in the installed app (not while testing with npm start).' });
  else if (!configured) set({ status: 'off', message: 'Auto-updates aren\'t set up yet: run "npm run setup-updates" before building.' });
  else {
    try {
      ({ autoUpdater: au } = require('electron-updater'));
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
