// Saves the dock's pinned apps and settings to a JSON file in the user's AppData folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_LOOK = {
  tint: 'glass', custom: '#7c5cff', alpha: 0.62,
  glow: 'off', glowCol: '#7aa8ff', glowSize: 22, glowArt: false,
  shape: 'rounded', icon: 'squircle', ind: 'dot', tiles: true,
};

const DEFAULT_ISLAND = {
  on: true,
  display: 'dock',          // 'dock' | 'mouse' | a display id
  align: 'center',          // 'left' | 'center' | 'right'
  top: 6,                   // distance from the top of the screen
  scale: 1,
  idle: 'clock',            // 'hide' | 'pill' | 'clock'
  fullscreenHide: true,
  music: true, volume: true, privacy: true, shots: true, downloads: true, timer: false,
  // what hovering the quiet island shows (each can be switched off)
  panels: { clock: true, weather: true, stats: true, resume: true, launch: true, clipboard: true },
  weatherPlace: '',         // empty = work it out from the internet connection
  units: 'c',               // 'c' | 'f'
  launch: [],               // quick-launch favourites: { path, name, icon }
  v: 6,
};

const DEFAULT_SETTINGS = {
  size: 52, mag: 1.8, magOn: true,
  hotkeys: true, displayId: null,
  autoHide: 'fullscreen',   // 'off' | 'fullscreen' | 'smart' | 'always'
  replaceTaskbar: false,
  minimizeToDock: true,
  media: true,
  soundButton: true,
  workspacesInDock: true,
  settingsButton: true,
  startButton: false,
  badges: true,
  stacks: true,
  gameMode: true,
  gameIsland: 'stats',      // 'stats' | 'hide' | 'normal'
  gameApps: [],             // programs you marked as games from the dock menu
  notGames: [],             // programs you said aren't games
  gameFps: true,            // show the game's frame rate in the island (needs RTSS / MSI Afterburner)
  gameEdgeReveal: false,    // pushing the mouse to the bottom edge shows the dock during games
  look: DEFAULT_LOOK,
  island: DEFAULT_ISLAND,
};

const file = () => path.join(app.getPath('userData'), 'dock.json');

function islandFrom(saved) {
  const i = { ...DEFAULT_ISLAND, ...saved, panels: { ...DEFAULT_ISLAND.panels, ...(saved && saved.panels) } };
  if (!saved || saved.v !== 6) { i.timer = false; i.v = 6; } // 0.6: timer is off unless you turn it on
  return i;
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const saved = d.settings || {};
    if (!saved.autoHide && saved.hideFullscreen === false) saved.autoHide = 'off'; // from v0.1
    delete saved.hideFullscreen;
    return {
      items: Array.isArray(d.items) ? d.items : null,
      settings: { ...DEFAULT_SETTINGS, ...saved, look: { ...DEFAULT_LOOK, ...saved.look }, island: islandFrom(saved.island) },
      // Windows settings we changed, so they can be put back even after a crash
      restore: d.restore || {},
      workspaces: Array.isArray(d.workspaces) ? d.workspaces : [],
      activeWorkspace: d.activeWorkspace || null,
    };
  } catch {
    return { items: null, settings: structuredClone(DEFAULT_SETTINGS), restore: {}, workspaces: [], activeWorkspace: null };
  }
}

function writeNow(state) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file() + '.tmp', JSON.stringify(state, null, 1));
    fs.renameSync(file() + '.tmp', file());
  } catch (e) {
    console.error('Could not save dock settings:', e);
  }
}

let timer = null;
function save(state) {
  clearTimeout(timer);
  timer = setTimeout(() => writeNow(state), 300);
}
function flush(state) {
  clearTimeout(timer);
  writeNow(state);
}

module.exports = { load, save, flush, DEFAULT_LOOK, DEFAULT_SETTINGS, DEFAULT_ISLAND };
