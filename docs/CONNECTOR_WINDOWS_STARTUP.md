# Windows connector startup repair (staging only)

The rc1 executable failed in PyInstaller's pre-entrypoint tkinter runtime hook:
`_tcl_data` was missing from the extracted application. Python source tests did
not exercise that hook. Changing application startup paths cannot repair missing
files before the application entrypoint runs.

The rc2 builder asks its own Tcl/Tk interpreter for the script directories,
requires `init.tcl` and `tk.tcl`, explicitly bundles their trees at `_tcl_data`
and `_tk_data`, and inspects the finished one-file archive for both sentinels,
the `_tkinter` extension, and Tcl/Tk DLLs. PyInstaller is pinned to 6.16.0.
The isolated launch also exposed NumPy missing from the native MT5 extension's
dependencies; the builder explicitly collects NumPy and its native libraries.
See the upstream [runtime hook](https://github.com/pyinstaller/pyinstaller/blob/v6.16.0/PyInstaller/hooks/rthooks/pyi_rth__tkinter.py).

Publication depends on tests, archive inspection, and a separate Windows VM job
that downloads only the packaged artifact, checks its checksum, removes Python
and Tcl/Tk environment overrides and PATH entries, isolates the user profile,
and launches the executable twice from outside the source tree. The frozen
smoke mode constructs the actual GUI and runs its event loop, checks that Tcl/Tk
loaded bundled scripts, and writes success evidence without pairing, starting
capture, opening MT5, or writing connector preferences. A timeout, runtime-hook
dialog, missing evidence, nonzero exit, external Tcl/Tk path, or state write
blocks publication. The hosted Windows image has preinstalled software; this
is isolation testing, not a claim of full consumer clean-PC acceptance.

Release guards retain the same staging branch, same-repository non-draft PR,
explicit dispatch confirmation, staging environment, and prerelease-only policy.
Only the final publication job has write permission. Existing releases and tags
cannot be reused; API failures stop publication. rc1 is retained unchanged.
No main merge, production deployment, database changes, trading commands, or
live-account enablement are part of this repair. Real demo-broker reconciliation,
previous CLI pairing upgrade, and backup/restore acceptance remain outstanding.

## Updating on Windows

1. Close the old connector. Keep existing `%LOCALAPPDATA%\YMFX` data and Windows
   Credential Manager entries; do not reset or re-pair an already paired PC.
2. Open the new `staging-connector-v0.2.0-rc2` GitHub release and download the
   executable, its `.sha256` file, and `build-manifest.json` from that same release.
   GitHub may replace spaces in asset names with periods.
3. In PowerShell, open the download folder and run (adjust the filename to match):

   ```powershell
   $exe = '.\YoungMoney3.Connector.exe'
   $expected = ((Get-Content "$exe.sha256" -Raw).Trim() -split '\s+')[0]
   $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
   if ($expected -notmatch '^[0-9a-fA-F]{64}$' -or $actual -ine $expected) { throw 'Checksum mismatch: do not run' }
   'Checksum verified'
   ```

4. Launch the updated executable. Python/Tcl/Tk installation is not required.
   This remains an unsigned Windows x64 prerelease. Confirm the GUI opens without
   the Tcl error, then pair an unpaired PC using a fresh staging dashboard code.
   Select the dedicated demo terminals and start syncing. Keep broker timezone
   confirmation and the existing 30-day default / 90-day maximum history policy.
5. If startup still fails, retain the exact error, Windows version, release tag
   and checksum. Do not share pairing codes, credentials, or local connector data.
