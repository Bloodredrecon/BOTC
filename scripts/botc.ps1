<#
.SYNOPSIS
  BOTC Companion launcher. Double-click BOTC.bat for the menu.

.DESCRIPTION
  Runs the server in the background (PID in data\server.pid, output in
  data\logs\server.log) so Stop/Restart work from any launcher window.
  Settings are saved to config\local.json.

  Non-interactive use:
    BOTC.bat start | stop | restart | rebuild | status | addresses | dev | log
    BOTC.bat log [-Lines 100]      game action log (data\logs\game-*.jsonl)
    BOTC.bat log -Server           raw server output (data\logs\server.log)
    BOTC.bat set -Port 3900 -BindHost 0.0.0.0 -Pin 1234
    BOTC.bat reset-settings
  Add -Yes to auto-confirm stopping another BOTC server that holds the port.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('menu', 'start', 'stop', 'restart', 'rebuild', 'status', 'addresses', 'dev', 'log', 'set', 'reset-settings')]
  [string]$Action = 'menu',
  [int]$Port = 0,
  [string]$BindHost = '',
  [string]$Pin = '',
  [switch]$Yes,
  [switch]$Server,
  [int]$Lines = 60
)

$ErrorActionPreference = 'Stop'
# Talk to 127.0.0.1 directly even if Windows has a system proxy configured.
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$Root = Split-Path -Parent $PSScriptRoot
$DefaultConfigPath = Join-Path $Root 'config\default.json'
$LocalConfigPath = Join-Path $Root 'config\local.json'
$DataDir = Join-Path $Root 'data'
$PidFile = Join-Path $DataDir 'server.pid'
$LogDir = Join-Path $DataDir 'logs'
$LogFile = Join-Path $LogDir 'server.log'
$PrevLogFile = Join-Path $LogDir 'server.prev.log'
$ServerEntry = Join-Path $Root 'server\dist\index.js'
$AddressesEntry = Join-Path $Root 'server\dist\show-addresses.js'
$WebIndex = Join-Path $Root 'web\dist\index.html'
$Interactive = ($Action -eq 'menu')
$VirtualIfacePattern = 'vEthernet|WSL|Hyper-V|VirtualBox|VMware|VMnet|Docker|Loopback|Tailscale|ZeroTier|Hamachi|VPN|TAP-|Npcap|Bluetooth'

# ---------------------------------------------------------------- output

function Write-Info([string]$msg) { Write-Host "  $msg" }
function Write-Ok([string]$msg) { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg) { Write-Host "  $msg" -ForegroundColor Red }
function Write-Step([string]$msg) { Write-Host ''; Write-Host "> $msg" -ForegroundColor Cyan }

function Confirm-Choice([string]$prompt, [bool]$default = $false) {
  if (-not $Interactive) { return [bool]$Yes }
  $suffix = if ($default) { '[Y/n]' } else { '[y/N]' }
  $answer = (Read-Host "  $prompt $suffix").Trim().ToLower()
  if ($answer -eq '') { return $default }
  return ($answer -eq 'y' -or $answer -eq 'yes')
}

# ---------------------------------------------------------------- config

function Read-JsonFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if (-not $raw -or -not $raw.Trim()) { return $null }
    return $raw | ConvertFrom-Json
  } catch {
    Write-Warn "Could not read $path : $($_.Exception.Message)"
    return $null
  }
}

function Write-JsonFile([string]$path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 10
  # No BOM: keeps the file friendly for every JSON reader.
  [System.IO.File]::WriteAllText($path, $json + "`r`n", (New-Object System.Text.UTF8Encoding $false))
}

function ConvertTo-PortNumber($value) {
  if ($null -eq $value) { return $null }
  $n = 0
  if ([int]::TryParse(([string]$value).Trim(), [ref]$n) -and $n -ge 1 -and $n -le 65535) { return $n }
  return $null
}

# Mirrors loadConfig() in server/src/persistence.ts: env > config/local.json > config/default.json.
function Get-BotcConfig {
  $cfg = [ordered]@{
    Port = 3847; Host = '0.0.0.0'; Pin = '1234'
    PortSource = 'built-in'; HostSource = 'built-in'; PinSource = 'built-in'
    DefaultPort = 3847; DefaultHost = '0.0.0.0'; DefaultPin = '1234'
  }
  $def = Read-JsonFile $DefaultConfigPath
  if ($def) {
    $p = ConvertTo-PortNumber $def.port
    if ($p) { $cfg.Port = $p; $cfg.DefaultPort = $p; $cfg.PortSource = 'default.json' }
    if ($def.host) { $cfg.Host = [string]$def.host; $cfg.DefaultHost = $cfg.Host; $cfg.HostSource = 'default.json' }
    if ($def.storytellerPin) { $cfg.Pin = [string]$def.storytellerPin; $cfg.DefaultPin = $cfg.Pin; $cfg.PinSource = 'default.json' }
  }
  $local = Read-JsonFile $LocalConfigPath
  if ($local) {
    $p = ConvertTo-PortNumber $local.port
    if ($p) { $cfg.Port = $p; $cfg.PortSource = 'local.json' }
    if ($local.host -and ([string]$local.host).Trim()) { $cfg.Host = ([string]$local.host).Trim(); $cfg.HostSource = 'local.json' }
    if ($null -ne $local.storytellerPin -and ([string]$local.storytellerPin).Trim()) { $cfg.Pin = ([string]$local.storytellerPin).Trim(); $cfg.PinSource = 'local.json' }
  }
  $envPortName = if ($env:BOTC_PORT) { 'BOTC_PORT' } elseif ($env:PORT) { 'PORT' } else { $null }
  if ($envPortName) {
    $p = ConvertTo-PortNumber ([Environment]::GetEnvironmentVariable($envPortName))
    if ($p) { $cfg.Port = $p; $cfg.PortSource = "env $envPortName" }
  }
  $envHostName = if ($env:BOTC_HOST) { 'BOTC_HOST' } elseif ($env:HOST) { 'HOST' } else { $null }
  if ($envHostName) { $cfg.Host = ([Environment]::GetEnvironmentVariable($envHostName)).Trim(); $cfg.HostSource = "env $envHostName" }
  if ($env:BOTC_PIN) { $cfg.Pin = $env:BOTC_PIN; $cfg.PinSource = 'env BOTC_PIN' }
  return [pscustomobject]$cfg
}

function Test-DefaultPin($cfg) { return ([string]$cfg.Pin -eq '1234') }

function Set-LocalSetting([string]$key, $value, $defaultValue) {
  $obj = Read-JsonFile $LocalConfigPath
  if (-not $obj) { $obj = New-Object psobject }
  if ([string]$value -eq [string]$defaultValue) {
    # Same as default: drop the override so local.json only holds real changes.
    $obj.PSObject.Properties.Remove($key)
  } else {
    $obj | Add-Member -NotePropertyName $key -NotePropertyValue $value -Force
  }
  if (@($obj.PSObject.Properties).Count -eq 0) {
    if (Test-Path -LiteralPath $LocalConfigPath) { Remove-Item -LiteralPath $LocalConfigPath -Force }
  } else {
    Write-JsonFile $LocalConfigPath $obj
  }
}

function Get-ConnectHost([string]$bindHost) {
  if ($bindHost -eq '0.0.0.0' -or $bindHost -eq '::' -or $bindHost -eq '' -or $bindHost -eq 'localhost') { return '127.0.0.1' }
  return $bindHost
}

function Get-BrowserHost([string]$bindHost) {
  $h = Get-ConnectHost $bindHost
  if ($h -eq '127.0.0.1') { return 'localhost' }
  return $h
}

function Get-LanIPv4 {
  $primary = @(); $other = @()
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up') { continue }
    if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
    foreach ($ua in $nic.GetIPProperties().UnicastAddresses) {
      if ($ua.Address.AddressFamily -ne 'InterNetwork') { continue }
      $ip = $ua.Address.ToString()
      $entry = [pscustomobject]@{ Address = $ip; Name = $nic.Name }
      if ($ip.StartsWith('169.254.') -or "$($nic.Name) $($nic.Description)" -match $VirtualIfacePattern) { $other += $entry }
      else { $primary += $entry }
    }
  }
  $primary = @($primary | Sort-Object { if ($_.Address.StartsWith('192.168.')) { 0 } elseif ($_.Address -match '^(10\.|172\.(1[6-9]|2\d|3[01])\.)') { 1 } else { 2 } })
  return [pscustomobject]@{ Primary = $primary; Other = $other }
}

function Get-MainUrl($cfg) {
  $h = $cfg.Host
  if ($h -eq '0.0.0.0' -or $h -eq '::' -or $h -eq '') {
    $lan = Get-LanIPv4
    if ($lan.Primary.Count -gt 0) { return "http://$($lan.Primary[0].Address):$($cfg.Port)" }
    return "http://localhost:$($cfg.Port)"
  }
  return "http://$(Get-BrowserHost $h):$($cfg.Port)"
}

# ---------------------------------------------------------------- processes

function Get-ProcInfo([int]$procId) {
  return Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
}

function Test-OurServerProcess([int]$procId) {
  $p = Get-ProcInfo $procId
  if (-not $p -or $p.Name -ne 'node.exe' -or -not $p.CommandLine) { return $false }
  return $p.CommandLine.ToLower().Contains($ServerEntry.ToLower())
}

function Read-PidFile {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  try { return Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Remove-PidFile {
  if (Test-Path -LiteralPath $PidFile) { Remove-Item -LiteralPath $PidFile -Force }
}

# Running = PID file points at a live node.exe running our server\dist\index.js.
function Get-ServerState {
  $info = Read-PidFile
  if (-not $info) { return [pscustomobject]@{ Running = $false; Info = $null; Stale = $false } }
  if (Test-OurServerProcess ([int]$info.pid)) { return [pscustomobject]@{ Running = $true; Info = $info; Stale = $false } }
  return [pscustomobject]@{ Running = $false; Info = $info; Stale = $true }
}

function Get-PortOwners([int]$port) {
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return @($conns | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
  }
  $found = @()
  foreach ($line in (netstat -ano -p tcp)) {
    if ($line -match "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)") { $found += [int]$Matches[1] }
  }
  return @($found | Sort-Object -Unique)
}

function Get-BotcHealth([string]$connectHost, [int]$port) {
  try {
    $r = Invoke-RestMethod -Uri "http://${connectHost}:$port/api/health" -TimeoutSec 2 -UseBasicParsing
    if ($r.app -eq 'botc-companion' -or ($r.ok -and $r.PSObject.Properties['hueLive'])) { return $r }
  } catch { }
  return $null
}

function Wait-ProcessExit([int]$procId, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return -not (Get-Process -Id $procId -ErrorAction SilentlyContinue)
}

function Show-PortOwner([int]$ownerPid) {
  $p = Get-ProcInfo $ownerPid
  if ($p) {
    Write-Info "  PID $ownerPid  $($p.Name)"
    if ($p.CommandLine) { Write-Info "  $($p.CommandLine)" }
  } else {
    Write-Info "  PID $ownerPid (process details unavailable)"
  }
}

# True when the port is free (or was freed after stopping a stray BOTC server).
function Confirm-PortFree($cfg) {
  $owners = @(Get-PortOwners $cfg.Port)
  if ($owners.Count -eq 0) { return $true }

  Write-Warn "Port $($cfg.Port) is already in use by:"
  foreach ($o in $owners) { Show-PortOwner $o }

  $health = Get-BotcHealth '127.0.0.1' $cfg.Port
  if (-not $health -and (Get-ConnectHost $cfg.Host) -ne '127.0.0.1') { $health = Get-BotcHealth (Get-ConnectHost $cfg.Host) $cfg.Port }
  $nodeOwners = @($owners | Where-Object { $p = Get-ProcInfo $_; $p -and $p.Name -eq 'node.exe' })
  if (-not $health -or $nodeOwners.Count -eq 0) {
    Write-Err "That is not a BOTC server, so the launcher will not touch it."
    Write-Info "Close that program, or choose another port (Settings > Port)."
    return $false
  }

  Write-Warn "It is a BOTC server that this launcher did not start (e.g. dev mode or 'npm start')."
  if (-not (Confirm-Choice "Stop it so this one can start?" $false)) {
    Write-Info "Left it running. Stop it yourself or choose another port (Settings > Port)."
    return $false
  }
  foreach ($o in $nodeOwners) {
    Stop-Process -Id $o -Force -ErrorAction SilentlyContinue
    [void](Wait-ProcessExit $o 5)
  }
  Start-Sleep -Milliseconds 500
  if (@(Get-PortOwners $cfg.Port).Count -gt 0) {
    Write-Err "Port $($cfg.Port) is still in use."
    return $false
  }
  Write-Ok "Stopped the other BOTC server."
  return $true
}

# ---------------------------------------------------------------- node / build

function Get-NodePath {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Err "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org and try again."
    return $null
  }
  $ver = (& $node.Source -v) -replace '^v', ''
  if ([int]($ver.Split('.')[0]) -lt 20) {
    Write-Err "Node.js $ver is too old; BOTC needs Node.js 20 or newer (https://nodejs.org)."
    return $null
  }
  return $node.Source
}

# Runs a console program attached to this window (keeps colours/Unicode, and its
# output is not captured as a PowerShell function return value). Returns exit code.
function Invoke-Console([string]$file, [string]$arguments) {
  $p = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $Root -NoNewWindow -Wait -PassThru
  return $p.ExitCode
}

function Invoke-Npm([string[]]$npmArgs) {
  Write-Info "npm $($npmArgs -join ' ')"
  return ((Invoke-Console $env:ComSpec "/d /c npm $($npmArgs -join ' ')") -eq 0)
}

function Confirm-Dependencies {
  $marker = Join-Path $Root 'node_modules\.package-lock.json'
  $lock = Join-Path $Root 'package-lock.json'
  $needed = -not (Test-Path $marker) -or -not (Test-Path (Join-Path $Root 'node_modules\qrcode-terminal'))
  if (-not $needed -and (Test-Path $lock)) {
    $needed = (Get-Item $lock).LastWriteTimeUtc -gt (Get-Item $marker).LastWriteTimeUtc
  }
  if (-not $needed) { return $true }
  Write-Step 'Installing dependencies (first run or package-lock.json changed)...'
  if (-not (Invoke-Npm @('install'))) { Write-Err 'npm install failed (see output above).'; return $false }
  if (Test-Path $marker) { (Get-Item $marker).LastWriteTime = Get-Date }
  return $true
}

function Get-NewestWriteTime([string[]]$paths) {
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $item = Get-Item -LiteralPath $p
    if ($item.PSIsContainer) {
      $item = Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    }
    if ($item -and $item.LastWriteTimeUtc -gt $newest) { $newest = $item.LastWriteTimeUtc }
  }
  return $newest
}

function Test-BuildStale([string]$output, [string[]]$sources) {
  if (-not (Test-Path -LiteralPath $output)) { return $true }
  return (Get-NewestWriteTime $sources) -gt (Get-Item -LiteralPath $output).LastWriteTimeUtc
}

function Confirm-Build([bool]$force) {
  $web = @('web\src', 'web\public', 'web\index.html', 'web\vite.config.ts', 'web\package.json', 'web\tsconfig.json') | ForEach-Object { Join-Path $Root $_ }
  $server = @('server\src', 'server\package.json', 'server\tsconfig.json') | ForEach-Object { Join-Path $Root $_ }
  $buildWeb = $force -or (Test-BuildStale $WebIndex $web)
  $buildServer = $force -or (Test-BuildStale $ServerEntry $server) -or -not (Test-Path $AddressesEntry)
  if ($buildWeb) {
    Write-Step 'Building the web UI (can take a minute)...'
    if (-not (Invoke-Npm @('run', 'build', '-w', 'web'))) { Write-Err 'Web build failed (see output above).'; return $false }
  }
  if ($buildServer) {
    Write-Step 'Building the server...'
    if (-not (Invoke-Npm @('run', 'build', '-w', 'server'))) { Write-Err 'Server build failed (see output above).'; return $false }
  }
  if (-not $buildWeb -and -not $buildServer) { Write-Info 'Build is up to date.' }
  return $true
}

# ---------------------------------------------------------------- actions

function Show-LogTail([int]$lines = 40) {
  if (-not (Test-Path -LiteralPath $LogFile)) { Write-Info 'No log file yet.'; return }
  Write-Host "  ----- last $lines lines of $LogFile -----" -ForegroundColor DarkGray
  Get-Content -LiteralPath $LogFile -Tail $lines -Encoding UTF8 | ForEach-Object { Write-Host $_ }
  Write-Host '  -----' -ForegroundColor DarkGray
}

$GameLogDir = if ($env:BOTC_LOG_DIR) { $env:BOTC_LOG_DIR } else { $LogDir }

function Get-GameLogFiles {
  if (-not (Test-Path -LiteralPath $GameLogDir)) { return @() }
  # Sort by write time: name order puts game-<date>-2.jsonl before game-<date>.jsonl.
  return @(Get-ChildItem -LiteralPath $GameLogDir -Filter 'game-*.jsonl' -File | Sort-Object LastWriteTimeUtc)
}

function Show-GameLog([int]$lines = 60) {
  $files = Get-GameLogFiles
  if ($files.Count -eq 0) { Write-Info 'No game log yet (it starts with the first Storyteller action).'; return }
  $tail = New-Object System.Collections.Generic.List[string]
  for ($i = $files.Count - 1; $i -ge 0 -and $tail.Count -lt $lines; $i--) {
    $chunk = @(Get-Content -LiteralPath $files[$i].FullName -Tail ($lines - $tail.Count) -Encoding UTF8)
    $tail.InsertRange(0, [string[]]$chunk)
  }
  Write-Host "  ----- last $($tail.Count) game log entries ($GameLogDir\game-*.jsonl) -----" -ForegroundColor DarkGray
  foreach ($line in $tail) {
    if (-not $line.Trim()) { continue }
    try { $e = $line | ConvertFrom-Json } catch { Write-Host $line; continue }
    $color = switch ($e.outcome) { 'rejected' { 'Red' } 'error' { 'Red' } 'no-change' { 'Yellow' } default { if ($e.kind -eq 'system' -or $e.kind -eq 'connection') { 'DarkGray' } else { 'Gray' } } }
    Write-Host "  $($e.text)" -ForegroundColor $color
  }
  Write-Host '  -----' -ForegroundColor DarkGray
}

function Show-Addresses {
  $node = Get-NodePath
  if (-not $node) { return $false }
  if (Test-Path $AddressesEntry) {
    [void](Invoke-Console $node "`"$AddressesEntry`"")
  } else {
    $tsx = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
    if (-not (Test-Path $tsx)) { Write-Err 'Run Start once first (dependencies are not installed yet).'; return $false }
    [void](Invoke-Console $node ("`"{0}`" `"{1}`"" -f $tsx, (Join-Path $Root 'server\src\show-addresses.ts')))
  }
  $state = Get-ServerState
  $cfg = Get-BotcConfig
  if (-not $state.Running) {
    Write-Warn 'The server is not running right now; start it before joining.'
  } elseif ([int]$state.Info.port -ne $cfg.Port -or [string]$state.Info.host -ne $cfg.Host) {
    Write-Warn "The running server still uses host $($state.Info.host) port $($state.Info.port). Restart to apply your new settings."
  }
  return $true
}

function Start-BotcServer([bool]$forceBuild = $false) {
  $node = Get-NodePath
  if (-not $node) { return $false }

  $state = Get-ServerState
  if ($state.Running) {
    Write-Ok "The BOTC server is already running (PID $($state.Info.pid), port $($state.Info.port))."
    if ($forceBuild) { Write-Info 'Use Restart or Rebuild from the menu to rebuild it.' }
    return $true
  }
  if ($state.Stale) { Remove-PidFile }

  $cfg = Get-BotcConfig
  Write-Step "Starting BOTC server on host $($cfg.Host), port $($cfg.Port)..."
  if (-not (Confirm-PortFree $cfg)) { return $false }
  if (-not (Confirm-Dependencies)) { return $false }
  if (-not (Confirm-Build $forceBuild)) { return $false }

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  if (Test-Path -LiteralPath $LogFile) {
    try { Move-Item -LiteralPath $LogFile -Destination $PrevLogFile -Force } catch { Write-Warn "Could not rotate the old log: $($_.Exception.Message)" }
  }

  $token = [guid]::NewGuid().ToString('N')
  $cmdArgs = '/d /s /c ""{0}" "{1}" > "{2}" 2>&1"' -f $node, $ServerEntry, $LogFile
  $env:BOTC_CONTROL_TOKEN = $token
  try {
    $wrapper = Start-Process -FilePath $env:ComSpec -ArgumentList $cmdArgs -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  } finally {
    Remove-Item Env:BOTC_CONTROL_TOKEN -ErrorAction SilentlyContinue
  }

  $nodeProc = $null
  $deadline = (Get-Date).AddSeconds(10)
  while (-not $nodeProc -and (Get-Date) -lt $deadline) {
    $nodeProc = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wrapper.Id) AND Name='node.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nodeProc) {
      if ($wrapper.HasExited) { break }
      Start-Sleep -Milliseconds 200
    }
  }
  if (-not $nodeProc) {
    Write-Err 'The server process did not start.'
    Show-LogTail 30
    return $false
  }
  $serverPid = [int]$nodeProc.ProcessId

  Write-JsonFile $PidFile ([pscustomobject]@{
      pid = $serverPid; wrapperPid = $wrapper.Id; port = $cfg.Port; host = $cfg.Host
      token = $token; startedAt = (Get-Date).ToString('o'); log = $LogFile
    })

  $connectHost = Get-ConnectHost $cfg.Host
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) {
      Remove-PidFile
      Write-Err 'The server stopped during startup. Log:'
      Show-LogTail 30
      return $false
    }
    $health = Get-BotcHealth $connectHost $cfg.Port
    if ($health -and [int]$health.pid -eq $serverPid) {
      Write-Ok "BOTC server started (PID $serverPid). It keeps running after you close this window."
      Write-Info "Log: $LogFile"
      [void](Show-Addresses)
      return $true
    }
    Start-Sleep -Milliseconds 400
  }
  Write-Warn "Server process $serverPid is running but did not answer on http://${connectHost}:$($cfg.Port) within 30s. Log:"
  Show-LogTail 30
  return $false
}

function Stop-StrayBotcServer {
  $cfg = Get-BotcConfig
  $owners = @(Get-PortOwners $cfg.Port)
  if ($owners.Count -eq 0) { return $true }
  $health = Get-BotcHealth (Get-ConnectHost $cfg.Host) $cfg.Port
  if (-not $health) { return $true }
  Write-Warn "A BOTC server not started by this launcher is listening on port $($cfg.Port):"
  foreach ($o in $owners) { Show-PortOwner $o }
  if (-not (Confirm-Choice 'Stop it?' $false)) { return $true }
  foreach ($o in $owners) {
    $p = Get-ProcInfo $o
    if ($p -and $p.Name -eq 'node.exe') {
      Stop-Process -Id $o -Force -ErrorAction SilentlyContinue
      [void](Wait-ProcessExit $o 5)
    }
  }
  if (@(Get-PortOwners $cfg.Port).Count -gt 0) { Write-Err 'It is still running.'; return $false }
  Write-Ok 'Stopped.'
  return $true
}

function Stop-BotcServer {
  $state = Get-ServerState
  if ($state.Stale) {
    Remove-PidFile
    Write-Info "The server recorded in data\server.pid (PID $($state.Info.pid)) is no longer running; cleared the PID file."
  }
  if (-not $state.Running) {
    Write-Info 'No BOTC server started by the launcher is running.'
    return (Stop-StrayBotcServer)
  }

  $info = $state.Info
  $serverPid = [int]$info.pid
  Write-Step "Stopping BOTC server (PID $serverPid)..."
  $connectHost = Get-ConnectHost ([string]$info.host)
  try {
    Invoke-RestMethod -Method Post -Uri "http://${connectHost}:$($info.port)/api/control/shutdown" `
      -Headers @{ 'x-botc-control-token' = [string]$info.token } -ContentType 'application/json' -Body '{}' `
      -TimeoutSec 3 -UseBasicParsing | Out-Null
  } catch {
    Write-Warn "Clean shutdown request failed ($($_.Exception.Message)); will force-stop."
  }
  if (Wait-ProcessExit $serverPid 8) {
    Write-Ok 'Server stopped cleanly.'
  } else {
    # Game state is saved on every change, so a forced stop loses nothing.
    if (Test-OurServerProcess $serverPid) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
    if (Wait-ProcessExit $serverPid 5) { Write-Ok 'Server force-stopped.' }
    else { Write-Err "Could not stop PID $serverPid."; return $false }
  }
  if ($info.wrapperPid) {
    $w = Get-ProcInfo ([int]$info.wrapperPid)
    if ($w -and $w.Name -eq 'cmd.exe' -and $w.CommandLine -and $w.CommandLine.ToLower().Contains($ServerEntry.ToLower())) {
      Stop-Process -Id ([int]$info.wrapperPid) -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-PidFile
  return $true
}

function Show-Status {
  $state = Get-ServerState
  $cfg = Get-BotcConfig
  if ($state.Running) {
    $info = $state.Info
    $started = [datetime]::Parse([string]$info.startedAt)
    $up = (Get-Date) - $started
    $health = Get-BotcHealth (Get-ConnectHost ([string]$info.host)) ([int]$info.port)
    Write-Ok ("Server: RUNNING  PID {0}, host {1}, port {2}, up {3:%d}d {3:hh}h {3:mm}m" -f $info.pid, $info.host, $info.port, $up)
    if ($health) { Write-Info 'Health check: OK' } else { Write-Warn 'Health check: not answering' }
  } else {
    Write-Info 'Server: STOPPED'
    if ($state.Stale) { Write-Info "(stale PID file for PID $($state.Info.pid) - will be cleared on next start/stop)" }
  }
  Write-Info ("Settings: port {0} ({1}), host {2} ({3}), PIN {4} ({5})" -f $cfg.Port, $cfg.PortSource, $cfg.Host, $cfg.HostSource, $cfg.Pin, $cfg.PinSource)
  if (Test-DefaultPin $cfg) { Write-Warn "The Storyteller PIN is still the default ($($cfg.Pin)); anyone on the network could open the grimoire. Change it: BOTC.bat set -Pin <4-12 digits>" }
  return $true
}

function Open-Page([string]$path) {
  $state = Get-ServerState
  $cfg = Get-BotcConfig
  $h = $cfg.Host; $p = $cfg.Port
  if ($state.Running) { $h = [string]$state.Info.host; $p = [int]$state.Info.port }
  else { Write-Warn 'The server is not running; the page will not load until you start it.' }
  $url = "http://$(Get-BrowserHost $h):$p$path"
  Write-Info "Opening $url"
  Start-Process $url
}

function Start-DevMode {
  $node = Get-NodePath
  if (-not $node) { return $false }
  $state = Get-ServerState
  if ($state.Running) {
    Write-Warn "The background server is running on port $($state.Info.port); dev mode needs that port."
    if (-not (Confirm-Choice 'Stop the background server first?' $true)) { return $false }
    if (-not (Stop-BotcServer)) { return $false }
  }
  $cfg = Get-BotcConfig
  if (-not (Confirm-PortFree $cfg)) { return $false }
  if (-not (Confirm-Dependencies)) { return $false }
  Start-Process -FilePath $env:ComSpec -ArgumentList '/d /s /k "title BOTC dev mode - close this window to stop && npm run dev"' -WorkingDirectory $Root
  Write-Ok 'Dev mode opened in a new window (hot reload). Close that window to stop it.'
  $lan = Get-LanIPv4
  $ip = if ($lan.Primary.Count -gt 0) { $lan.Primary[0].Address } else { 'localhost' }
  Write-Info "TV:          http://${ip}:5173/tv"
  Write-Info "Storyteller: http://${ip}:5173/storyteller   (API on port $($cfg.Port))"
  return $true
}

# ---------------------------------------------------------------- settings

function Test-PinValue([string]$value) { return $value -match '^\d{4,12}$' }

function Test-HostValue([string]$value) {
  if ($value -eq '0.0.0.0' -or $value -eq 'localhost') { return $true }
  $ip = $null
  return ([System.Net.IPAddress]::TryParse($value, [ref]$ip) -and $ip.AddressFamily -eq 'InterNetwork' -and $value -match '^\d+\.\d+\.\d+\.\d+$')
}

function Show-EnvOverrideWarning($cfg) {
  foreach ($pair in @(@('Port', $cfg.PortSource), @('Host', $cfg.HostSource), @('PIN', $cfg.PinSource))) {
    if ($pair[1] -like 'env *') {
      Write-Warn "$($pair[0]) is forced by environment variable $($pair[1].Substring(4)); config\local.json is ignored for it."
    }
  }
}

function Invoke-SetAction {
  $cfg = Get-BotcConfig
  $changed = $false
  if ($Port -ne 0) {
    if (-not (ConvertTo-PortNumber $Port)) { Write-Err "Invalid port $Port (1-65535)."; return $false }
    Set-LocalSetting 'port' $Port $cfg.DefaultPort; $changed = $true
  }
  if ($BindHost) {
    if (-not (Test-HostValue $BindHost)) { Write-Err "Invalid host '$BindHost' (use 0.0.0.0, 127.0.0.1 or an IPv4 address of this PC)."; return $false }
    Set-LocalSetting 'host' $BindHost $cfg.DefaultHost; $changed = $true
  }
  if ($Pin) {
    if (-not (Test-PinValue $Pin)) { Write-Err 'PIN must be 4-12 digits.'; return $false }
    Set-LocalSetting 'storytellerPin' $Pin $cfg.DefaultPin; $changed = $true
  }
  if (-not $changed) { Write-Err 'Nothing to set. Use -Port, -BindHost and/or -Pin.'; return $false }
  $cfg = Get-BotcConfig
  Write-Ok ("Saved. Port {0} ({1}), host {2} ({3}), PIN {4} ({5})" -f $cfg.Port, $cfg.PortSource, $cfg.Host, $cfg.HostSource, $cfg.Pin, $cfg.PinSource)
  Show-EnvOverrideWarning $cfg
  if ((Get-ServerState).Running) { Write-Warn 'Restart the server to apply.' }
  return $true
}

function Reset-Settings {
  $obj = Read-JsonFile $LocalConfigPath
  if ($obj) {
    foreach ($k in @('port', 'host', 'storytellerPin')) { $obj.PSObject.Properties.Remove($k) }
    if (@($obj.PSObject.Properties).Count -eq 0) { Remove-Item -LiteralPath $LocalConfigPath -Force }
    else { Write-JsonFile $LocalConfigPath $obj }
  } elseif (Test-Path -LiteralPath $LocalConfigPath) {
    Remove-Item -LiteralPath $LocalConfigPath -Force
  }
  Write-Ok 'Port, host and PIN reset to defaults.'
  return $true
}

function Read-PortSetting($cfg) {
  $raw = (Read-Host "  New port (1024-65535, Enter = keep $($cfg.Port))").Trim()
  if (-not $raw) { return }
  $p = ConvertTo-PortNumber $raw
  if (-not $p) { Write-Err 'Not a valid port number.'; return }
  if ($p -lt 1024) { Write-Warn 'Ports below 1024 may need admin rights.' }
  $state = Get-ServerState
  $ours = $state.Running -and [int]$state.Info.port -eq $p
  if (-not $ours -and @(Get-PortOwners $p).Count -gt 0) {
    Write-Warn "Port $p is in use right now:"
    foreach ($o in (Get-PortOwners $p)) { Show-PortOwner $o }
    if (-not (Confirm-Choice 'Save it anyway?' $false)) { return }
  }
  Set-LocalSetting 'port' $p $cfg.DefaultPort
  Write-Ok "Port set to $p."
}

function Read-HostSetting($cfg) {
  $lan = Get-LanIPv4
  $choices = @(
    [pscustomobject]@{ Value = '0.0.0.0'; Label = 'All networks (recommended: TV and phones can join)' },
    [pscustomobject]@{ Value = '127.0.0.1'; Label = 'This PC only (nobody else can join)' }
  )
  foreach ($a in @($lan.Primary) + @($lan.Other)) {
    $choices += [pscustomobject]@{ Value = $a.Address; Label = "Only on $($a.Name)" }
  }
  Write-Info "Current host: $($cfg.Host)"
  for ($i = 0; $i -lt $choices.Count; $i++) {
    Write-Info ("  {0}) {1,-16} {2}" -f ($i + 1), $choices[$i].Value, $choices[$i].Label)
  }
  $raw = (Read-Host '  Choose a number, type an IPv4 address, or Enter to keep').Trim()
  if (-not $raw) { return }
  $n = 0
  if ([int]::TryParse($raw, [ref]$n) -and $n -ge 1 -and $n -le $choices.Count) { $value = $choices[$n - 1].Value }
  else { $value = $raw }
  if (-not (Test-HostValue $value)) { Write-Err 'Not a valid IPv4 address.'; return }
  $known = @('0.0.0.0', '127.0.0.1', 'localhost') + @($choices | ForEach-Object { $_.Value })
  if ($known -notcontains $value) {
    Write-Warn "$value is not an address of this PC right now; the server will fail to start with it."
    if (-not (Confirm-Choice 'Save it anyway?' $false)) { return }
  }
  Set-LocalSetting 'host' $value $cfg.DefaultHost
  Write-Ok "Host set to $value."
}

function Read-PinSetting($cfg) {
  $raw = (Read-Host "  New Storyteller PIN (4-12 digits, Enter = keep $($cfg.Pin))").Trim()
  if (-not $raw) { return }
  if (-not (Test-PinValue $raw)) { Write-Err 'PIN must be 4-12 digits (the phone shows a number pad).'; return }
  Set-LocalSetting 'storytellerPin' $raw $cfg.DefaultPin
  Write-Ok 'PIN updated. Phones that saved the old PIN will be asked for the new one.'
}

function Show-SettingsMenu {
  while ($true) {
    $cfg = Get-BotcConfig
    Write-Host ''
    Write-Host '  Settings  (saved in config\local.json - restart the server to apply)' -ForegroundColor Cyan
    Write-Info ("1) Port             {0,-16} [{1}]" -f $cfg.Port, $cfg.PortSource)
    Write-Info ("2) Host (bind)      {0,-16} [{1}]" -f $cfg.Host, $cfg.HostSource)
    Write-Info ("3) Storyteller PIN  {0,-16} [{1}]" -f $cfg.Pin, $cfg.PinSource)
    Write-Info '4) Reset all three to defaults'
    Write-Info 'B) Back'
    Show-EnvOverrideWarning $cfg
    $choice = (Read-Host '  Choose').Trim().ToLower()
    switch ($choice) {
      '1' { Read-PortSetting $cfg }
      '2' { Read-HostSetting $cfg }
      '3' { Read-PinSetting $cfg }
      '4' { if (Confirm-Choice 'Reset port, host and PIN to defaults?' $false) { [void](Reset-Settings) } }
      'b' { break }
      '' { break }
      default { Write-Warn 'Unknown choice.' }
    }
    if ($choice -eq 'b' -or $choice -eq '') { break }
    $state = Get-ServerState
    $new = Get-BotcConfig
    if ($state.Running -and ([int]$state.Info.port -ne $new.Port -or [string]$state.Info.host -ne $new.Host -or $new.Pin -ne $cfg.Pin)) {
      if (Confirm-Choice 'Restart the server now to apply?' $true) {
        if (Stop-BotcServer) { [void](Start-BotcServer $false) }
      }
    }
  }
}

# ---------------------------------------------------------------- menu

function Show-Header {
  Clear-Host
  $state = Get-ServerState
  $cfg = Get-BotcConfig
  Write-Host ''
  Write-Host '  ==========================================================' -ForegroundColor DarkYellow
  Write-Host '     BOTC Companion - Launcher' -ForegroundColor Yellow
  Write-Host '  ==========================================================' -ForegroundColor DarkYellow
  if ($state.Running) {
    $runCfg = [pscustomobject]@{ Host = [string]$state.Info.host; Port = [int]$state.Info.port }
    $url = Get-MainUrl $runCfg
    Write-Host ("   Server:  RUNNING  (PID {0}, port {1})" -f $state.Info.pid, $state.Info.port) -ForegroundColor Green
    Write-Host "   TV:          $url/tv"
    Write-Host "   Storyteller: $url/storyteller   PIN $($cfg.Pin)"
  } else {
    Write-Host '   Server:  STOPPED' -ForegroundColor DarkGray
  }
  Write-Host ("   Settings: port {0} | host {1} | PIN {2}" -f $cfg.Port, $cfg.Host, $cfg.Pin) -ForegroundColor DarkGray
  if (Test-DefaultPin $cfg) {
    Write-Host "   WARNING: Storyteller PIN is still the default ($($cfg.Pin)). Change it: 9) Settings > 3) PIN" -ForegroundColor Yellow
  }
  Write-Host ''
}

function Show-MainMenu {
  while ($true) {
    Show-Header
    Write-Info '1) Start server'
    Write-Info '2) Stop server'
    Write-Info '3) Restart server'
    Write-Info '4) Rebuild and start (after updating the app)'
    Write-Info '5) Show join addresses + QR code'
    Write-Info '6) Open TV page in browser'
    Write-Info '7) Open Storyteller page in browser'
    Write-Info '8) View game log / server log'
    Write-Info '9) Settings (port, host, PIN)'
    Write-Info 'D) Dev mode (hot reload, for developers)'
    Write-Info 'Q) Quit'
    Write-Host ''
    $choice = (Read-Host '  Choose').Trim().ToLower()
    $pause = $true
    try {
      switch ($choice) {
        '1' { [void](Start-BotcServer $false) }
        '2' { [void](Stop-BotcServer) }
        '3' { if (Stop-BotcServer) { [void](Start-BotcServer $false) } }
        '4' { if (Stop-BotcServer) { [void](Start-BotcServer $true) } }
        '5' { [void](Show-Addresses) }
        '6' { Open-Page '/tv' }
        '7' { Open-Page '/storyteller' }
        '8' {
          $which = (Read-Host '  G) game log (what happened in the game)  S) server log (technical)  [G/s]').Trim().ToLower()
          if ($which -eq 's') {
            Show-LogTail 60
            if ((Test-Path -LiteralPath $LogFile) -and (Confirm-Choice 'Open the full server log in Notepad?' $false)) { Start-Process notepad.exe -ArgumentList "`"$LogFile`"" }
          } else {
            Show-GameLog 60
            $latest = @(Get-GameLogFiles) | Select-Object -Last 1
            if ($latest -and (Confirm-Choice 'Open the latest game log file in Notepad?' $false)) { Start-Process notepad.exe -ArgumentList "`"$($latest.FullName)`"" }
          }
        }
        '9' { Show-SettingsMenu; $pause = $false }
        'd' { [void](Start-DevMode) }
        'q' {
          if ((Get-ServerState).Running) {
            Write-Info 'The server keeps running in the background after this window closes.'
            if (Confirm-Choice 'Stop the server before quitting?' $false) { [void](Stop-BotcServer) }
          }
          return
        }
        default { Write-Warn 'Unknown choice.' }
      }
    } catch {
      Write-Err "Error: $($_.Exception.Message)"
    }
    if ($pause) {
      Write-Host ''
      [void](Read-Host '  Press Enter to return to the menu')
    }
  }
}

# ---------------------------------------------------------------- entry

$ok = $true
switch ($Action) {
  'menu' { Show-MainMenu }
  'start' { $ok = Start-BotcServer $false }
  'stop' { $ok = Stop-BotcServer }
  'restart' { $ok = (Stop-BotcServer) -and (Start-BotcServer $false) }
  'rebuild' { $ok = (Stop-BotcServer) -and (Start-BotcServer $true) }
  'status' { $ok = Show-Status }
  'addresses' { $ok = Show-Addresses }
  'dev' { $ok = Start-DevMode }
  'log' { if ($Server) { Show-LogTail $Lines } else { Show-GameLog $Lines } }
  'set' { $ok = Invoke-SetAction }
  'reset-settings' { $ok = Reset-Settings }
}
if (-not $ok) { exit 1 }
exit 0
