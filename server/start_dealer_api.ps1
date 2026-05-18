$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".\node_modules\mysql2")) {
  npm.cmd install
}

$port = 8001
$env:PORT = "$port"

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Port $port is already in use. Existing process id(s):"
  $existing | Select-Object LocalAddress, LocalPort, State, OwningProcess
  Write-Host "Health check:"
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/dealer/health" -UseBasicParsing | Select-Object StatusCode, Content
  } catch {
    Write-Host $_.Exception.Message
  }
  exit 0
}

Write-Host "Starting Dealer API on http://127.0.0.1:$port"
Write-Host "Keep this PowerShell window open while using WeChat DevTools."
npm.cmd start
