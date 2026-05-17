param(
    [ValidateSet("start", "restart", "stop", "status")]
    [string]$Action = "restart",

    [string]$RuntimeRoot = "",

    [int]$Port = 9090,

    [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StateDir = Join-Path $RepoRoot "tmp\dev-stack"
$LogDir = Join-Path $StateDir "logs"
$StateFile = Join-Path $StateDir "processes.json"
$InvokeWeb = Join-Path $RepoRoot ".venv\Scripts\invokeai-web.exe"

if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $RuntimeRoot = Join-Path (Split-Path -Parent $RepoRoot) "invokeai-sub2api-poc"
}

$RuntimeRoot = (Resolve-Path $RuntimeRoot).Path
$ConfigPath = Join-Path $RuntimeRoot "invokeai.yaml"

New-Item -ItemType Directory -Force -Path $StateDir, $LogDir | Out-Null

function Write-Step {
    param([string]$Message)
    Write-Host "[invokeai-stack] $Message"
}

function Get-ProcessTreeIds {
    param([int]$RootProcessId)

    $ids = New-Object System.Collections.Generic.List[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($RootProcessId)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if (-not $ids.Contains($current)) {
            $ids.Add($current)
            Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" |
                ForEach-Object { $queue.Enqueue([int]$_.ProcessId) }
        }
    }

    return $ids.ToArray()
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    $ids = Get-ProcessTreeIds -RootProcessId $ProcessId
    [array]::Reverse($ids)
    foreach ($id in $ids) {
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Read-State {
    if (-not (Test-Path $StateFile)) {
        return @()
    }

    $state = Get-Content -Raw -Path $StateFile | ConvertFrom-Json
    if ($null -eq $state) {
        return @()
    }
    if ($state -is [array]) {
        return $state
    }
    return @($state)
}

function Save-State {
    param([array]$Processes)

    $json = if ($Processes.Count -eq 0) {
        "[]"
    }
    else {
        $Processes | ConvertTo-Json -Depth 4
    }
    Set-Content -Path $StateFile -Value $json -Encoding UTF8
}

function Get-PortProcessIds {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-PortOpen {
    param(
        [string]$HostName,
        [int]$Port
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Set-YamlScalar {
    param(
        [string[]]$Lines,
        [string]$Key,
        [string]$Value
    )

    $pattern = "^\s*$([regex]::Escape($Key))\s*:"
    $updated = $false
    $newLines = foreach ($line in $Lines) {
        if ($line -match $pattern) {
            $updated = $true
            "${Key}: $Value"
        }
        else {
            $line
        }
    }

    if (-not $updated) {
        $newLines += "${Key}: $Value"
    }

    return @($newLines)
}

function Ensure-RuntimeConfig {
    if (-not (Test-Path $RuntimeRoot)) {
        throw "InvokeAI runtime root does not exist: $RuntimeRoot"
    }
    if (-not (Test-Path $InvokeWeb)) {
        throw "invokeai-web.exe does not exist: $InvokeWeb"
    }

    if (Test-Path $ConfigPath) {
        $lines = @(Get-Content -Path $ConfigPath)
    }
    else {
        $lines = @(
            "# Internal metadata - do not edit:",
            "schema_version: 4.0.3",
            "",
            "# Put user settings here - see https://invoke.ai/configuration/invokeai-yaml/:"
        )
    }

    $lines = Set-YamlScalar -Lines $lines -Key "host" -Value "127.0.0.1"
    $lines = Set-YamlScalar -Lines $lines -Key "port" -Value ([string]$Port)
    $lines = Set-YamlScalar -Lines $lines -Key "multiuser" -Value "true"
    $lines = Set-YamlScalar -Lines $lines -Key "strict_password_checking" -Value "true"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($ConfigPath, [string[]]$lines, $utf8NoBom)
}

function Stop-ManagedProcesses {
    $state = Read-State
    foreach ($entry in $state) {
        if ($entry.PID) {
            Write-Step "Stopping $($entry.Name) pid=$($entry.PID)"
            Stop-ProcessTree -ProcessId ([int]$entry.PID)
        }
    }
    Save-State -Processes @()
}

function Stop-PortProcesses {
    foreach ($id in (Get-PortProcessIds -Port $Port)) {
        Write-Step "Stopping process on port $Port, pid=$id"
        Stop-ProcessTree -ProcessId ([int]$id)
    }
}

function Wait-PortClosed {
    $deadline = (Get-Date).AddSeconds(20)

    do {
        if ((Get-PortProcessIds -Port $Port).Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
}

function Start-InvokeAI {
    Ensure-RuntimeConfig

    $existing = Get-PortProcessIds -Port $Port
    if ($existing.Count -gt 0) {
        throw "Port $Port is already in use by pid(s): $($existing -join ', '). Use restart to replace it."
    }

    $stdout = Join-Path $LogDir "invokeai.out.log"
    $stderr = Join-Path $LogDir "invokeai.err.log"
    $command = "& '$InvokeWeb' --root '$RuntimeRoot' --config '$ConfigPath'"

    Write-Step "Starting InvokeAI on 127.0.0.1:$Port"
    $process = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru

    $entry = [pscustomobject]@{
        Name = "invokeai"
        PID = $process.Id
        Ports = @($Port)
        WorkingDirectory = $RepoRoot
        RuntimeRoot = $RuntimeRoot
        ConfigPath = $ConfigPath
        Command = $command
        Stdout = $stdout
        Stderr = $stderr
        StartedAt = (Get-Date).ToString("s")
    }
    Save-State -Processes @($entry)
}

function Wait-Port {
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    Write-Step "Waiting up to $StartupTimeoutSeconds seconds for 127.0.0.1:$Port"

    do {
        if (Test-PortOpen -HostName "127.0.0.1" -Port $Port) {
            return
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    Write-Warning "InvokeAI did not listen on 127.0.0.1:$Port within $StartupTimeoutSeconds seconds. Check logs under $LogDir."
}

function Show-Status {
    $state = Read-State
    if ($state.Count -eq 0) {
        Write-Step "No managed InvokeAI process is recorded."
    }

    foreach ($entry in $state) {
        $process = Get-Process -Id ([int]$entry.PID) -ErrorAction SilentlyContinue
        $stateText = if ($null -eq $process) { "stopped" } else { "running" }
        $portText = if (Test-PortOpen -HostName "127.0.0.1" -Port $Port) { "listening" } else { "not listening" }
        Write-Host ("{0,-12} pid={1,-8} port={2}:{3,-14} {4}" -f $entry.Name, $entry.PID, $Port, $portText, $stateText)
    }

    $portPids = Get-PortProcessIds -Port $Port
    if ($portPids.Count -gt 0) {
        foreach ($portPid in $portPids) {
            $process = Get-Process -Id ([int]$portPid) -ErrorAction SilentlyContinue
            $name = if ($process) { $process.ProcessName } else { "unknown" }
            Write-Host ("port-owner   pid={0,-8} port={1}:listening      process={2}" -f $portPid, $Port, $name)
        }
    }
    else {
        Write-Host ("port-owner   pid={0,-8} port={1}:not listening" -f "-", $Port)
    }

    Write-Step "Runtime root: $RuntimeRoot"
    Write-Step "Config:       $ConfigPath"
    Write-Step "Logs:         $LogDir"
}

switch ($Action) {
    "status" {
        Show-Status
        break
    }
    "stop" {
        Stop-ManagedProcesses
        Stop-PortProcesses
        Wait-PortClosed
        Show-Status
        break
    }
    "restart" {
        Stop-ManagedProcesses
        Stop-PortProcesses
        Wait-PortClosed
    }
}

if ($Action -in @("start", "restart")) {
    Start-InvokeAI
    Wait-Port
    Show-Status
    Write-Step "InvokeAI: http://127.0.0.1:$Port"
}
