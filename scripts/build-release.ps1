# 构建 SiFlux 发行包（含 plugin-packages 的安装包）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 [-Version 1.0.2] [-SkipInstaller]

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Desktop = Join-Path $Root "backend\cmd\desktop"
$Bin = Join-Path $Desktop "build\bin"
$InstallerDir = Join-Path $Desktop "build\windows\installer"

if (-not $Version) {
    $Version = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim().TrimStart("v")
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "version must be x.y.z, got: $Version" }

function Add-PathIfExists([string]$Path) {
    if ($Path -and (Test-Path $Path) -and ($env:PATH -notlike "*$Path*")) {
        $env:PATH = "$Path;$env:PATH"
    }
}
Add-PathIfExists (Join-Path $Root ".local\tools\go\bin")
Add-PathIfExists (Join-Path $env:USERPROFILE "go\bin")
Add-PathIfExists (Join-Path ${env:ProgramFiles(x86)} "NSIS")
$mingw = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "BrechtSanders.WinLibs.POSIX.UCRT_*" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if ($mingw) { Add-PathIfExists (Join-Path $mingw.FullName "mingw64\bin") }
$env:CGO_ENABLED = "1"

foreach ($tool in @("go", "wails")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "missing $tool" }
}
if (-not $SkipInstaller -and -not (Get-Command makensis -ErrorAction SilentlyContinue)) {
    throw "missing makensis"
}

Write-Host "==> version $Version"
Set-Content (Join-Path $Root "VERSION") "v$Version"
$pkgPath = Join-Path $Root "web\package.json"
$pkgText = [System.IO.File]::ReadAllText($pkgPath)
$pkgText = [regex]::Replace($pkgText, '"version"\s*:\s*"[^"]*"', "`"version`": `"$Version`"", 1)
[System.IO.File]::WriteAllText($pkgPath, $pkgText, (New-Object System.Text.UTF8Encoding($false)))

Get-Process SiFlux -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$publicKeyFile = Join-Path $Root "scripts\desktop-updater.pub"
if (-not (Test-Path $publicKeyFile)) { throw "missing $publicKeyFile" }
$publicKey = ([System.IO.File]::ReadAllText($publicKeyFile)).Trim()
if (-not $publicKey) { throw "scripts/desktop-updater.pub is empty" }
$feedURL = "https://ghclone.com/https://github.com/Aa1689756333/SiFlux-Studio/releases/latest/download/desktop-update.json"
$ldflags = "-X infinite-canvas/backend/internal/buildinfo.Version=v$Version -X infinite-canvas/backend/internal/desktopupdate.FeedURL=$feedURL -X infinite-canvas/backend/internal/desktopupdate.PublicKey=$publicKey"

Push-Location $Desktop
try {
    if ($SkipInstaller) {
        wails build -clean -ldflags $ldflags
    } else {
        # No -nsis: wails would run makensis before plugin-packages are staged.
        wails build -clean -ldflags $ldflags
    }
    if ($LASTEXITCODE -ne 0) { throw "wails build failed" }
} finally {
    Pop-Location
}

$exe = Join-Path $Bin "SiFlux.exe"
if (-not (Test-Path $exe)) { throw "missing $exe" }

if ($SkipInstaller) {
    Write-Host "==> done: $exe"
    return
}

$nsi = Join-Path $InstallerDir "project.nsi"
if (-not (Test-Path $nsi)) {
    Write-Host "==> generating NSIS script"
    Push-Location $Desktop
    try { wails build -nsis -ldflags $ldflags } finally { Pop-Location }
}

$staged = Join-Path $Bin "plugin-packages"
if (Test-Path $staged) { Remove-Item $staged -Recurse -Force }
Copy-Item (Join-Path $Root "plugin-packages") $staged -Recurse
Write-Host "==> copied plugin-packages into build\bin"

# wails regenerates NSIS helpers; patch project.nsi then run makensis ourselves.
$nsi = Join-Path $InstallerDir "project.nsi"
$text = Get-Content $nsi -Raw
$nsiDirty = $false
if ($text -notmatch 'WAILS_INSTALL_SCOPE "user"') {
    $include = '!include "wails_tools.nsh"'
    if ($text -notmatch [regex]::Escape($include)) { throw "project.nsi changed, missing wails_tools.nsh" }
    $text = $text.Replace($include, "!define REQUEST_EXECUTION_LEVEL `"user`"`r`n!define WAILS_INSTALL_SCOPE `"user`"`r`n$include")
    $nsiDirty = $true
    Write-Host "==> per-user install for in-app updates"
}
if ($text -notmatch "plugin-packages") {
    $anchor = '    !insertmacro wails.files'
    if ($text -notmatch [regex]::Escape($anchor)) { throw "project.nsi changed, missing wails.files" }
    $block = $anchor + "`r`n" +
        '    SetOutPath "$INSTDIR\plugin-packages"' + "`r`n" +
        '    File /r "..\..\bin\plugin-packages\*.*"' + "`r`n" +
        '    SetOutPath "$INSTDIR"'
    $text = $text.Replace($anchor, $block)
    $nsiDirty = $true
    Write-Host "==> wrote plugin-packages install rule"
}
if ($nsiDirty) {
    Set-Content $nsi $text -Encoding UTF8
}

Push-Location $InstallerDir
try {
    makensis -V2 "-DARG_WAILS_AMD64_BINARY=..\..\bin\SiFlux.exe" project.nsi
    if ($LASTEXITCODE -ne 0) { throw "makensis failed" }
} finally {
    Pop-Location
}

$installer = Join-Path $Bin "SiFlux-amd64-installer.exe"
if (-not (Test-Path $installer)) { throw "missing installer" }

$zipName = "SiFlux-v$Version-windows-amd64.zip"
$zip = Join-Path $Bin $zipName
Write-Host "==> packaging updater zip"
Push-Location (Join-Path $Root "backend")
try {
    go run ./cmd/update-release package --platform windows-amd64 --input $Bin --output $zip
    if ($LASTEXITCODE -ne 0) { throw "updater zip failed" }
} finally {
    Pop-Location
}

$privateKey = Join-Path $Root ".local\updater\private.key"
if (-not (Test-Path $privateKey)) { throw "missing updater private key $privateKey" }
$commit = (git -C $Root rev-parse HEAD).Trim()
$feedOut = Join-Path $Bin "desktop-update.json"
$downloadBase = "https://ghclone.com/https://github.com/Aa1689756333/SiFlux-Studio/releases/download"
Write-Host "==> signing desktop-update.json"
Push-Location (Join-Path $Root "backend")
try {
    go run ./cmd/update-release sign --version "v$Version" --commit $commit --changelog (Join-Path $Root "CHANGELOG.md") --private-key $privateKey --expect-public-key $publicKey --download-base $downloadBase --output $feedOut --asset "windows-amd64=$zip" --require-platforms windows-amd64
    if ($LASTEXITCODE -ne 0) { throw "sign desktop-update.json failed" }
} finally {
    Pop-Location
}

Write-Host "==> done:"
Write-Host "  $exe"
Write-Host "  $installer"
Write-Host "  $zip"
Write-Host "  $feedOut"
