# Run this once to copy the dashboard into place
# Double-click or run: powershell -ExecutionPolicy Bypass -File copy-dashboard.ps1

$src = Join-Path $PSScriptRoot "dashboard-dist\app.html"
$dst = "C:\duneli-dashboard\public\app.html"

if (Test-Path $src) {
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "✅ Dashboard copied to $dst" -ForegroundColor Green
} else {
    Write-Host "❌ Source not found: $src" -ForegroundColor Red
    Write-Host "Make sure dashboard-dist\app.html exists next to this script." -ForegroundColor Yellow
}
