# DANI OS - Windows setup helper (PowerShell 5.1+)
# Downloads the latest DANI OS ISO + Android APK from your GitHub Releases, verifies the ISO,
# installs the APK on a USB-connected phone, and helps you make a bootable USB with Rufus.
# It NEVER writes to a disk by itself: Rufus asks you which USB stick to use and shows the warning.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'      # much faster downloads
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgFile = Join-Path $root 'repo.txt'
$dl = Join-Path $root 'downloads'
$ptDir = Join-Path $root 'platform-tools'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
$headers = @{ 'User-Agent' = 'DANI-Setup' }

function Get-Repo {
    if (Test-Path $cfgFile) {
        $r = (Get-Content $cfgFile -Raw).Trim()
        if ($r -match '^[\w.-]+/[\w.-]+$') { return $r }
    }
    Write-Host ''
    Write-Host 'Enter your GitHub repository, like:  yourname/dani-os' -ForegroundColor Yellow
    do { $r = (Read-Host 'owner/repo').Trim() } until ($r -match '^[\w.-]+/[\w.-]+$')
    Set-Content -Path $cfgFile -Value $r
    return $r
}

function Get-Release($repo) {
    try { return Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases/latest" }
    catch {
        Write-Host "Could not find a release in $repo." -ForegroundColor Red
        Write-Host 'Run the build first: GitHub -> Actions -> Build DANI OS (ISO + APK) -> Run workflow.'
        Write-Host 'Also make sure the repository is Public and the name is right (delete repo.txt to re-enter it).'
        return $null
    }
}

function Get-File($url, $dest) {
    Write-Host "Downloading $(Split-Path -Leaf $dest) ..."
    Invoke-WebRequest -Headers $headers -Uri $url -OutFile $dest -UseBasicParsing
}

function Download-Latest {
    $repo = Get-Repo
    $rel = Get-Release $repo
    if (-not $rel) { return }
    Write-Host "Latest release: $($rel.name)" -ForegroundColor Green
    foreach ($a in $rel.assets) {
        if ($a.name -match '\.(iso|sha256|apk)$') { Get-File $a.browser_download_url (Join-Path $dl $a.name) }
    }
    $iso = Get-ChildItem $dl -Filter *.iso | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $sha = Get-ChildItem $dl -Filter *.sha256 | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($iso -and $sha) {
        $want = ((Get-Content $sha.FullName -Raw).Trim() -split '\s+')[0].ToLower()
        $have = (Get-FileHash $iso.FullName -Algorithm SHA256).Hash.ToLower()
        if ($want -eq $have) { Write-Host 'ISO checksum OK.' -ForegroundColor Green }
        else { Write-Host 'ISO checksum DOES NOT MATCH - delete the file and download again.' -ForegroundColor Red }
    }
    Write-Host "Files are in: $dl"
}

function Ensure-Adb {
    $adb = Join-Path $ptDir 'adb.exe'
    if (-not (Test-Path $adb)) {
        Write-Host 'Downloading Android platform-tools (adb) from Google ...'
        $zip = Join-Path $root 'platform-tools.zip'
        Invoke-WebRequest -Headers $headers -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $root -Force
        Remove-Item $zip
    }
    return $adb
}

function Install-Apk {
    $apk = Get-ChildItem $dl -Filter *.apk -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $apk) { Write-Host 'No APK yet. Choose option 1 first.' -ForegroundColor Yellow; return }
    Write-Host ''
    Write-Host 'On the phone: Settings > About phone > tap "Build number" 7 times,' -ForegroundColor Yellow
    Write-Host 'then Settings > Developer options > turn on "USB debugging". Connect the USB cable' -ForegroundColor Yellow
    Write-Host 'and tap "Allow" on the phone when it asks about this computer.' -ForegroundColor Yellow
    Read-Host 'Press Enter when the phone is connected'
    $adb = Ensure-Adb
    & $adb start-server | Out-Null
    $list = (& $adb devices) -join "`n"
    if ($list -match 'unauthorized') { Write-Host 'The phone is asking for permission. Tap "Allow" on the phone and run this option again.' -ForegroundColor Red; return }
    if ($list -notmatch "\sdevice(\r|\n|$)") { Write-Host 'No phone found. Check the cable and USB debugging.' -ForegroundColor Red; return }
    Write-Host 'Installing DANI OS Mobile ...'
    $out = & $adb install -r $apk.FullName 2>&1
    $out | ForEach-Object { Write-Host $_ }
    if (($out -join ' ') -match 'Success') { Write-Host 'Installed. Open "DANI OS Mobile" on the phone.' -ForegroundColor Green }
    else { Write-Host 'Install failed - see the message above.' -ForegroundColor Red }
}

function Make-Usb {
    $iso = Get-ChildItem $dl -Filter *.iso -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $iso) { Write-Host 'No ISO yet. Choose option 1 first.' -ForegroundColor Yellow; return }
    Write-Host ''
    Write-Host 'WARNING: making a bootable USB ERASES everything on that USB stick.' -ForegroundColor Red
    Write-Host 'Use an empty stick of at least 4 GB. This script does not touch any disk itself;'
    Write-Host 'Rufus will ask you which stick to use.'
    Write-Host ''
    Write-Host 'Tip: test the ISO in VirtualBox first (Linux > Debian 64-bit, 4 GB RAM, enable EFI).' -ForegroundColor Cyan
    if ((Read-Host 'Open Rufus now? (y/n)') -ne 'y') { return }
    $rufus = Join-Path $dl 'rufus.exe'
    if (-not (Test-Path $rufus)) {
        try {
            $r = Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/pbatard/rufus/releases/latest'
            $asset = $r.assets | Where-Object { $_.name -match '^rufus-[\d.]+\.exe$' } | Select-Object -First 1
            if (-not $asset) { throw 'no asset' }
            Get-File $asset.browser_download_url $rufus
        } catch {
            Write-Host 'Could not download Rufus automatically. Opening rufus.ie ...'
            Start-Process 'https://rufus.ie'
            Start-Process explorer.exe $dl
            return
        }
    }
    Write-Host "In Rufus: choose your USB stick, click SELECT and pick: $($iso.Name)"
    Write-Host 'Partition scheme: GPT. Then press START (if asked, choose "Write in ISO Image mode").'
    Start-Process $rufus
    Start-Process explorer.exe $dl
}

while ($true) {
    Clear-Host
    Write-Host '=== DANI OS Setup ===' -ForegroundColor Red
    Write-Host '1) Download the latest ISO + APK'
    Write-Host '2) Install the APK on my Android phone (USB cable)'
    Write-Host '3) Make a bootable USB from the ISO (Rufus)'
    Write-Host '4) Open the downloads folder'
    Write-Host '0) Exit'
    $c = Read-Host 'Choose'
    try {
        switch ($c) {
            '1' { Download-Latest }
            '2' { Install-Apk }
            '3' { Make-Usb }
            '4' { Start-Process explorer.exe $dl }
            '0' { exit }
        }
    } catch { Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red }
    Write-Host ''
    Read-Host 'Press Enter to continue'
}
