# Bothost fill helper (ASCII-only to avoid PowerShell encoding issues)
# Run: powershell -ExecutionPolicy Bypass -File .\bothost-fill.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Read-DotEnv([string]$Path) {
    $map = @{}
    if (-not (Test-Path $Path)) {
        throw "Missing .env file. Copy .env.example to .env and fill BOT_TOKEN / ADMIN_CHAT_ID"
    }
    Get-Content $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        $map[$key] = $val
    }
    return $map
}

$envMap = Read-DotEnv (Join-Path $PSScriptRoot ".env")
$botToken = $envMap["BOT_TOKEN"]
$adminId = $envMap["ADMIN_CHAT_ID"]
if (-not $botToken -or -not $adminId) {
    throw "BOT_TOKEN and ADMIN_CHAT_ID are required in .env"
}

$CreateUrl = "https://bothost.ru/create-bot.php"
$GitUrl = "https://github.com/NKOHA-code/knyazbot.git"

$FormFields = [ordered]@{
    "Bot name"     = "KnyazMobile"
    "Platform"     = "Telegram"
    "Library"      = "aiogram"
    "Bot Token"    = $botToken
    "Git URL"      = $GitUrl
    "Branch"       = "main"
    "Main file"    = "main.py"
    "Port"         = "3000"
}

$manager = if ($envMap["MANAGER_USERNAME"]) { $envMap["MANAGER_USERNAME"] } else { "knyaztut" }
$phone = if ($envMap["MANAGER_PHONE"]) { $envMap["MANAGER_PHONE"] } else { "+375297330592" }
$address = if ($envMap["SHOP_ADDRESS"]) { $envMap["SHOP_ADDRESS"] } else { "Minsk, Novovilenskaya 10" }
$shop = if ($envMap["SHOP_NAME"]) { $envMap["SHOP_NAME"] } else { "KnyazMobile" }

$EnvBlock = @"
ADMIN_CHAT_ID=$adminId
MANAGER_USERNAME=$manager
MANAGER_PHONE=$phone
SHOP_ADDRESS=$address
SHOP_NAME=$shop
ALLOW_INSECURE_ORDERS=false
"@

$cheat = @"
Bothost form: $CreateUrl

Bot name: KnyazMobile
Platform: Telegram
Library: aiogram
Bot Token: $botToken
Git URL: $GitUrl
Branch: main
Main file: main.py
Port: 8765
Custom Dockerfile: YES
Web UI / domain / webhook: YES

ENV:
$EnvBlock
"@
Set-Content -Path (Join-Path $PSScriptRoot "bothost-values.txt") -Value $cheat -Encoding UTF8

function Copy-Value([string]$Label, [string]$Value) {
    Set-Clipboard -Value $Value
    Write-Host ""
    Write-Host ">>> $Label" -ForegroundColor Cyan
    Write-Host $Value -ForegroundColor Yellow
    Write-Host "(copied to clipboard - Ctrl+V)" -ForegroundColor DarkGray
    Read-Host "Press Enter for next"
}

Clear-Host
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Bothost fill helper - KnyazMobile" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Bothost has no public create API." -ForegroundColor DarkYellow
Write-Host "This script opens the form and copies fields one by one." -ForegroundColor White
Write-Host ""
Write-Host "Enable checkboxes manually:" -ForegroundColor White
Write-Host "  [x] Custom Dockerfile" -ForegroundColor Yellow
Write-Host "  [x] Web UI / domain / webhook" -ForegroundColor Yellow
Write-Host ""
Write-Host "Cheat-sheet saved to bothost-values.txt" -ForegroundColor DarkGray
Write-Host ""

Read-Host "Press Enter to open Bothost create form"
Start-Process $CreateUrl
Start-Sleep -Seconds 1

foreach ($pair in $FormFields.GetEnumerator()) {
    Copy-Value $pair.Key $pair.Value
}

Write-Host ""
Write-Host "Enable: Dockerfile + Web domain checkboxes!" -ForegroundColor Magenta
Read-Host "Press Enter to copy ENV block"

Set-Clipboard -Value $EnvBlock.Trim()
Write-Host ""
Write-Host $EnvBlock -ForegroundColor Yellow
Write-Host "Paste into Environment Variables." -ForegroundColor DarkGray
Write-Host ""
Write-Host "After deploy: /api/health -> BotFather Domain -> /start" -ForegroundColor Green
Read-Host "Press Enter to exit"
