# YoungMoney3 staged EXE swap helper. Runs only after a verified safe connector shutdown.
# Never reads, moves or deletes broker profiles, Credential Manager, capture.db or user settings.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ParentPid,
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Candidate,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedHash,
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+(?:-rc\d+)?$')][string]$Version,
  [Parameter(Mandatory=$true)][string]$ResultFile,
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'
$backup = $Target + '.previous'
$incoming = $Target + '.incoming'
$swapped = $false
$launched = $false
$phase = 'validate'

function Write-Outcome([string]$status, [string]$code) {
  $record = @{
    version = $Version
    status = $status
    code = $code
    recorded_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Compress
  $tmp = $ResultFile + '.tmp'
  [IO.File]::WriteAllText($tmp, $record, [Text.Encoding]::UTF8)
  Move-Item -LiteralPath $tmp -Destination $ResultFile -Force
}

try {
  $Target = [IO.Path]::GetFullPath($Target)
  $Candidate = [IO.Path]::GetFullPath($Candidate)
  $ResultFile = [IO.Path]::GetFullPath($ResultFile)
  if (![IO.Path]::IsPathRooted($Target) -or [IO.Path]::GetExtension($Target).ToLowerInvariant() -ne '.exe') {
    throw 'invalid-target'
  }
  if (!(Test-Path -LiteralPath $Target -PathType Leaf) -or !(Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    throw 'missing-executable'
  }
  if ($Target -eq $Candidate) { throw 'invalid-candidate' }
  if ((Get-Item -LiteralPath $Target).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'linked-target'
  }
  if ((Get-Item -LiteralPath $Candidate).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'linked-candidate'
  }
  if ((Get-FileHash -LiteralPath $Candidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash.ToLowerInvariant()) {
    throw 'checksum-mismatch'
  }

  $phase = 'wait-parent'
  # Do not replace a running executable; it would interrupt capture or copy consent.
  try { Wait-Process -Id $ParentPid -Timeout 90 -ErrorAction SilentlyContinue } catch { }
  if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw 'connector-still-running' }
  # A second integrity check closes the window between a download and process exit.
  $phase = 'prepare'
  Copy-Item -LiteralPath $Candidate -Destination $incoming -Force
  if ((Get-FileHash -LiteralPath $incoming -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash.ToLowerInvariant()) {
    throw 'checksum-mismatch'
  }

  # These two renames happen on the same volume. Keep the old EXE for rollback.
  $phase = 'backup'
  if (Test-Path -LiteralPath $backup -PathType Leaf) {
    Remove-Item -LiteralPath $backup -Force
  }
  Move-Item -LiteralPath $Target -Destination $backup
  try {
    Move-Item -LiteralPath $incoming -Destination $Target
    $swapped = $true
  } catch {
    Move-Item -LiteralPath $backup -Destination $Target -Force
    throw 'replacement-failed'
  }

  $phase = 'receipt'
  if ($NoRestart) {
    Write-Outcome 'installed' 'manual-restart'
    exit 0
  }
  $phase = 'relaunch'
  try {
    $child = Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target) -PassThru
    $launched = $true
    # This verifies a stable launch, not broker capture. Broker recovery is separately audited.
    Start-Sleep -Seconds 16
    $child.Refresh()
    if ($child.HasExited) { throw 'new-connector-exited' }
  } catch {
    throw 'startup-failed'
  }
  Write-Outcome 'installed' 'restart-launched'
  exit 0
} catch {
  $code = if ($_.Exception.Message -match '^[a-z-]{3,40}$') { $_.Exception.Message } else { 'failed-' + $phase }
  if ($env:CI -eq 'true') { Write-Output ('Updater test phase: ' + $phase + ', error type: ' + $_.Exception.GetType().Name) }
  try {
    if ($swapped -and (Test-Path -LiteralPath $backup -PathType Leaf)) {
      if (Test-Path -LiteralPath $Target -PathType Leaf) {
        Remove-Item -LiteralPath $Target -Force
      }
      Move-Item -LiteralPath $backup -Destination $Target
      if (!$NoRestart) {
        Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target) | Out-Null
      }
      Write-Outcome 'rolled-back' $code
    } else {
      Write-Outcome 'failed' $code
    }
  } catch {
    # Keep any .previous file intact for manual recovery; do not touch user data.
    try { Write-Outcome 'failed' 'recovery-needs-attention' } catch {}
  }
  exit 1
} finally {
  try { if (Test-Path -LiteralPath $incoming -PathType Leaf) { Remove-Item -LiteralPath $incoming -Force } } catch { }
}
