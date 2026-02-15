$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $projectRoot 'backend'
$rootUrl = 'http://localhost:3000/'
$loginUrl = 'http://localhost:3000/login.html'

$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -First 1

if (-not $listener) {
  if (-not (Test-Path (Join-Path $backendPath 'node_modules'))) {
    Write-Host 'Installing backend dependencies...'
    Push-Location $backendPath
    npm install
    Pop-Location
  }

  Write-Host 'Starting SmartTrade backend...'
  Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$backendPath'; npm start"
  ) | Out-Null

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $rootUrl -TimeoutSec 2
      if ($resp.StatusCode -ge 200) { break }
    } catch {}
  }
}

Start-Process $loginUrl | Out-Null
Write-Host "SmartTrade opened: $loginUrl"
