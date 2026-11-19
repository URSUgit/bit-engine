param([switch]$Research, [switch]$NoBrowser, [switch]$LegacyResearch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps\web'
$api = Join-Path $root 'apps\signal-service'
$next = Join-Path $web 'node_modules\next\dist\bin\next'
$url = 'http://127.0.0.1:3000'
$apiUrl = 'http://127.0.0.1:8001'
$logs = Join-Path $env:LOCALAPPDATA 'BitEngine\logs'
$release = Join-Path $env:LOCALAPPDATA 'BitEngine\research'
$stopFile = Join-Path $release 'stop.request'
$children = @()
$mutex = New-Object System.Threading.Mutex($false, 'Local\BitEngineLauncher')
$locked = $false
$failed = $false

function Test-Ready($address) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $address -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch { return $false }
}

try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) {
        if ((Test-Ready "$apiUrl/health") -and (Test-Ready "$url/lab/backtester")) {
            if (-not $NoBrowser) { Start-Process "$url/lab/backtester" }
        } else {
            Write-Host 'Bit Engine is already starting. Check the first launcher window.'
        }
        return
    }

    if (Get-NetTCPConnection -State Listen -LocalPort 3000,8001 -ErrorAction SilentlyContinue) {
        throw 'Port 3000 or 8001 is already in use. Close its existing app and retry; no processes were stopped.'
    }
    if (-not (Test-Path -LiteralPath $next -PathType Leaf)) {
        throw 'The web dependencies are missing from this checkout. Run pnpm install in the Bit Engine folder first.'
    }
    $py = (Get-Command py.exe -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $env:SIGNAL_SERVICE_URL = $apiUrl
    $env:NEXT_PUBLIC_SIGNAL_SERVICE_URL = $apiUrl
    $env:NEXT_PUBLIC_BITENGINE_RESEARCH = '0'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:PYTHONUNBUFFERED = '1'
    $entryPoint = 'main:app'
    $webMode = 'dev'
    if ($Research) {
        $webBuild = '.next-research\BUILD_ID'
        $env:BACKTEST_DUCKDB_PATH = Join-Path $release 'bars.duckdb'
        $env:BITENGINE_ARCHIVE_COVERAGE = Join-Path $release 'coverage.json'
        $env:BACKTEST_DB_PATH = Join-Path $release 'runs.sqlite'
        $env:PAPER_DB_PATH = Join-Path $release 'paper.sqlite'
        if (-not (Test-Path -LiteralPath $env:BACKTEST_DUCKDB_PATH -PathType Leaf) -or -not (Test-Path -LiteralPath $env:BITENGINE_ARCHIVE_COVERAGE -PathType Leaf)) { throw 'The verified research archive is not installed.' }
        $env:NEXT_PUBLIC_SIGNAL_SERVICE_URL = ''
        $env:NEXT_PUBLIC_BITENGINE_RESEARCH = '1'
        if ($LegacyResearch) {
            $env:NEXT_PUBLIC_BITENGINE_RESEARCH = '0'
            $webBuild = '.next\BUILD_ID'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $web $webBuild) -PathType Leaf)) { throw 'The requested production research build is missing.' }
        $entryPoint = 'research:app'
        $webMode = 'start'
        Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
    }
    Write-Host 'Starting the local Bit Engine app...'
    $children += Start-Process -FilePath $py -ArgumentList "-3.11 -m uvicorn $entryPoint --host 127.0.0.1 --port 8001" -WorkingDirectory $api -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\api.log" -RedirectStandardError "$logs\api-error.log"
    $children += Start-Process -FilePath $node -ArgumentList ('"{0}" {1} --hostname 127.0.0.1 --port 3000' -f $next,$webMode) -WorkingDirectory $web -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\web.log" -RedirectStandardError "$logs\web-error.log"

    $deadline = (Get-Date).AddSeconds(120)
    $ready = $false
    do {
        foreach ($child in $children) {
            if ($child.HasExited) { throw "A Bit Engine service exited early. Logs: $logs" }
        }
        $ready = (Test-Ready "$apiUrl/health") -and (Test-Ready "$url/lab/backtester")
        if (-not $ready) { Start-Sleep -Milliseconds 750 }
    } until ($ready -or (Get-Date) -ge $deadline)
    if (-not $ready) { throw "Bit Engine did not become ready within 120 seconds. Logs: $logs" }

    if (-not $NoBrowser) { Start-Process "$url/lab/backtester" }
    Write-Host "Bit Engine is ready: $url/lab/backtester"
    if ($Research -and $NoBrowser) {
        while (-not (Test-Path -LiteralPath $stopFile)) {
            foreach ($child in $children) {
                if ($child.HasExited) { throw "A Bit Engine service stopped. Logs: $logs" }
            }
            Start-Sleep -Seconds 2
        }
        Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
    } else {
        [void](Read-Host 'Press Enter here to stop Bit Engine')
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $failed = $true
} finally {
    foreach ($child in $children) {
        if (-not $child.HasExited) {
            & "$env:SystemRoot\System32\taskkill.exe" /PID $child.Id /T /F | Out-Null
        }
    }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
if ($failed) { exit 1 }
