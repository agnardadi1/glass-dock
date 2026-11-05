// Loads src/win32.js as if on Windows, with the Windows DLLs swapped for a stand-in that
// still makes koffi parse every type, struct and function declaration. Catches
// "Unknown or invalid type name" style crashes without needing a Windows PC.
const Module = require('module');
const path = require('path');
const koffi = require('koffi');

const libc = koffi.load(process.platform === 'darwin' ? 'libc.dylib' : 'libc.so.6');
const fakeLib = {
  func(sig) {
    const m = /^\s*(.+?)\s+(?:__stdcall\s+)?(\w+)\s*\((.*)\)\s*$/s.exec(sig);
    if (!m) throw new Error('could not read declaration: ' + sig);
    return libc.func(sig.replace(/(\s)(\w+)(\s*\()/, '$1strlen$3')); // real parsing, harmless symbol
  },
};
const realLoad = koffi.load;
koffi.load = () => fakeLib;
Object.defineProperty(process, 'platform', { value: 'win32' });

const origResolve = Module._resolveFilename;
let ok = false;
try {
  const w = require(path.join(__dirname, '..', 'src', 'win32.js'));
  ok = w.available === true;
  console.log('win32.js loads on "Windows":', ok ? 'yes' : 'no');
} catch (e) {
  console.error('win32.js failed to load:', e.message);
  process.exitCode = 1;
} finally {
  koffi.load = realLoad;
  Module._resolveFilename = origResolve;
}
if (!ok) process.exitCode = 1;
