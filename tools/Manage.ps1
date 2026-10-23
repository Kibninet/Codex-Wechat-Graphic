param(
    [ValidateSet('Setup','Start','Stop','Status','StatusJson','SaveConfig','LoginWeChat','LoginCodex','LoginWeChatGui','LoginCodexGui','Doctor','Uninstall','OpenData','Test')]
    [string]$Action = 'Status',
    [string]$DataDir = '',
    [string]$WorkspacePath = '',
    [ValidateSet('default-permissions','full-access')]
    [string]$PermissionsMode = 'default-permissions',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if ([Console]::IsOutputRedirected) { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) }
$releaseRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $releaseRoot 'app'
$nodePath = Join-Path $releaseRoot 'runtime\node\node.exe'
$codexPath = Join-Path $releaseRoot 'runtime\codex\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$hostPath = Join-Path $PSScriptRoot 'BridgeHost.exe'
if (!$DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA 'Codex-Wechat' }
$DataDir = [System.IO.Path]::GetFullPath($DataDir)
$configPath = Join-Path $DataDir 'settings.json'
$envPath = Join-Path $DataDir 'bridge.env'
$pidPath = Join-Path $DataDir 'service.pid'
$taskName = 'Codex-Wechat-WeChat'

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}
function Quote-Argument([string]$Value) {
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Read-Settings {
    if (!(Test-Path -LiteralPath $configPath)) { throw '请先运行 1-Setup.cmd 完成首次配置。' }
    $settings = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings.version -ne 1) { throw '不支持的配置版本，请保留配置并检查发行版版本。' }
    return $settings
}
function Get-ServiceProcess {
    if (!(Test-Path -LiteralPath $pidPath)) { return $null }
    $value = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    if ($value -notmatch '^\d+$') { return $null }
    $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$value" -ErrorAction SilentlyContinue
    if ($serviceProcess -and $serviceProcess.Name -eq 'node.exe' -and $serviceProcess.CommandLine.Contains('run-weixin-service.mjs') -and $serviceProcess.CommandLine.Contains($DataDir)) { return $serviceProcess }
    return $null
}
function Initialize-PrivateDataDirectory {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & "$env:WINDIR\System32\icacls.exe" $DataDir '/inheritance:r' '/grant:r' "*$($userSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法设置本地数据目录权限，已停止配置。' }
    New-Item -ItemType Directory -Path (Join-Path $DataDir 'logs'),(Join-Path $DataDir 'codex-home') -Force | Out-Null
}
function Stop-Bridge {
    $scheduled = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($scheduled) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
    $serviceProcess = Get-ServiceProcess
    if ($serviceProcess) {
        & "$env:WINDIR\System32\taskkill.exe" /PID $serviceProcess.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-ServiceProcess)) { throw '无法停止当前桥接进程。' }
    }
    if ($scheduled) { Stop-ScheduledTask -TaskName $taskName }
}
function Update-Environment($Settings) {
    $accountsDir = Join-Path $DataDir 'weixin\accounts'
    $accounts = @(Get-ChildItem -LiteralPath $accountsDir -Filter '*.json' -ErrorAction SilentlyContinue | Where-Object Name -NotMatch '\.(sync|context-tokens)\.json$')
    if ($accounts.Count -ne 1) { throw '没有唯一的微信登录，请先运行 5-Login-WeChat.cmd。' }
    $account = Get-Content -LiteralPath $accounts[0].FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($account.user_id) -or $account.user_id -match '[\r\n,=]') { throw '微信账号缺少有效的登录所有者，已阻止启动。' }
    $workspace = [System.IO.Path]::GetFullPath([string]$Settings.workspace)
    if (!(Test-Path -LiteralPath $workspace -PathType Container)) { throw '工作目录不存在，请重新运行首次配置。' }
    $lines = @(
        'CODEX_DEFAULT_PROVIDER_PROFILE_ID=openai-default',
        "CODEX_HOME=$(Join-Path $DataDir 'codex-home')",
        "CODEX_REAL_BIN=$codexPath",
        "CODEXBRIDGE_STATE_DIR=$DataDir",
        "CODEXBRIDGE_DEFAULT_CWD=$workspace",
        "CODEXBRIDGE_DEFAULT_PERMISSIONS_MODE=$($Settings.permissionsMode)",
        'CODEXBRIDGE_LOCALE=zh-CN',
        'WEIXIN_DM_POLICY=allowlist',
        "WEIXIN_ALLOWED_USERS=$($account.user_id)",
        "WEIXIN_ACCOUNT_ID=$($accounts[0].BaseName)",
        'WEIXIN_GROUP_POLICY=disabled',
        'WEIXIN_STREAM_FINAL_ANSWER=false',
        'CODEXBRIDGE_DEBUG_WEIXIN=0'
    )
    Write-Utf8 $envPath (($lines -join "`n") + "`n")
}
function Start-Bridge {
    $settings = Read-Settings
    if (Get-ServiceProcess) {
        Enable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
        Write-Host '桥接已在运行。'
        return
    }
    Update-Environment $settings
    $runner = Join-Path $appRoot 'scripts\service\run-weixin-service.mjs'
    $arguments = @($nodePath,$runner,'--root-dir',$appRoot,'--state-dir',$DataDir,'--env-file',$envPath,'--cwd',[string]$settings.workspace,'--stdout-log',(Join-Path $DataDir 'logs\bridge.out.log'),'--stderr-log',(Join-Path $DataDir 'logs\bridge.err.log'))
    foreach ($argument in $arguments) { if ($argument -match '["\r\n]') { throw '启动参数含有不支持的字符。' } }
    $quotedArguments = ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
    $taskAction = New-ScheduledTaskAction -Execute $hostPath -Argument $quotedArguments -WorkingDirectory $appRoot
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $recovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger @($logon,$recovery) -Settings $taskSettings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        if (Get-ServiceProcess) { Write-Host '后台已启动，并已启用登录自动启动及每分钟恢复检查。'; return }
    }
    throw '后台未能启动。请运行 Doctor.cmd 查看诊断；不要反复扫码。'
}
function Login-Codex {
    Initialize-PrivateDataDirectory
    $previousCodexHome = $env:CODEX_HOME
    try {
        $env:CODEX_HOME = Join-Path $DataDir 'codex-home'
        & $codexPath login --device-auth
        if ($LASTEXITCODE -ne 0) { throw 'Codex 登录未完成。' }
    } finally { $env:CODEX_HOME = $previousCodexHome }
}
function Login-WeChat {
    Initialize-PrivateDataDirectory
    Stop-Bridge
    $startedAt = Get-Date
    $outLog = Join-Path $DataDir 'logs\login.out.log'
    $errLog = Join-Path $DataDir 'logs\login.err.log'
    $arguments = @('--import','tsx',(Join-Path $appRoot 'src\cli.ts'),'weixin','login','--state-dir',$DataDir)
    $quotedArguments = ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
    $loginProcess = Start-Process -FilePath $nodePath -ArgumentList $quotedArguments -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    Write-Host '正在生成微信登录二维码；图片生成后会自动打开。'
    $opened = $false
    while (!$loginProcess.HasExited) {
        if (!$opened) {
            $qr = Get-ChildItem -LiteralPath (Join-Path $DataDir 'weixin\login') -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|svg|webp|gif)$' -and $_.LastWriteTime -ge $startedAt.AddSeconds(-1) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($qr) {
                try {
                    Start-Process -FilePath $qr.FullName | Out-Null
                    Write-Host '二维码已打开，请用微信扫码确认。'
                } catch { Write-Host ('二维码图片已生成，请手动打开：' + $qr.FullName) }
                $opened = $true
            }
        }
        Start-Sleep -Milliseconds 500
        $loginProcess.Refresh()
    }
    $loginProcess.WaitForExit()
    if ($loginProcess.ExitCode -ne 0) { throw '微信登录未完成或二维码超时，请重新运行 5-Login-WeChat.cmd。' }
    Write-Host '微信登录已保存。正常重启无需重新扫码。'
    if (Test-Path -LiteralPath $configPath) { Start-Bridge }
}

try {
    foreach ($dependency in @($nodePath,$codexPath,$hostPath)) {
        if (!(Test-Path -LiteralPath $dependency -PathType Leaf)) { throw '发行包不完整，请完整解压后运行。' }
    }
    if ($DryRun) {
        [pscustomobject]@{ action=$Action; packageComplete=$true; dataDirectory=$DataDir; taskName=$taskName; usesCurrentUser=$true; requiresAdministrator=$false; modifiesSystem=$false } | ConvertTo-Json
        exit 0
    }
    switch ($Action) {
        'Setup' {
            Initialize-PrivateDataDirectory
            $existing = if (Test-Path -LiteralPath $configPath) { Read-Settings } else { $null }
            if (!$WorkspacePath) {
                $defaultWorkspace = if ($existing) { [string]$existing.workspace } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'CodexWechatWorkspace' }
                $answer = Read-Host "工作目录（回车使用 $defaultWorkspace）"
                $WorkspacePath = if ($answer) { $answer.Trim('"') } else { $defaultWorkspace }
            }
            $WorkspacePath = [System.IO.Path]::GetFullPath($WorkspacePath)
            if ($WorkspacePath -match '[\r\n]') { throw '工作目录无效。' }
            New-Item -ItemType Directory -Path $WorkspacePath -Force | Out-Null
            Stop-Bridge
            $permissions = if ($existing) { $existing.permissionsMode } else { 'default-permissions' }
            Write-Utf8 $configPath (([ordered]@{version=1;workspace=$WorkspacePath;permissionsMode=$permissions} | ConvertTo-Json) + "`n")
            Write-Host '配置已保存。发行版不固定模型，在微信用 /models、/model 选择。'
            if (!(Test-Path -LiteralPath (Join-Path $DataDir 'codex-home\auth.json'))) { Login-Codex }
            $accountFiles = @(Get-ChildItem -LiteralPath (Join-Path $DataDir 'weixin\accounts') -Filter '*.json' -ErrorAction SilentlyContinue | Where-Object Name -NotMatch '\.(sync|context-tokens)\.json$')
            if ($accountFiles.Count -ne 1) { Login-WeChat } else { Start-Bridge }
        }
        'Start' { Start-Bridge }
        'SaveConfig' {
            if (Get-ServiceProcess) { throw '请先停止后台，再保存工作目录或权限设置。' }
            if ([string]::IsNullOrWhiteSpace($WorkspacePath) -or ![IO.Path]::IsPathRooted($WorkspacePath) -or $WorkspacePath -match '[\r\n"]') { throw '请选择有效的绝对工作目录。' }
            $WorkspacePath = [IO.Path]::GetFullPath($WorkspacePath)
            Initialize-PrivateDataDirectory
            New-Item -ItemType Directory -Path $WorkspacePath -Force | Out-Null
            Write-Utf8 $configPath (([ordered]@{version=1;workspace=$WorkspacePath;permissionsMode=$PermissionsMode} | ConvertTo-Json) + "`n")
            Write-Host '配置已保存。'
        }
        'StatusJson' {
            $settings = if (Test-Path -LiteralPath $configPath) { Read-Settings } else { $null }
            $scheduled = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            $accounts = @(Get-ChildItem -LiteralPath (Join-Path $DataDir 'weixin\accounts') -Filter '*.json' -ErrorAction SilentlyContinue | Where-Object Name -NotMatch '\.(sync|context-tokens)\.json$')
            [ordered]@{
                running=[bool](Get-ServiceProcess)
                automaticStartup=[bool]($scheduled -and $scheduled.Settings.Enabled)
                codexLoginSaved=(Test-Path -LiteralPath (Join-Path $DataDir 'codex-home\auth.json'))
                wechatLoginSaved=($accounts.Count -eq 1)
                configured=[bool]$settings
                workspace=if($settings){[string]$settings.workspace}else{''}
                permissionsMode=if($settings){[string]$settings.permissionsMode}else{'default-permissions'}
            } | ConvertTo-Json -Compress
        }
        'LoginCodexGui' { Stop-Bridge; Login-Codex }
        'LoginWeChatGui' {
            Initialize-PrivateDataDirectory
            Stop-Bridge
            & $nodePath --import tsx (Join-Path $appRoot 'src\cli.ts') weixin login --state-dir $DataDir
            if ($LASTEXITCODE -ne 0) { throw '微信登录未完成。' }
        }
        'Stop' { Stop-Bridge; Write-Host '桥接已停止，自动恢复已停用。重新启动可恢复自动运行。' }
        'LoginCodex' { Stop-Bridge; Login-Codex; Write-Host '需要恢复桥接时运行 2-Start.cmd。' }
        'LoginWeChat' { Login-WeChat }
        'Status' {
            $process = Get-ServiceProcess
            $scheduled = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            [pscustomobject]@{ Running=[bool]$process; AutomaticStartup=[bool]($scheduled -and $scheduled.Settings.Enabled); TaskState=if($scheduled){[string]$scheduled.State}else{'NotInstalled'}; DataDirectory=$DataDir } | Format-List
        }
        'Doctor' {
            & $nodePath --version
            & $codexPath --version
            Write-Host ('配置存在：' + (Test-Path -LiteralPath $configPath))
            Write-Host ('Codex 登录文件存在：' + (Test-Path -LiteralPath (Join-Path $DataDir 'codex-home\auth.json')))
            Write-Host ('后台正在运行：' + [bool](Get-ServiceProcess))
            Write-Host '诊断只显示本地状态，不输出令牌、账号 ID 或聊天内容。'
            Write-Host ('日志目录：' + (Join-Path $DataDir 'logs'))
        }
        'OpenData' { Initialize-PrivateDataDirectory; Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList ('"' + $DataDir + '"') | Out-Null }
        'Uninstall' { Stop-Bridge; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue; Write-Host '后台任务已移除；本地登录、配置和历史已保留。' }
        'Test' {
            Initialize-PrivateDataDirectory
            $guiReport = Join-Path $DataDir 'logs\gui-selftest.json'
            $guiTest = Start-Process -FilePath (Join-Path $releaseRoot 'Codex-Wechat.exe') -ArgumentList ('--self-test ' + (Quote-Argument $guiReport)) -WindowStyle Hidden -PassThru
            if (!$guiTest.WaitForExit(30000)) {
                & "$env:WINDIR\System32\taskkill.exe" /PID $guiTest.Id /T /F | Out-Null
                throw '图形窗口自检超时。'
            }
            if ($guiTest.ExitCode -ne 0) { throw '图形窗口自检失败。' }
            Write-Host '图形窗口自检通过：14 项；未启动登录或访问网络。'
            Push-Location $appRoot
            try {
                $env:TZ = 'UTC'
                & $nodePath scripts/test.mjs test/platforms/weixin/official/media_crypto.test.ts test/platforms/weixin/official/media_download.test.ts test/platforms/weixin/plugin.test.ts test/runtime/weixin_inbound_drafts.test.ts test/runtime/weixin_conversation_router.test.ts test/runtime/managed_restart.test.ts test/runtime/weixin_bridge_runtime.test.ts test/platforms/weixin/poller.test.ts
                if ($LASTEXITCODE -ne 0) { throw '自检失败。' }
            } finally { Pop-Location }
        }
    }
} catch {
    Write-Host ('操作失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
