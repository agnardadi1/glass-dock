// PC stats, measured only while something is showing them (the island's stats panel, the game HUD,
// the companion panel). Keeps the last ten minutes so the companion can draw graphs.
const { execFile } = require('child_process');
const os = require('os');

const KEEP_MS = 10 * 60 * 1000;

module.exports = function createStats({ win32, getSettings, isGame, safe }) {
  const wants = new Set();
  const subs = [];
  let timer = null, prevCpu = null, gpuMissing = false, last = null;
  const history = [];

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
  async function sample() {
    const now = cpuTimes();
    const cpu = prevCpu ? Math.round(100 * (1 - (now.idle - prevCpu.idle) / Math.max(1, now.total - prevCpu.total))) : null;
    prevCpu = now;
    const total = os.totalmem(), free = os.freemem();
    // In a game: its frame rate too, when RTSS (MSI Afterburner) is running
    let fps = null, fpsSource = false, game = null;
    if (isGame() && getSettings().gameFps !== false && win32.available) {
      try {
        const fg = win32.foregroundInfo();
        const r = fg ? win32.gameFps(fg.pid) : null;
        fpsSource = r !== null; fps = r ? r.fps : null; game = fg ? fg.exe : null;
      } catch { /* no RTSS */ }
    }
    last = { t: Date.now(), cpu, ramUsed: total - free, ramTotal: total, fps, fpsSource, game, inGame: isGame(), ...(await gpuStats()) };
    history.push(last);
    while (history.length && history[0].t < last.t - KEEP_MS) history.shift();
    for (const cb of subs) safe('stats', () => cb(last));
  }
  function schedule() {
    clearInterval(timer);
    timer = null;
    if (!wants.size) return;
    prevCpu = cpuTimes();
    sample();
    timer = setInterval(() => safe('stats', sample), isGame() ? 1000 : 1500);
  }

  return {
    // who needs stats right now; sampling runs while anyone does
    want(name, on) { const had = wants.size > 0; if (on) wants.add(name); else wants.delete(name); if ((wants.size > 0) !== had || on) schedule(); },
    on(cb) { subs.push(cb); },
    history: () => history,
    last: () => last,
    retime: () => { if (timer) schedule(); }, // the game started or ended: switch the rate
  };
};
