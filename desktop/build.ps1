param([switch]$Test)
$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$packageDirectory = Join-Path $projectDirectory 'vendor\webview2'
$outputDirectory = Join-Path $projectDirectory 'bin'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is missing.' }
if (!(Test-Path -LiteralPath $packageDirectory)) { throw 'Restore Microsoft.Web.WebView2 1.0.4314.35 from NuGet into desktop/vendor/webview2 first. See README.md.' }
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$framework = Join-Path $packageDirectory 'lib\net462'
if (!(Test-Path -LiteralPath $framework)) { $framework = Join-Path $packageDirectory 'lib\net45' }
foreach ($library in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $framework $library) -Destination $outputDirectory -Force
}
Copy-Item -LiteralPath (Join-Path $packageDirectory 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $outputDirectory -Force
Copy-Item -LiteralPath (Join-Path $packageDirectory 'LICENSE.txt') -Destination (Join-Path $outputDirectory 'WebView2-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $packageDirectory 'NOTICE.txt') -Destination (Join-Path $outputDirectory 'WebView2-NOTICE.txt') -Force
$references = @('/r:System.dll','/r:System.Core.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll',('/r:' + (Join-Path $outputDirectory 'Microsoft.Web.WebView2.Core.dll')),('/r:' + (Join-Path $outputDirectory 'Microsoft.Web.WebView2.WinForms.dll')))
& $compiler /nologo /target:winexe /platform:x64 /optimize+ ('/out:' + (Join-Path $outputDirectory 'Saturday.exe')) ('/win32manifest:' + (Join-Path $projectDirectory 'app.manifest')) @references (Join-Path $projectDirectory 'WallModel.cs') (Join-Path $projectDirectory 'Saturday.cs')
if ($LASTEXITCODE -ne 0) { throw 'Saturday compilation failed.' }
Copy-Item -LiteralPath (Join-Path $projectDirectory 'Saturday.exe.config') -Destination $outputDirectory -Force
if ($Test) {
    & $compiler /nologo /target:exe /platform:x64 ('/out:' + (Join-Path $outputDirectory 'Saturday.Tests.exe')) /r:System.Drawing.dll /r:System.Core.dll (Join-Path $projectDirectory 'WallModel.cs') (Join-Path $projectDirectory 'Tests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed.' }
    & (Join-Path $outputDirectory 'Saturday.Tests.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Native controller tests failed.' }
}
Write-Output (Join-Path $outputDirectory 'Saturday.exe')
