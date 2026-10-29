# Register the GmistLocal scheduled task: the local gmist (the production build TagFox opens
# markdown in) starts at logon and on unlock, so a file never waits for gmist to start.
# The task runs `node scripts/local-gmist.mjs serve`; `npm run deploy` restarts it on the new
# build (scripts/local-gmist.mjs refresh). Local-only: git carries this, not the task.
# machine-parity.ps1 asserts the task and runs this to fix it.
$TaskName = 'GmistLocal'
$Repo     = Split-Path $PSScriptRoot -Parent
$Node     = 'C:\Program Files\nodejs\node.exe'
# No console window on any fire: wscript runs the command with window style 0 and waits for it,
# so the task stays Running for as long as gmist is up.
$Hidden   = Join-Path $env:USERPROFILE '.claude\bin\run-hidden.vbs'
$Script   = Join-Path $Repo 'scripts\local-gmist.mjs'

foreach ($p in $Node, $Hidden, $Script) { if (-not (Test-Path $p)) { Write-Error "missing: $p"; exit 1 } }

$me = "$env:USERDOMAIN\$env:USERNAME"
# XML because Register-ScheduledTask cannot bind mixed logon and unlock triggers. Unlock as well
# as logon, because resuming from sleep re-runs nothing; IgnoreNew plus the port check in
# `serve` make a second start a no-op. Priority 6 is Normal: 7 and above would run the build
# and the server below Normal, and every child inherits it.
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Local gmist on http://localhost:5173 (production build, local files), for TagFox</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$me</UserId></LogonTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled><UserId>$me</UserId><StateChange>SessionUnlock</StateChange></SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>$me</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>6</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Windows\System32\wscript.exe</Command>
      <Arguments>//nologo "$Hidden" "$Node" "$Script" serve</Arguments>
      <WorkingDirectory>$Repo</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force -ErrorAction Stop | Out-Null
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { Write-Error "$TaskName did not register"; exit 1 }
Start-ScheduledTask -TaskName $TaskName
Write-Host "Registered and started $TaskName (http://localhost:5173)."
