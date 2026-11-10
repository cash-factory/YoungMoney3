param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & $Python -m PyInstaller --clean --noconfirm YoungMoney3.spec
    if ($LASTEXITCODE -ne 0) { throw 'Connector build failed.' }
    $exe = Join-Path $PSScriptRoot 'dist\YoungMoney3 Connector.exe'
    $report = Join-Path $PSScriptRoot 'dist\smoke-test.json'
    $process = Start-Process -FilePath $exe -ArgumentList @('--smoke-test', ('"' + $report + '"')) -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(30000)) { $process.Kill(); throw 'Packaged connector smoke test timed out.' }
    if ($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $report)) { throw 'Packaged connector smoke test failed.' }
    $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'dist\SHA256SUMS.txt'), ($hash + '  YoungMoney3 Connector.exe' + [Environment]::NewLine))
    $zip = Join-Path $PSScriptRoot 'dist\YoungMoney3-Connector.zip'
    Compress-Archive -LiteralPath $exe, (Join-Path $PSScriptRoot 'README.md'), (Join-Path $PSScriptRoot 'dist\SHA256SUMS.txt') -DestinationPath $zip -Force
    Write-Output "Built and verified $exe"
    Write-Output "Download archive: $zip"
} finally { Pop-Location }
