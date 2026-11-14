@echo off
cd /d "%~dp0"
set "BAT_SELF=%~f0"
set "DROP_TXT=%~1"
set "PS_TMP=%TEMP%\3gokushi_dl_%RANDOM%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lines = Get-Content -LiteralPath $env:BAT_SELF; $idx = [Array]::IndexOf($lines, '# === PS_BEGIN ==='); if ($idx -ge 0) { [IO.File]::WriteAllLines($env:PS_TMP, $lines[($idx+1)..($lines.Length-1)]) }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_TMP%"
del /f /q "%PS_TMP%" > nul 2>&1
pause
exit /b
# === PS_BEGIN ===
$ErrorActionPreference = "SilentlyContinue"
$ProgressPreference = "SilentlyContinue"
$baseDir = (Get-Location).Path
$txtPath = $env:DROP_TXT

if (-not $txtPath -or -not (Test-Path -LiteralPath $txtPath)) {
    $cands = @()
    $localTxt = Join-Path $baseDir "3gokushi_img_list.txt"
    if (Test-Path -LiteralPath $localTxt) {
        $cands += Get-Item -LiteralPath $localTxt
    }
    $dlDir = Join-Path $env:USERPROFILE "Downloads"
    if (Test-Path -LiteralPath $dlDir) {
        $cands += Get-ChildItem -LiteralPath $dlDir -Filter "3gokushi_img_list*.txt" -File
    }
    $latest = $cands | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        $txtPath = $latest.FullName
    }
}

if (-not $txtPath -or -not (Test-Path -LiteralPath $txtPath)) {
    Write-Host "======================================================" -ForegroundColor Red
    Write-Host " [ERROR] 3gokushi_img_list.txt was not found." -ForegroundColor Red
    Write-Host " Please drag and drop '3gokushi_img_list.txt' onto this .bat file." -ForegroundColor Yellow
    Write-Host "======================================================" -ForegroundColor Red
    exit 1
}

$imgDir = Join-Path $baseDir "img"
if (-not (Test-Path -LiteralPath $imgDir)) {
    New-Item -ItemType Directory -Path $imgDir | Out-Null
}

$rawLines = Get-Content -LiteralPath $txtPath -Encoding UTF8
$existingMap = @{}
Get-ChildItem -LiteralPath $imgDir -File | ForEach-Object {
    $existingMap[$_.Name] = $_.Length
}

$toDownload = @()
$skippedCount = 0
$totalValid = 0

foreach ($line in $rawLines) {
    if (-not $line -or $line.IndexOf("`t") -lt 0) { continue }
    $parts = $line -split "`t", 2
    $fn = $parts[0].Trim().Trim([char]0xFEFF)
    $url = $parts[1].Trim()
    if (-not $fn -or -not $url) { continue }
    $totalValid++
    if ($existingMap.ContainsKey($fn)) {
        $sz = $existingMap[$fn]
        if ($fn -like "bg_card_*" -or $sz -ge 16000) {
            $skippedCount++
            continue
        }
    }
    $toDownload += [PSCustomObject]@{ f = $fn; u = $url }
}

$dlTotal = $toDownload.Count
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 3gokushi Image Downloader" -ForegroundColor Cyan
Write-Host " List : $(Split-Path -Leaf $txtPath)" -ForegroundColor Gray
Write-Host " Total: $totalValid / Skipped: $skippedCount / Download: $dlTotal" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

if ($dlTotal -eq 0) {
    Write-Host "All images are already saved in the 'img' folder!" -ForegroundColor Green
    exit 0
}

$i = 0
$downloaded = 0
foreach ($it in $toDownload) {
    $i++
    $dest = Join-Path $imgDir $it.f
    Write-Host "[$i / $dlTotal] Downloading: $($it.f)"
    try {
        Invoke-WebRequest -Uri $it.u -OutFile $dest -UseBasicParsing -TimeoutSec 15
        $downloaded++
    } catch {
        Write-Host "  -> Skipped/Error: $($it.f)" -ForegroundColor Yellow
    }
    Start-Sleep -Milliseconds 500
}

Write-Host "Completed! Saved: $downloaded images -> $imgDir" -ForegroundColor Green