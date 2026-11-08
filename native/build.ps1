param([switch]$Test)
$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required.' }
$outputDirectory = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$executable = Join-Path $outputDirectory 'GameDeckHost.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Core.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll ('/out:' + $executable) (Join-Path $PSScriptRoot 'GameDeckHost.cs') (Join-Path $PSScriptRoot 'ScoreOverlay.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native helper compilation failed.' }
if ($Test) { & $executable --self-test; if ($LASTEXITCODE -ne 0) { throw 'Native self-test failed.' } }
Write-Output $executable
