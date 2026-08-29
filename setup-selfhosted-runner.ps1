# Setup self-hosted GitHub Actions runner on an always-on Windows office PC/server
# This makes Vercel live independent of your personal PC — runner stays on 24/7 and rebuilds daily
# Run this ON the always-on machine (Windows, PowerShell as Administrator)

$repo = "tahmidulislam-dotcom/akij-dashboard"
# Create a fine-grained PAT at https://github.com/settings/tokens with repo+workflow scope, then set: $token = "ghp_xxx"
$token = $env:GITHUB_TOKEN
if (-not $token) { $token = Read-Host "Enter GitHub PAT (repo+workflow)" -AsSecureString | ForEach-Object { [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) } }

Write-Host "1) Create runner directory"
mkdir C:\actions-runner -ErrorAction SilentlyContinue
Set-Location C:\actions-runner

Write-Host "2) Download runner"
$arch = "win-x64"
$version = "2.328.0"  # check https://github.com/actions/runner/releases for latest
Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v$version/actions-runner-$arch-$version.zip" -OutFile "actions-runner.zip"
Expand-Archive -Path "actions-runner.zip" -DestinationPath "." -Force

Write-Host "3) Get registration token from GitHub"
$regToken = (Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/runners/registration-token" -Method Post -Headers @{Authorization="Bearer $token"; Accept="application/vnd.github.v3+json"}).token
if (-not $regToken) { Write-Error "Failed to get registration token — check PAT scopes (repo, workflow, admin:org)"; exit 1 }

Write-Host "4) Configure runner"
.\config.cmd --url "https://github.com/$repo" --token $regToken --name "office-win-live" --labels "self-hosted,Windows,office" --unattended --runasservice

Write-Host "5) Install & start service"
.\svc.cmd install
.\svc.cmd start

Write-Host "Done — runner 'office-win-live' should appear at https://github.com/$repo/settings/actions/runners"
Write-Host "It will now pick up the 'Rebuild DWH Data — Self-Hosted' workflow daily at 06:35 Dhaka, even when your PC is off."
Write-Host "Keep this machine on, on VPN/office network with access to 203.202.241.211:1433, and leave the service running."

# To make DWH reachable from Vercel/GitHub cloud without this runner, ask network team to whitelist:
# Vercel egress: 76.76.19.0/24, 76.223.126.0/24 (plus https://vercel.com/docs/edge-network/cidr)
# GitHub Actions: fetch https://api.github.com/meta and whitelist .actions[] CIDRs
# Then cloud rebuild (ubuntu-latest) will also succeed and Vercel will be live without office PC at all.
