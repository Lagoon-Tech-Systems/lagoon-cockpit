# Lagoon Cockpit Windows Agent — Deployment Script
# Run this on the Windows VPS as Administrator

$ErrorActionPreference = "Stop"
$AGENT_DIR = "C:\lagoon\cockpit-agent"

Write-Host "=== Lagoon Cockpit Windows Agent Deployment ===" -ForegroundColor Cyan
Write-Host ""

# Create directory
if (!(Test-Path $AGENT_DIR)) {
    New-Item -ItemType Directory -Path $AGENT_DIR -Force | Out-Null
    Write-Host "Created $AGENT_DIR" -ForegroundColor Green
}

# Copy files (assumes this script is run from the agent source directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item "$scriptDir\*" -Destination $AGENT_DIR -Recurse -Force -Exclude @("__pycache__", "*.pyc", "venv", ".env")
Write-Host "Copied agent files to $AGENT_DIR" -ForegroundColor Green

# Create .env if not exists
if (!(Test-Path "$AGENT_DIR\.env")) {
    Copy-Item "$AGENT_DIR\.env.example" "$AGENT_DIR\.env"
    Write-Host ""
    Write-Host "IMPORTANT: Edit $AGENT_DIR\.env with your API_KEY and JWT_SECRET" -ForegroundColor Yellow
    Write-Host ""
}

# Install dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
Push-Location $AGENT_DIR
& "C:\Program Files\Python312\python.exe" -m pip install -r requirements.txt --quiet
Pop-Location
Write-Host "Dependencies installed" -ForegroundColor Green

# Stop existing service if running
$svc = Get-Service -Name "LagoonCockpitAgent" -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq "Running") {
        Write-Host "Stopping existing service..." -ForegroundColor Yellow
        Stop-Service "LagoonCockpitAgent" -Force
        Start-Sleep -Seconds 2
    }
    Write-Host "Removing existing service..." -ForegroundColor Yellow
    & "C:\Program Files\Python312\python.exe" "$AGENT_DIR\service_wrapper.py" remove
    Start-Sleep -Seconds 2
}

# Install and start service
Write-Host "Installing Windows Service..." -ForegroundColor Cyan
& "C:\Program Files\Python312\python.exe" "$AGENT_DIR\service_wrapper.py" install
Start-Sleep -Seconds 1

Write-Host "Starting service..." -ForegroundColor Cyan
Start-Service "LagoonCockpitAgent"
Start-Sleep -Seconds 3

# Verify
$svc = Get-Service -Name "LagoonCockpitAgent"
if ($svc.Status -eq "Running") {
    Write-Host ""
    Write-Host "=== SUCCESS ===" -ForegroundColor Green
    Write-Host "Lagoon Cockpit Agent is running on port 3001" -ForegroundColor Green
    Write-Host ""
    Write-Host "Add this server in the Cockpit mobile app:" -ForegroundColor Cyan
    Write-Host "  URL: http://100.85.242.40:3001" -ForegroundColor White
    Write-Host "  Auth: API Key" -ForegroundColor White
    Write-Host "  Key: (from $AGENT_DIR\.env)" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "=== FAILED ===" -ForegroundColor Red
    Write-Host "Service status: $($svc.Status)" -ForegroundColor Red
    Write-Host "Check event log: Get-EventLog -LogName Application -Source LagoonCockpitAgent -Newest 10" -ForegroundColor Yellow
}

# Add firewall rule for Tailscale access
$rule = Get-NetFirewallRule -DisplayName "Lagoon-Cockpit-Agent" -ErrorAction SilentlyContinue
if (!$rule) {
    Write-Host ""
    Write-Host "Adding firewall rule (Tailscale only)..." -ForegroundColor Cyan
    New-NetFirewallRule -DisplayName "Lagoon-Cockpit-Agent" `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 `
        -RemoteAddress "100.64.0.0/10" `
        -Description "Lagoon Cockpit Agent - Tailscale access only"
    Write-Host "Firewall rule added" -ForegroundColor Green
}
