$ErrorActionPreference = 'Stop'
Write-Output 'Exit immersive mode in GameDeck before unregistering this helper.'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.gamedeck.windows'
if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
Write-Output 'Native messaging registration removed. Source and recovery journals were preserved.'
