param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1') -Test
$executable = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'bin\GameDeckHost.exe')).Path
$manifestPath = Join-Path $PSScriptRoot 'com.gamedeck.windows.json'
$manifestJson = @{ name='com.gamedeck.windows'; description='GameDeck validated window geometry and frame helper'; path=$executable; type='stdio'; allowed_origins=@('chrome-extension://' + $ExtensionId + '/') } | ConvertTo-Json
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.gamedeck.windows'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Output 'Registered for this Windows user and the specified extension only. No administrator rights required. Enable Immersive mode in GameDeck preferences.'
