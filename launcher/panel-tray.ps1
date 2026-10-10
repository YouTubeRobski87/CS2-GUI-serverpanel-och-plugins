# Gamla Skolan – CS2 server panel as a desktop program (tray icon + own window).
# Gamla Skolan – Serverpanel som program.
# Startar panelen osynligt i bakgrunden, öppnar den i ett eget fönster (utan webbläsarflikar)
# och lägger en ikon nere vid klockan med Öppna / Starta om / Avsluta.
# Startas av "Gamla Skolan Panel.vbs" (genvägen på skrivbordet), så inget svart fönster syns.

$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8027
$Url = "http://localhost:$Port"
$WindowProfile = Join-Path $Root 'panel-data\fonster'
$LogFile = Join-Path $Root 'panel-data\panel.log'
$IconFile = Join-Path $Root 'gamla-skolan.ico'
$TrayLog = Join-Path $Root 'panel-data\tray.log'
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'panel-data') | Out-Null
# Språk: följer panelens inställning (panel-data/settings.json). Äldre installationer utan språkval är svenska.
$SettingsFile = Join-Path $Root 'panel-data\settings.json'
$script:Lang = 'en'
try {
    if (Test-Path $SettingsFile) {
        $j = Get-Content $SettingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.lang) { $script:Lang = $j.lang } else { $script:Lang = 'sv' }
    }
} catch {}
function T($sv, $en) { if ($script:Lang -eq 'sv') { return $sv } else { return $en } }
function Log($msg) { try { Add-Content -Path $TrayLog -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) -Encoding UTF8 } catch {} }
Log "Startar (PowerShell $($PSVersionTable.PSVersion))"
trap { Log "FEL: $($_.Exception.Message) (rad $($_.InvocationInfo.ScriptLineNumber))"; continue }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Test-PanelRunning {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Find-Browser {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

function Start-Panel {
    if (Test-PanelRunning) { Log 'Panelen kör redan på port 8027'; return $true }
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        [System.Windows.Forms.MessageBox]::Show((T "Hittar inte Node.js. Installera det från https://nodejs.org och försök igen." "Node.js was not found. Install it from https://nodejs.org (LTS) and try again."), "Gamla Skolan Panel", 'OK', 'Error') | Out-Null
        return $false
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "$env:ComSpec"
    $psi.Arguments = "/c `"`"$node`" build > `"$LogFile`" 2>&1`""
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['PORT'] = "$Port"
    $psi.EnvironmentVariables['HOST'] = '127.0.0.1'
    $psi.EnvironmentVariables['ORIGIN'] = $Url
    Log "Startar node: $node"
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-PanelRunning) { return $true }
    }
    [System.Windows.Forms.MessageBox]::Show((T "Panelen startade inte. Se loggen:`n$LogFile" "The panel did not start. See the log:`n$LogFile"), "Gamla Skolan Panel", 'OK', 'Error') | Out-Null
    return $false
}

function Open-PanelWindow {
    $browser = Find-Browser
    Log "Öppnar fönster med: $browser"
    if ($browser) {
        $browserArgs = @("--app=$Url", "--user-data-dir=`"$WindowProfile`"", '--no-first-run', '--no-default-browser-check', '--window-size=1440,920')
        Start-Process -FilePath $browser -ArgumentList $browserArgs
    } else {
        Start-Process $Url
    }
}

function Close-PanelWindows {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*panel-data\fonster*" } |
        ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
}

function Stop-Panel {
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}


# Skapa riktiga Windows-genvägar (skrivbord + Start-menyn) med programmets ikon.
# Görs av Windows själv här, så de blir alltid giltiga. Från Start-menyn kan den fästas i aktivitetsfältet.
function Update-Shortcuts {
    try {
        $ws = New-Object -ComObject WScript.Shell
        $targets = @(
            (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Gamla Skolan Panel.lnk'),
            (Join-Path ([Environment]::GetFolderPath('Programs')) 'Gamla Skolan Panel.lnk')
        )
        foreach ($p in $targets) {
            $sc = $ws.CreateShortcut($p)
            $sc.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
            $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\panel-tray.ps1`""
            $sc.WorkingDirectory = $Root
            $sc.IconLocation = "$IconFile,0"
            $sc.WindowStyle = 7
            $sc.Description = 'Gamla Skolan – CS2 server panel'
            $sc.Save()
        }
        Log 'Genvägar uppdaterade (skrivbord + Start-menyn)'
    } catch { Log "Kunde inte skapa genvägar: $($_.Exception.Message)" }
}

# Bara en ikon vid klockan: körs den redan öppnar vi bara fönstret.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\GamlaSkolanPanelTray', [ref]$created)
if (-not $created) {
    if (Start-Panel) { Open-PanelWindow }
    exit
}

if (-not (Start-Panel)) { $mutex.ReleaseMutex(); exit }
Open-PanelWindow
Update-Shortcuts

# ---- ikon vid klockan ----
$tray = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $IconFile) { $tray.Icon = New-Object System.Drawing.Icon $IconFile } else { $tray.Icon = [System.Drawing.SystemIcons]::Application }
$tray.Text = 'Gamla Skolan – CS2 Panel'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemOpen = $menu.Items.Add((T 'Öppna panelen' 'Open the panel'))
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemRestart = $menu.Items.Add((T 'Starta om panelen' 'Restart the panel'))
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$itemExit = $menu.Items.Add((T 'Avsluta panelen' 'Quit the panel'))
$tray.ContextMenuStrip = $menu

$itemOpen.add_Click({ if (Start-Panel) { Open-PanelWindow } })
$tray.add_DoubleClick({ if (Start-Panel) { Open-PanelWindow } })
$itemRestart.add_Click({
    Stop-Panel
    Start-Sleep -Milliseconds 800
    if (Start-Panel) { $tray.ShowBalloonTip(3000, 'Gamla Skolan', (T 'Panelen är omstartad.' 'The panel has restarted.'), 'Info') }
})
$itemExit.add_Click({
    Close-PanelWindows
    Stop-Panel
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

# Visa serverns läge i ikonens tooltip och säg till när CS2-servern startar eller stängs.
$script:lastRunning = $null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
    try {
        $st = Invoke-RestMethod -Uri "$Url/api/state" -TimeoutSec 2
        $running = [bool]$st.running
        if ($st.lang -and $st.lang -ne $script:Lang) {
            $script:Lang = $st.lang
            $itemOpen.Text = (T 'Öppna panelen' 'Open the panel')
            $itemRestart.Text = (T 'Starta om panelen' 'Restart the panel')
            $itemExit.Text = (T 'Avsluta panelen' 'Quit the panel')
        }
        if ($running) { $tray.Text = (T 'Gamla Skolan – CS2-servern är igång' 'Gamla Skolan – CS2 server is running') } else { $tray.Text = (T 'Gamla Skolan – CS2-servern är avstängd' 'Gamla Skolan – CS2 server is offline') }
        if ($script:lastRunning -ne $null -and $script:lastRunning -ne $running) {
            if ($running) { $tray.ShowBalloonTip(4000, 'Gamla Skolan', (T 'CS2-servern är igång.' 'The CS2 server is running.'), 'Info') }
            else { $tray.ShowBalloonTip(4000, 'Gamla Skolan', (T 'CS2-servern har stängts.' 'The CS2 server has stopped.'), 'Warning') }
        }
        $script:lastRunning = $running
    } catch {
        $tray.Text = (T 'Gamla Skolan – panelen svarar inte' 'Gamla Skolan – panel not responding')
    }
})
$timer.Start()

$tray.ShowBalloonTip(3000, 'Gamla Skolan', (T 'Panelen körs här nere vid klockan. Högerklicka för att avsluta.' 'The panel runs down here by the clock. Right-click to quit.'), 'Info')
[System.Windows.Forms.Application]::Run()

$timer.Stop()
$mutex.ReleaseMutex()
