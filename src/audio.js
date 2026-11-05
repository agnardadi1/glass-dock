// Lists speakers/headphones and microphones, switches the Windows default device and
// controls volume/mute, through a small background PowerShell helper (compiled once at start).
const { spawn } = require('child_process');

// C# 5 only (Windows PowerShell 5.1 compiles with the old .NET Framework compiler)
const CSHARP = String.raw`
using System;
using System.Text;
using System.Globalization;
using System.Runtime.InteropServices;
namespace GlassDock {
  [StructLayout(LayoutKind.Sequential)] public struct PropKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PropVar { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr ptr; }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out int c);
    [PreserveSig] int GetAt(int i, out PropKey k);
    [PreserveSig] int GetValue(ref PropKey k, out PropVar v);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int Item(int i, out IMMDevice d);
  }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection col);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
    [PreserveSig] int GetChannelCount(out uint n);
    [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
    [PreserveSig] int SetMasterVolumeLevelScalar(float v, ref Guid ctx);
    [PreserveSig] int GetMasterVolumeLevel(out float db);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float v);
    [PreserveSig] int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float v, ref Guid ctx);
    [PreserveSig] int GetChannelVolumeLevel(uint ch, out float db);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float v);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  // Undocumented but long-standing Windows interface used by sound switcher tools to change the default device
  [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPolicyConfig {
    [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
    [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
    [PreserveSig] int ResetDeviceFormat(IntPtr a);
    [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
    [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
    [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
    [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
    [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
    [PreserveSig] int GetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
    [PreserveSig] int SetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumeratorCom { }
  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] public class PolicyConfigCom { }

  public static class Snd {
    static IMMDeviceEnumerator En() { return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); }
    static string Esc(string s) {
      StringBuilder b = new StringBuilder();
      foreach (char c in s ?? "") {
        if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
        else if (c < 32) b.Append(' ');
        else b.Append(c);
      }
      return b.ToString();
    }
    static string Name(IMMDevice d) {
      IPropertyStore ps;
      if (d.OpenPropertyStore(0, out ps) != 0 || ps == null) return "Unknown device";
      PropKey k = new PropKey(); k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 14;
      PropVar v;
      if (ps.GetValue(ref k, out v) != 0 || v.ptr == IntPtr.Zero) return "Unknown device";
      return Marshal.PtrToStringUni(v.ptr);
    }
    static string DefaultId(IMMDeviceEnumerator en, int flow) {
      IMMDevice d; string id;
      if (en.GetDefaultAudioEndpoint(flow, 0, out d) != 0 || d == null) return "";
      d.GetId(out id);
      return id ?? "";
    }
    static IAudioEndpointVolume Vol(IMMDeviceEnumerator en, int flow) {
      IMMDevice d; object o;
      if (en.GetDefaultAudioEndpoint(flow, 0, out d) != 0 || d == null) return null;
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      if (d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null;
      return (IAudioEndpointVolume)o;
    }
    public static string State() {
      IMMDeviceEnumerator en = En();
      StringBuilder sb = new StringBuilder("{");
      for (int flow = 0; flow < 2; flow++) {
        sb.Append(flow == 0 ? "\"out\":[" : ",\"in\":[");
        string def = DefaultId(en, flow);
        IMMDeviceCollection col;
        if (en.EnumAudioEndpoints(flow, 1, out col) == 0 && col != null) {
          int n; col.GetCount(out n);
          for (int i = 0; i < n; i++) {
            IMMDevice d; string id;
            if (col.Item(i, out d) != 0 || d == null) continue;
            d.GetId(out id);
            if (i > 0) sb.Append(",");
            sb.Append("{\"id\":\"" + Esc(id) + "\",\"name\":\"" + Esc(Name(d)) + "\",\"def\":" + (id == def ? "true" : "false") + "}");
          }
        }
        sb.Append("]");
        IAudioEndpointVolume v = Vol(en, flow);
        float lv = 0; bool m = false;
        if (v != null) { v.GetMasterVolumeLevelScalar(out lv); v.GetMute(out m); }
        sb.Append(flow == 0 ? ",\"vol\":" : ",\"micVol\":");
        sb.Append(lv.ToString("0.000", CultureInfo.InvariantCulture));
        sb.Append(flow == 0 ? ",\"mute\":" : ",\"micMute\":");
        sb.Append(m ? "true" : "false");
      }
      sb.Append("}");
      return sb.ToString();
    }
    public static void SetDefault(string id) {
      IPolicyConfig pc = (IPolicyConfig)new PolicyConfigCom();
      for (int role = 0; role < 3; role++) pc.SetDefaultEndpoint(id, role); // console, multimedia, communications
    }
    public static void SetVolume(int flow, float v) {
      IAudioEndpointVolume vol = Vol(En(), flow);
      if (vol == null) return;
      Guid g = Guid.Empty;
      vol.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref g);
    }
    public static void SetMute(int flow, bool m) {
      IAudioEndpointVolume vol = Vol(En(), flow);
      if (vol == null) return;
      Guid g = Guid.Empty;
      vol.SetMute(m, ref g);
    }
  }
}
`;

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$stdin = [Console]::OpenStandardInput()
$inBuf = New-Object byte[] 4096
$read = $stdin.ReadAsync($inBuf, 0, 4096)
$last = ''; $tick = 0
$use = '{"mic":[],"cam":[]}'
# Windows records which apps are using the microphone/camera right now (LastUsedTimeStop = 0)
function InUse($cap) {
  $base = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$cap"
  $names = @()
  $keys = @(Get-ChildItem $base -ErrorAction SilentlyContinue) + @(Get-ChildItem "$base\\NonPackaged" -ErrorAction SilentlyContinue)
  foreach ($k in $keys) {
    $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if ($p -and $p.LastUsedTimeStart -and $p.LastUsedTimeStop -eq 0) { $names += $k.PSChildName }
  }
  return ,$names
}
while ($true) {
  $force = $false
  try {
    if ($read.IsCompleted) {
      $n = $read.Result
      if ($n -le 0) { break }
      $lines = [Text.Encoding]::UTF8.GetString($inBuf, 0, $n) -split "\\n"
      $read = $stdin.ReadAsync($inBuf, 0, 4096)
      foreach ($line in $lines) {
        $parts = $line.Trim().Split(' ', 2)
        if ($parts.Count -lt 2) { continue }
        $cmd = $parts[0]; $arg = $parts[1]
        if ($cmd -eq 'set') { [GlassDock.Snd]::SetDefault($arg) }
        elseif ($cmd -eq 'vol') { [GlassDock.Snd]::SetVolume(0, [float]::Parse($arg, $inv)) }
        elseif ($cmd -eq 'micvol') { [GlassDock.Snd]::SetVolume(1, [float]::Parse($arg, $inv)) }
        elseif ($cmd -eq 'mute') { [GlassDock.Snd]::SetMute(0, $arg -eq '1') }
        elseif ($cmd -eq 'micmute') { [GlassDock.Snd]::SetMute(1, $arg -eq '1') }
        $force = $true
      }
    }
    $tick++
    if (($tick % 5) -eq 1) { $use = (@{ mic = @(InUse 'microphone'); cam = @(InUse 'webcam') } | ConvertTo-Json -Compress) }
    $out = [GlassDock.Snd]::State()
    $out = $out.Substring(0, $out.Length - 1) + ',"use":' + $use + '}'
    if ($out -ne $last) { $last = $out; [Console]::Out.WriteLine($out); [Console]::Out.Flush() }
  } catch {
    [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}')
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 1000
  }
  Start-Sleep -Milliseconds 200
}
`;

class Sound {
  constructor(onState) {
    this.onState = onState;
    this.proc = null;
    this.stopped = true;
    this.last = null;
  }
  start() {
    if (process.platform !== 'win32' || this.proc) return;
    this.stopped = false;
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    this.proc = p;
    let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.error) { console.error('[sound]', msg.error); continue; }
          this.last = msg;
          this.onState(msg);
        } catch { /* partial line */ }
      }
    });
    p.stderr.on('data', (d) => {
      // PowerShell wraps its output in CLIXML; only real errors are worth showing
      const text = String(d);
      const errs = [...text.matchAll(/<S S="Error">([^<]*)<\/S>/g)].map((m) => m[1].replace(/_x000D__x000A_/g, ' ').trim()).filter(Boolean);
      if (errs.length) console.error('[sound]', errs.join(' '));
      else if (!text.includes('CLIXML') && !text.includes('<Objs')) console.error('[sound]', text.trim());
    });
    p.on('exit', () => {
      this.proc = null;
      if (!this.stopped) setTimeout(() => this.start(), 5000);
    });
  }
  send(cmd) { if (this.proc) this.proc.stdin.write(cmd + '\n'); }
  stop() {
    this.stopped = true;
    if (this.proc) { try { this.proc.kill(); } catch { /* gone */ } this.proc = null; }
  }
}

module.exports = { Sound, SCRIPT };
