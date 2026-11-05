// Reads what's playing (Spotify, browsers, any app that shows up in Windows' media pop-up)
// through a small background PowerShell helper, and sends it play/pause/next/previous.
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IContentTypeProvider,Windows.Storage.Streams,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(3000)
  if ($t.IsCompleted) { return $t.Result } else { return $null }
}
$MgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$AsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$GetInputStreamAt = [Windows.Storage.Streams.IRandomAccessStream].GetMethod('GetInputStreamAt')
$SizeProp = [Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size')
$ContentTypeProp = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType')
$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($MgrType::RequestAsync()) $MgrType
$stdin = [Console]::OpenStandardInput()
$inBuf = New-Object byte[] 1024
$read = $stdin.ReadAsync($inBuf, 0, 1024)
$pick = 0; $lastKey = ''; $lastOut = ''; $tick = 0; $current = $null; $artTries = 0; $artKey = ''; $lastArtWhy = ''
while ($true) {
  try {
    if ($read.IsCompleted) {
      $n = $read.Result
      if ($n -le 0) { break }
      $cmds = [Text.Encoding]::UTF8.GetString($inBuf, 0, $n) -split "\n"
      $read = $stdin.ReadAsync($inBuf, 0, 1024)
      foreach ($c in $cmds) {
        $c = $c.Trim()
        if ($c -eq 'switch') { $pick++; $lastKey = '' }
        elseif ($current) {
          if ($c -eq 'toggle') { [void](Await ($current.TryTogglePlayPauseAsync()) ([bool])) }
          elseif ($c -eq 'next') { [void](Await ($current.TrySkipNextAsync()) ([bool])) }
          elseif ($c -eq 'prev') { [void](Await ($current.TrySkipPreviousAsync()) ([bool])) }
          elseif ($c -like 'seek *') {
            $sec = [double]::Parse($c.Substring(5), [Globalization.CultureInfo]::InvariantCulture)
            [void](Await ($current.TryChangePlaybackPositionAsync([long]($sec * 10000000))) ([bool]))
          }
        }
      }
    }
    $sessions = @($mgr.GetSessions())
    if ($sessions.Count -eq 0) {
      $current = $null; $lastKey = ''
      $out = '{"none":true}'
    } else {
      # Spotify first, then whatever else is playing
      $order = @($sessions | Sort-Object { if ($_.SourceAppUserModelId -match 'spotify') { 0 } else { 1 } })
      $current = $order[$pick % $order.Count]
      $p = Await ($current.TryGetMediaPropertiesAsync()) $PropsType
      $info = $current.GetPlaybackInfo()
      $tl = $current.GetTimelineProperties()
      $playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
      $pos = $tl.Position.TotalSeconds
      if ($playing -and $tl.LastUpdatedTime.Year -gt 2000) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
      $title = ''; $artist = ''
      if ($p) { $title = $p.Title; $artist = $p.Artist }
      $o = [ordered]@{
        app = $current.SourceAppUserModelId; title = $title; artist = $artist; playing = $playing
        pos = [math]::Round($pos, 1); len = [math]::Round($tl.EndTime.TotalSeconds, 1); count = $order.Count
      }
      $key = "$($o.app)|$title|$artist"
      if ($key -ne $artKey) { $artKey = $key; $artTries = 0 }
      if ($key -ne $lastKey) {
        # Spotify often sends the cover a while after the song name: try often at first, then every few seconds
        if ($artTries -lt 12 -or ($artTries % 8) -eq 0) {
          $o.art = ''
          if (-not $p -or -not $p.Thumbnail) {
            $artWhy = 'the app has not shared a cover for this song (yet)'
          } else {
            $artWhy = ''
            try {
              $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
              if (-not $st) { throw 'opening the cover timed out' }
              # PowerShell sees the cover as a plain COM object, so call the stream methods through
              # .NET reflection, which lets Windows hand over the right interface
              $type = 'image/jpeg'
              try { $ct = $ContentTypeProp.GetValue($st); if ($ct) { $type = $ct } } catch { }
              $bytes = $null
              # Way 1: read it as a normal .NET stream
              try {
                $ns = $AsStreamForRead.Invoke($null, @($st))
                $ms = New-Object System.IO.MemoryStream
                $ns.CopyTo($ms)
                $ns.Dispose()
                $bytes = $ms.ToArray()
              } catch { $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }; $artWhy = 'stream: ' + $e.Message }
              # Way 2: read it with a Windows DataReader
              if (-not $bytes -or $bytes.Length -eq 0) {
                $size = [uint32]$SizeProp.GetValue($st)
                $inStream = $GetInputStreamAt.Invoke($st, @([uint64]0))
                $reader = [Windows.Storage.Streams.DataReader]::new($inStream)
                [void](Await ($reader.LoadAsync($size)) ([uint32]))
                $bytes = New-Object byte[] $size
                $reader.ReadBytes($bytes)
                $reader.Dispose()
              }
              if ($bytes -and $bytes.Length -gt 0) { $o.art = "data:$type;base64," + [Convert]::ToBase64String($bytes) }
            } catch { $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }; $artWhy = $artWhy + ' / reader: ' + $e.Message }
          }
          if (-not $o.art -and $artWhy -and $artWhy -ne $lastArtWhy -and $artTries -eq 11) {
            $lastArtWhy = $artWhy
            [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json ('no album cover: ' + $artWhy)) + '}')
          }
        }
        if ($o.art) { $lastKey = $key; $artTries = 0 } else { $artTries++ }
      }
      $out = $o | ConvertTo-Json -Compress
    }
    $tick++
    if ($out -ne $lastOut -or ($tick % 5) -eq 0) {
      $lastOut = $out
      [Console]::Out.WriteLine($out)
      [Console]::Out.Flush()
    }
  } catch {
    [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}')
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 1500
  }
  Start-Sleep -Milliseconds 350
}
`;

class Media {
  constructor(onState) {
    this.onState = onState;
    this.proc = null;
    this.stopped = true;
    this.art = '';
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
        try { this.handle(JSON.parse(line)); } catch { /* partial line */ }
      }
    });
    p.stderr.on('data', (d) => {
      // PowerShell wraps its output in CLIXML; only real errors are worth showing
      const text = String(d);
      const errs = [...text.matchAll(/<S S="Error">([^<]*)<\/S>/g)].map((m) => m[1].replace(/_x000D__x000A_/g, ' ').trim()).filter(Boolean);
      if (errs.length) console.error('[media]', errs.join(' '));
      else if (!text.includes('CLIXML') && !text.includes('<Objs')) console.error('[media]', text.trim());
    });
    p.on('exit', () => {
      this.proc = null;
      if (!this.stopped) setTimeout(() => this.start(), 5000); // restart if it crashed
    });
  }
  handle(msg) {
    if (msg.error) { console.error('[media]', msg.error); return; }
    if (msg.none) { this.art = ''; this.last = { none: true }; this.onState(this.last); return; }
    if (typeof msg.art === 'string') this.art = msg.art;
    this.last = { ...msg, art: this.art, at: Date.now() };
    this.onState(this.last);
  }
  send(cmd) { if (this.proc) this.proc.stdin.write(cmd + '\n'); }
  stop() {
    this.stopped = true;
    if (this.proc) { try { this.proc.kill(); } catch { /* already gone */ } this.proc = null; }
    this.last = { none: true };
    this.onState(this.last);
  }
}

module.exports = { Media };
