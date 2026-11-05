// Talks to Windows directly (user32/kernel32/shell32/dwmapi): finds open app windows,
// focuses/minimises/closes them, hides the taskbar, reserves screen space and listens
// for minimise events. Workspaces will reuse this to move windows.
const isWin = process.platform === 'win32';

if (!isWin) {
  // Lets the app start on other systems for development; nothing is detected.
  const noop = () => {};
  module.exports = {
    available: false,
    listWindows: () => [], foregroundInfo: () => null, windowInfo: () => null, clipboardSeq: () => 0,
    focus: noop, minimize: noop, close: noop, rect: () => null, place: noop, raise: noop,
    registerShellHook: () => null, setForegroundRaw: noop, windowIcon: () => null,
    pressKeys: noop, showTaskbars: noop, taskbarAutoHide: () => false, setTaskbarAutoHide: noop,
    getMinAnimate: () => 1, setMinAnimate: noop, setWorkArea: noop,
    appbarSet: noop, appbarRemove: noop,
    onWinEvents: () => noop,
    EVENTS: { FOREGROUND: 0x0003, MOVESIZEEND: 0x000B, MINIMIZESTART: 0x0016, MINIMIZEEND: 0x0017 },
  };
} else {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const shell32 = koffi.load('shell32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const gdi32 = koffi.load('gdi32.dll');
  koffi.struct('ICONINFO', { fIcon: 'int32_t', xHotspot: 'uint32_t', yHotspot: 'uint32_t', hbmMask: 'uintptr_t', hbmColor: 'uintptr_t' });
  koffi.struct('BITMAP', { bmType: 'int32_t', bmWidth: 'int32_t', bmHeight: 'int32_t', bmWidthBytes: 'int32_t', bmPlanes: 'uint16_t', bmBitsPixel: 'uint16_t', bmBits: 'uintptr_t' });
  const g = {
    SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(HWND hwnd, uint32_t msg, uintptr_t w, intptr_t l, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
    GetClassLongPtrW: user32.func('uintptr_t __stdcall GetClassLongPtrW(HWND hwnd, int index)'),
    GetIconInfo: user32.func('bool __stdcall GetIconInfo(uintptr_t icon, _Out_ ICONINFO *info)'),
    GetDC: user32.func('uintptr_t __stdcall GetDC(uintptr_t hwnd)'),
    ReleaseDC: user32.func('int __stdcall ReleaseDC(uintptr_t hwnd, uintptr_t dc)'),
    GetObjectW: gdi32.func('int __stdcall GetObjectW(uintptr_t h, int size, _Out_ BITMAP *bm)'),
    GetDIBits: gdi32.func('int __stdcall GetDIBits(uintptr_t dc, uintptr_t bm, uint32_t start, uint32_t lines, void *bits, void *info, uint32_t usage)'),
    DeleteObject: gdi32.func('bool __stdcall DeleteObject(uintptr_t h)'),
  };
  // Reads a bitmap as top-down 32-bit BGRA
  function readBits(dc, hbm, w, h) {
    const info = Buffer.alloc(40 + 8);
    info.writeUInt32LE(40, 0); info.writeInt32LE(w, 4); info.writeInt32LE(-h, 8);
    info.writeUInt16LE(1, 12); info.writeUInt16LE(32, 14);
    const bits = Buffer.alloc(w * h * 4);
    return g.GetDIBits(dc, hbm, 0, h, bits, info, 0) ? bits : null;
  }
  // The icon an open window shows in its title bar / Alt+Tab, as BGRA pixels
  function windowIconNow(hwnd) {
    let icon = 0;
    for (const type of [1, 2, 0]) { // ICON_BIG, ICON_SMALL2, ICON_SMALL
      const out = [0];
      if (g.SendMessageTimeoutW(hwnd, 0x007F, type, 0, 0x0002, 150, out) && out[0]) { icon = out[0]; break; }
    }
    if (!icon) icon = g.GetClassLongPtrW(hwnd, -14) || g.GetClassLongPtrW(hwnd, -34); // GCLP_HICON, GCLP_HICONSM
    if (!icon) return null;
    const ii = {};
    if (!g.GetIconInfo(icon, ii)) return null;
    const dc = g.GetDC(0);
    try {
      if (!ii.hbmColor) return null;
      const bm = {};
      if (!g.GetObjectW(ii.hbmColor, koffi.sizeof('BITMAP'), bm)) return null;
      const w = bm.bmWidth, h = bm.bmHeight;
      if (w <= 0 || h <= 0 || w > 512 || h > 512) return null;
      const px = readBits(dc, ii.hbmColor, w, h);
      if (!px) return null;
      let anyAlpha = false;
      for (let i = 3; i < px.length; i += 4) if (px[i]) { anyAlpha = true; break; }
      if (!anyAlpha && ii.hbmMask) { // old-style icon: transparency comes from the mask
        const mask = readBits(dc, ii.hbmMask, w, h);
        for (let i = 0; i < px.length; i += 4) px[i + 3] = mask && mask[i] ? 0 : 255;
      }
      return { width: w, height: h, bgra: px };
    } finally {
      g.ReleaseDC(0, dc);
      if (ii.hbmColor) g.DeleteObject(ii.hbmColor);
      if (ii.hbmMask) g.DeleteObject(ii.hbmMask);
    }
  }

  koffi.pointer('HWND', koffi.opaque());
  koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  koffi.struct('APPBARDATA', { cbSize: 'uint32_t', hWnd: 'uintptr_t', uCallbackMessage: 'uint32_t', uEdge: 'uint32_t', rc: 'RECT', lParam: 'intptr_t' });
  koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');
  const WinEventProc = koffi.proto('void __stdcall WinEventProc(void *hook, uint32_t event, HWND hwnd, int32_t idObject, int32_t idChild, uint32_t thread, uint32_t time)');

  const f = {
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(HWND hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(HWND hwnd)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(HWND hwnd)'),
    GetClipboardSequenceNumber: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    GetWindow: user32.func('HWND __stdcall GetWindow(HWND hwnd, uint32_t cmd)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(HWND hwnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hwnd, uint16_t *buf, int max)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hwnd, uint16_t *buf, int max)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)'),
    GetForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(HWND hwnd)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(HWND hwnd, int cmd)'),
    ShowWindowAsync: user32.func('bool __stdcall ShowWindowAsync(HWND hwnd, int cmd)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(HWND hwnd, HWND after, int x, int y, int cx, int cy, uint32_t flags)'),
    RegisterShellHookWindow: user32.func('bool __stdcall RegisterShellHookWindow(void *hwnd)'),
    RegisterWindowMessageW: user32.func('uint32_t __stdcall RegisterWindowMessageW(str16 name)'),
    PostMessageW: user32.func('bool __stdcall PostMessageW(HWND hwnd, uint32_t msg, uintptr_t w, intptr_t l)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)'),
    FindWindowW: user32.func('HWND __stdcall FindWindowW(str16 cls, str16 title)'),
    FindWindowExW: user32.func('HWND __stdcall FindWindowExW(HWND parent, HWND after, str16 cls, str16 title)'),
    keybd_event: user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
    SystemParametersInfoW: user32.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *pv, uint32_t winIni)'),
    SetWinEventHook: user32.func('void * __stdcall SetWinEventHook(uint32_t min, uint32_t max, void *hmod, WinEventProc *cb, uint32_t pid, uint32_t tid, uint32_t flags)'),
    UnhookWinEvent: user32.func('bool __stdcall UnhookWinEvent(void *hook)'),
    SHAppBarMessage: shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ APPBARDATA *data)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, uint16_t *buf, _Inout_ uint32_t *size)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
    DwmGetWindowAttribute: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ uint32_t *val, uint32_t size)'),
  };

  const GW_OWNER = 4, GWL_STYLE = -16, GWL_EXSTYLE = -20;
  const WS_EX_TOOLWINDOW = 0x80, WS_CAPTION = 0x00C00000;
  const DWMWA_CLOAKED = 14, PROCESS_QUERY_LIMITED = 0x1000;
  const SW_HIDE = 0, SW_SHOW = 5, SW_MINIMIZE = 6, SW_RESTORE = 9, WM_CLOSE = 0x10;
  const KEYEVENTF_KEYUP = 2;
  const ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABM_GETSTATE = 4, ABM_SETSTATE = 10, ABE_BOTTOM = 3;
  const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

  const readText = (fn, hwnd) => {
    const buf = new Uint16Array(512);
    const n = fn(hwnd, buf, 512);
    return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : '';
  };
  const pidOf = (hwnd) => { const p = [0]; f.GetWindowThreadProcessId(hwnd, p); return p[0]; };
  const rectOf = (hwnd) => { const r = {}; return f.GetWindowRect(hwnd, r) ? r : null; };
  const hasCaption = (hwnd) => (Number(f.GetWindowLongPtrW(hwnd, GWL_STYLE)) & WS_CAPTION) === WS_CAPTION;

  const exeCache = new Map();
  let cacheAge = 0;
  function exeFor(pid) {
    if (exeCache.has(pid)) return exeCache.get(pid);
    let result = null;
    const h = f.OpenProcess(PROCESS_QUERY_LIMITED, false, pid);
    if (h) {
      try {
        const buf = new Uint16Array(1024);
        const size = [1024];
        if (f.QueryFullProcessImageNameW(h, 0, buf, size)) result = String.fromCharCode(...buf.subarray(0, size[0]));
      } finally {
        f.CloseHandle(h);
      }
    }
    exeCache.set(pid, result);
    return result;
  }

  // Real app windows (the ones Alt+Tab would show), top-most first.
  function listWindows() {
    if (++cacheAge > 60) { exeCache.clear(); cacheAge = 0; } // process ids get reused
    const fg = f.GetForegroundWindow();
    const fgAddr = fg ? koffi.address(fg) : -1n;
    const out = [];
    f.EnumWindows((hwnd) => {
      try {
        if (!f.IsWindowVisible(hwnd)) return true;
        if (f.GetWindow(hwnd, GW_OWNER)) return true;
        if (Number(f.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) return true;
        if (f.GetWindowTextLengthW(hwnd) === 0) return true;
        const cloaked = [0];
        f.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4);
        if (cloaked[0]) return true;
        const cls = readText(f.GetClassNameW, hwnd);
        if (SKIP_CLASSES.has(cls)) return true;
        const addr = koffi.address(hwnd);
        const minimized = f.IsIconic(hwnd);
        out.push({
          hwnd, addr, pid: pidOf(hwnd), cls, minimized,
          title: readText(f.GetWindowTextW, hwnd),
          rect: minimized ? null : rectOf(hwnd),
          hasCaption: hasCaption(hwnd),
          maximized: !minimized && f.IsZoomed(hwnd),
          foreground: addr === fgAddr,
        });
      } catch { /* window vanished mid-check */ }
      return true;
    }, 0);
    for (const w of out) w.exe = exeFor(w.pid);
    return out;
  }

  // Cheap check of just the focused window, used many times a second for auto-hide.
  function foregroundInfo() {
    const h = f.GetForegroundWindow();
    if (!h) return null;
    try {
      return {
        hwnd: h, addr: koffi.address(h), pid: pidOf(h), cls: readText(f.GetClassNameW, h), exe: exeFor(pidOf(h)),
        rect: rectOf(h), hasCaption: hasCaption(h), minimized: f.IsIconic(h), maximized: f.IsZoomed(h),
      };
    } catch { return null; }
  }

  function taskbars() {
    const list = [];
    const main = f.FindWindowW('Shell_TrayWnd', null);
    if (main) list.push(main);
    let prev = null;
    for (let i = 0; i < 8; i++) {
      prev = f.FindWindowExW(null, prev, 'Shell_SecondaryTrayWnd', null);
      if (!prev) break;
      list.push(prev);
    }
    return list;
  }
  const abd = (extra) => ({
    cbSize: koffi.sizeof('APPBARDATA'), hWnd: 0, uCallbackMessage: 0, uEdge: 0,
    rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0, ...extra,
  });
  // Window handles go into APPBARDATA as plain numbers
const hwndNum = (h) => (Buffer.isBuffer(h) ? h.readBigUInt64LE(0) : h ? koffi.address(h) : 0);

  let appbarHwnd = null;
  const hooks = [];

  module.exports = {
    available: true,
    listWindows,
    foregroundInfo,
    clipboardSeq: () => f.GetClipboardSequenceNumber(),
    windowInfo(hwnd) {
      try {
        const pid = pidOf(hwnd);
        return { pid, cls: readText(f.GetClassNameW, hwnd), title: readText(f.GetWindowTextW, hwnd), exe: exeFor(pid) };
      } catch { return null; }
    },
    rect: rectOf,
    windowIcon(hwnd) { try { return windowIconNow(hwnd); } catch { return null; } },
    focus(hwnd) {
      if (f.IsIconic(hwnd)) f.ShowWindowAsync(hwnd, SW_RESTORE);
      f.SetForegroundWindow(hwnd);
    },
    minimize(hwnd) { f.ShowWindowAsync(hwnd, SW_MINIMIZE); },
    // Move/resize a window (physical pixels). Maximised windows are restored first, then re-maximised if asked.
    place(hwnd, r, maximize) {
      if (f.IsIconic(hwnd) || f.IsZoomed(hwnd)) f.ShowWindow(hwnd, SW_RESTORE);
      f.SetWindowPos(hwnd, null, r.left, r.top, r.right - r.left, r.bottom - r.top, 0x0004 | 0x0010); // NOZORDER | NOACTIVATE
      if (maximize) f.ShowWindow(hwnd, 3); // SW_MAXIMIZE
    },
    raise(hwnd) { f.SetForegroundWindow(hwnd); },
    // Lets the dock hear when an app flashes for attention (what used to make taskbar buttons go orange)
    registerShellHook(handleBuffer) {
      const hwnd = koffi.decode(handleBuffer, 'void *'); // plain pointer: typed handles from a Buffer are rejected
      if (!f.RegisterShellHookWindow(hwnd)) return null;
      return f.RegisterWindowMessageW('SHELLHOOK');
    },
    addrOf: (h) => koffi.address(h),
    close(hwnd) { f.PostMessageW(hwnd, WM_CLOSE, 0, 0); },

    // Presses a key combo, e.g. [0x5B] = Windows key, [0x5B, 0x41] = Win + A
    pressKeys(keys) {
      for (const k of keys) f.keybd_event(k, 0, 0, 0);
      for (const k of [...keys].reverse()) f.keybd_event(k, 0, KEYEVENTF_KEYUP, 0);
    },

    // ----- the Windows taskbar -----
    showTaskbars(show) {
      for (const h of taskbars()) {
        const vis = f.IsWindowVisible(h);
        if (show && !vis) f.ShowWindow(h, SW_SHOW);
        if (!show && vis) f.ShowWindow(h, SW_HIDE);
      }
    },
    taskbarAutoHide() {
      return (Number(f.SHAppBarMessage(ABM_GETSTATE, abd({}))) & 1) === 1;
    },
    setTaskbarAutoHide(on) {
      const tray = f.FindWindowW('Shell_TrayWnd', null);
      if (tray) f.SHAppBarMessage(ABM_SETSTATE, abd({ hWnd: hwndNum(tray), lParam: on ? 1 : 2 }));
    },

    // ----- Windows' own minimise/restore animation -----
    getMinAnimate() {
      const a = Buffer.alloc(8); a.writeUInt32LE(8, 0); a.writeInt32LE(1, 4); // ANIMATIONINFO
      f.SystemParametersInfoW(0x0048, 8, a, 0);
      return a.readInt32LE(4);
    },
    setMinAnimate(on) {
      const a = Buffer.alloc(8); a.writeUInt32LE(8, 0); a.writeInt32LE(on ? 1 : 0, 4);
      // SPIF_SENDCHANGE only (not saved to the profile), so a sign-out always restores it
      f.SystemParametersInfoW(0x0049, 8, a, 2);
    },

    // ----- the usable screen area (what maximised windows fill) -----
    // rect in physical pixels: { left, top, right, bottom }
    setWorkArea(r, broadcast = true) {
      const b = Buffer.alloc(16);
      b.writeInt32LE(r.left, 0); b.writeInt32LE(r.top, 4); b.writeInt32LE(r.right, 8); b.writeInt32LE(r.bottom, 12);
      f.SystemParametersInfoW(0x002F, 0, b, broadcast ? 2 : 0); // SPI_SETWORKAREA (+ SPIF_SENDCHANGE so open windows resize)
    },

    // ----- reserve space at the bottom so maximised windows stop above the dock -----
    // rect is in physical pixels: { left, top, right, bottom } of the monitor; height in physical px
    appbarSet(handleBuffer, mon, height) {
      const hwnd = hwndNum(handleBuffer);
      if (!appbarHwnd) { f.SHAppBarMessage(ABM_NEW, abd({ hWnd: hwnd, uCallbackMessage: 0x8000 + 77 })); appbarHwnd = hwnd; }
      const d = abd({ hWnd: hwnd, uEdge: ABE_BOTTOM, rc: { left: mon.left, right: mon.right, top: mon.bottom - height, bottom: mon.bottom } });
      f.SHAppBarMessage(ABM_QUERYPOS, d);
      d.rc.top = d.rc.bottom - height;
      f.SHAppBarMessage(ABM_SETPOS, d);
    },
    appbarRemove() {
      if (!appbarHwnd) return;
      f.SHAppBarMessage(ABM_REMOVE, abd({ hWnd: appbarHwnd }));
      appbarHwnd = null;
    },

    // ----- instant notifications: focus changes, minimise start/end, move/resize end -----
    onWinEvents(handler) {
      const cb = koffi.register((_hook, event, hwnd, idObject) => {
        if (idObject !== 0 || !hwnd) return; // only whole windows
        try { handler(event, hwnd, koffi.address(hwnd)); } catch (e) { console.error(e); }
      }, koffi.pointer(WinEventProc));
      const OUTOFCONTEXT = 0x0000; // our own windows included, so we know when a click on the dock closed Start
      for (const [a, b] of [[0x0003, 0x0003], [0x000B, 0x000B], [0x0016, 0x0017]]) {
        const h = f.SetWinEventHook(a, b, null, cb, 0, 0, OUTOFCONTEXT);
        if (h) hooks.push(h);
      }
      return () => { hooks.splice(0).forEach((h) => f.UnhookWinEvent(h)); koffi.unregister(cb); };
    },
    EVENTS: { FOREGROUND: 0x0003, MOVESIZEEND: 0x000B, MINIMIZESTART: 0x0016, MINIMIZEEND: 0x0017 },
  };
}
