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
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "版本号格式应为 x.y.z，当前：$Version" }

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
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "找不到 $tool，请先安装并加入 PATH" }
}
if (-not $SkipInstaller -and -not (Get-Command makensis -ErrorAction SilentlyContinue)) {
    throw "找不到 makensis，请安装 NSIS"
}

Write-Host "==> 版本 $Version"
Set-Content (Join-Path $Root "VERSION") "v$Version"
$pkgPath = Join-Path $Root "web\package.json"
$pkgText = [System.IO.File]::ReadAllText($pkgPath)
$pkgText = [regex]::Replace($pkgText, '"version"\s*:\s*"[^"]*"', "`"version`": `"$Version`"", 1)
[System.IO.File]::WriteAllText($pkgPath, $pkgText, (New-Object System.Text.UTF8Encoding($false)))

Get-Process SiFlux -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Push-Location $Desktop
try {
    $ldflags = "-X infinite-canvas/backend/internal/buildinfo.Version=$Version"
    if ($SkipInstaller) {
        wails build -clean -ldflags $ldflags
    } else {
        # 不带 -nsis：wails 会在构建过程中直接调用 makensis，此时插件尚未复制
        wails build -clean -ldflags $ldflags
    }
    if ($LASTEXITCODE -ne 0) { throw "wails build 失败" }
} finally {
    Pop-Location
}

$exe = Join-Path $Bin "SiFlux.exe"
if (-not (Test-Path $exe)) { throw "未生成 $exe" }

if ($SkipInstaller) {
    Write-Host "==> 完成：$exe"
    return
}

# wails build -clean 会清空 bin，插件必须在构建后复制
$nsi = Join-Path $InstallerDir "project.nsi"
if (-not (Test-Path $nsi)) {
    Write-Host "==> 首次生成 NSIS 脚本"
    Push-Location $Desktop
    try { wails build -nsis -ldflags $ldflags } finally { Pop-Location }
}

$staged = Join-Path $Bin "plugin-packages"
if (Test-Path $staged) { Remove-Item $staged -Recurse -Force }
Copy-Item (Join-Path $Root "plugin-packages") $staged -Recurse
Write-Host "==> 已复制 plugin-packages 到 build\bin"

# wails 每次都会重新生成 NSIS 脚本，因此改 project.nsi 后用 makensis 手工编译，
# 不能用 wails_tools.nsh（会被覆盖）。
$nsi = Join-Path $InstallerDir "project.nsi"
$text = Get-Content $nsi -Raw
if ($text -notmatch "plugin-packages") {
    $anchor = '    !insertmacro wails.files'
    if ($text -notmatch [regex]::Escape($anchor)) { throw "project.nsi 结构变化，找不到 wails.files" }
    $block = $anchor + "`r`n" +
        '    SetOutPath "$INSTDIR\plugin-packages"' + "`r`n" +
        '    File /r "..\..\bin\plugin-packages\*.*"' + "`r`n" +
        '    SetOutPath "$INSTDIR"'
    $text = $text.Replace($anchor, $block)
    Set-Content $nsi $text -Encoding UTF8
    Write-Host "==> 已写入 plugin-packages 安装规则"
}

Push-Location $InstallerDir
try {
    makensis -V2 "-DARG_WAILS_AMD64_BINARY=..\..\bin\SiFlux.exe" project.nsi
    if ($LASTEXITCODE -ne 0) { throw "makensis 失败" }
} finally {
    Pop-Location
}

$installer = Join-Path $Bin "SiFlux-amd64-installer.exe"
if (-not (Test-Path $installer)) { throw "未生成安装包" }
Write-Host "==> 完成："
Write-Host "  $exe"
Write-Host "  $installer"
