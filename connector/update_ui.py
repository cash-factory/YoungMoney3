"""User-facing update controls for the classic Windows connector.

All network work stays off the Tk thread. Only a verified downloaded executable
can be handed to the small bundled helper, and only *after* the capture and copy
workers have stopped. No update UI operation edits broker/account records.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import messagebox, ttk

from update_service import check_for_update, stage_update, UpdateError, _hash_file

CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
CHECK_AFTER_START_MS = 9_000
CREATE_NO_WINDOW = 0x08000000


class ConnectorUpdateUI:
    def _initialize_updates(self):
        self._update_release = None
        self._update_staged = None
        self._update_checking = False
        self._update_downloading = False
        self._update_install_pending = False
        self._update_installer_launched = False
        self.update_status_var = tk.StringVar(value="Checking is available in this connector.")
        self.update_progress_var = tk.IntVar(value=0)
        self.update_notes_var = tk.StringVar(value="New versions include a short, plain-language summary.")
        self.update_auto_var = tk.BooleanVar(value=self._read_auto_setting())
        self._update_last_result = self._read_last_result()

    def _read_auto_setting(self):
        try:
            path = self._update_preferences_path()
            value = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(value, dict) and type(value.get("auto")) is bool:
                return value["auto"]
        except (OSError, ValueError, TypeError):
            pass
        return True

    def _update_preferences_path(self):
        return self.update_root / "update-preferences.json"

    def _read_last_result(self):
        try:
            path = self.update_root / "updates" / "last-result.json"
            value = json.loads(path.read_text(encoding="utf-8-sig"))
            if (isinstance(value, dict) and value.get("status") in
                    {"installed", "rolled-back", "failed"}):
                return value
        except (OSError, ValueError, TypeError):
            pass
        return None

    def _save_update_preference(self):
        try:
            path = self._update_preferences_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"auto": bool(self.update_auto_var.get())}), encoding="utf-8")
            os.replace(tmp, path)
        except OSError:
            self.update_status_var.set("Your update preference could not be saved.")
        if self.update_auto_var.get() and self._update_release and not self._update_staged:
            self._download_update()

    def _build_update_controls(self, page):
        # Called after the main app has created its current page and theme.
        from enterprise_theme import COLORS
        box = self._card(page, 21)
        box.pack(fill="x", pady=(14, 0))
        self._label(box, "SOFTWARE UPDATES", size=9, bold=True,
                    color=COLORS["red"]).pack(anchor="w", pady=(0, 6))
        self._label(box, "Keep Signal Desk current", size=16, bold=True).pack(anchor="w")
        self._label(box, textvar=self.update_status_var, size=10,
                    color=COLORS["muted"], wrap=780).pack(anchor="w", pady=(8, 10))
        self.update_bar = ttk.Progressbar(
            box, style="YM.Horizontal.TProgressbar",
            maximum=100, variable=self.update_progress_var, mode="determinate"
        )
        self.update_bar.pack(fill="x", pady=(0, 11))
        self._label(box, textvar=self.update_notes_var, size=9,
                    color=COLORS["muted"], wrap=770).pack(anchor="w", pady=(0, 14))
        # No modal spam: clear, persistent state and a manual control.
        buttons = self._actions(box, [
            ("Check for updates", lambda: self.check_updates(manual=True), {}),
            ("Install & restart", self.install_update_now, {"primary": True}),
        ])
        self.update_check_button, self.update_install_button = buttons.buttons
        self.update_install_button.configure(state="disabled")
        tk.Checkbutton(
            box, text="Download automatically · install at a safe restart",
            variable=self.update_auto_var, command=self._save_update_preference,
            font=("Segoe UI", 9), bg=COLORS["surface"], fg=COLORS["text"],
            selectcolor=COLORS["surface"], activebackground=COLORS["surface"],
            activeforeground=COLORS["text"], highlightthickness=0,
            takefocus=True,
        ).pack(anchor="w", pady=(14, 0))
        if self._update_last_result:
            summary = self._update_last_result.get("status")
            version = self._update_last_result.get("version")
            if (isinstance(version, str) and len(version) <= 30 and
                    summary == "installed"):
                self.update_status_var.set(f"Updated to {version}. Version checks run automatically.")
            elif summary in {"failed", "rolled-back"}:
                self.update_status_var.set(
                    "An earlier update could not finish. Your previous connector was kept. "
                    "Choose Check for updates to retry."
                )

    def _start_update_schedule(self):
        if not (sys.platform == "win32" and getattr(sys, "frozen", False)):
            self.update_status_var.set("Automatic installation is available in the installed Windows application.")
            return
        self.root.after(CHECK_AFTER_START_MS, self._scheduled_update_check)

    def _scheduled_update_check(self):
        if self.stopping:
            return
        self.check_updates(manual=False)
        self.root.after(CHECK_INTERVAL_MS, self._scheduled_update_check)

    def check_updates(self, *, manual=False):
        if self._update_checking or self._update_downloading or self.stopping:
            if manual:
                self.update_status_var.set("An update check or download is already running.")
            return
        self._update_checking = True
        self.update_status_var.set("Checking for a newer connector version…")
        self.update_check_button.configure(state="disabled")

        def worker():
            from version import VERSION
            try:
                release = check_for_update(VERSION)
                self.events.put({"state": "update-check-result",
                                 "release": release, "manual": manual})
            except UpdateError:
                self.events.put({"state": "update-check-error"})

        threading.Thread(target=worker, name="YMFX-update-check", daemon=True).start()

    def _download_update(self):
        if not self._update_release or self._update_downloading or self._update_staged:
            return
        self._update_downloading = True
        release = self._update_release
        self.update_status_var.set(f"Version {release.version} is downloading securely…")

        def worker():
            last_percent = -5
            def progress(percent):
                nonlocal last_percent
                if percent == 100 or percent - last_percent >= 5:
                    last_percent = percent
                    self.events.put({"state": "update-progress", "percent": percent})
            try:
                path = stage_update(release, self.update_root, progress=progress)
                self.events.put({"state": "update-staged", "path": path, "release": release})
            except UpdateError:
                self.events.put({"state": "update-download-error"})

        threading.Thread(target=worker, name="YMFX-update-download", daemon=True).start()

    def _update_is_safe(self):
        # Even if no copy thread currently exists, an authorized follower may be
        # armed remotely. Fail closed whenever *any* local copy consent exists.
        if any(bool(value) for value in self.copy_authorization_by_slot.values()):
            return False
        return not (self.copy_worker and self.copy_worker.is_alive())

    def install_update_now(self):
        if self._update_staged is None or self._update_release is None:
            self.update_status_var.set("No verified update is ready to install.")
            return
        if not (sys.platform == "win32" and getattr(sys, "frozen", False)):
            self.update_status_var.set("Installation is available only from the installed Windows application.")
            return
        if not self._update_is_safe():
            messagebox.showwarning(
                "Update postponed",
                "This account has copying permission or an active copying worker. "
                "Disable the relevant follower permissions first. An update must "
                "never interrupt live-copy operations.",
                parent=self.root,
            )
            return
        if not messagebox.askyesno(
            "Install connector update",
            f"Install verified version {self._update_release.version} now? "
            "The connector will stop capture safely and restart automatically. "
            "Your saved accounts and journal records stay in place.",
            parent=self.root,
        ):
            return
        self._update_install_pending = True
        self.close()

    def _handle_update_event(self, item):
        state = item.get("state", "")
        if not isinstance(state, str) or not state.startswith("update-"):
            return False
        if state == "update-check-result":
            self._update_checking = False
            self.update_check_button.configure(state="normal")
            release = item.get("release")
            if release is None:
                self.update_status_var.set("You're up to date. Checks continue automatically.")
            else:
                self._update_release = release
                bullet = "\n".join("• " + line for line in release.notes)
                self.update_notes_var.set(
                    (release.public_summary() + ("\n" + bullet if bullet else
                     "\nWhat's changed: see the release notes in the dashboard."))
                )
                self.update_status_var.set(
                    f"Version {release.version} is available. "
                    "No existing accounts or trades need to be imported again."
                )
                if self.update_auto_var.get():
                    self._download_update()
                self._log(f"Software update {release.version} is available.")
        elif state == "update-check-error":
            self._update_checking = False
            self.update_check_button.configure(state="normal")
            self.update_status_var.set(
                "The update service couldn't be reached. Your connector will keep working."
            )
        elif state == "update-progress":
            self.update_progress_var.set(max(0, min(100, int(item.get("percent", 0)))))
        elif state == "update-staged":
            self._update_downloading = False
            release = item.get("release")
            path = item.get("path")
            if release == self._update_release and isinstance(path, Path) and path.is_file():
                self._update_staged = path
                self.update_progress_var.set(100)
                self.update_install_button.configure(state="normal")
                self.update_status_var.set(
                    f"Version {release.version} is ready. "
                    "It will install when the connector closes safely, or choose Install & restart."
                    if self.update_auto_var.get() else
                    f"Version {release.version} is ready. Choose Install & restart when convenient."
                )
                self._log("Software update verified and ready.")
        elif state == "update-download-error":
            self._update_downloading = False
            self.update_progress_var.set(0)
            self.update_status_var.set(
                "The update download failed verification or was interrupted. "
                "Nothing was installed. Check again to retry."
            )
        return True

    def _maybe_launch_updater_on_close(self):
        """Call only after capture and copy workers have stopped successfully."""
        if self._update_installer_launched:
            return
        manual = self._update_install_pending
        automatic = self.update_auto_var.get()
        if not (manual or automatic) or not self._update_is_safe():
            return
        if not (self._update_release and self._update_staged):
            return
        if not (sys.platform == "win32" and getattr(sys, "frozen", False)):
            return
        release = self._update_release
        candidate = self._update_staged
        try:
            if _hash_file(candidate) != release.sha256:
                raise UpdateError("The staged update failed its final verification.")
            if candidate.stat().st_size != release.size:
                raise UpdateError("The staged update size was not accepted.")
            # The script is bundled in the *installed* EXE; do not fetch commands
            # from release metadata. Copy it to the user's update directory.
            script = Path(getattr(sys, "_MEIPASS")) / "update_apply.ps1"
            if not script.is_file():
                raise UpdateError("This connector has no update installer helper.")
            helper = candidate.parent / "update_apply.ps1"
            helper.write_bytes(script.read_bytes())
            result = self.update_root / "updates" / "last-result.json"
            args = [
                "powershell.exe", "-NoProfile", "-NonInteractive",
                "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
                "-File", str(helper),
                "-ParentPid", str(os.getpid()),
                "-Target", str(Path(sys.executable).resolve()),
                "-Candidate", str(candidate),
                "-ExpectedHash", release.sha256,
                "-Version", release.version,
                "-ResultFile", str(result),
            ]
            subprocess.Popen(args, close_fds=True, creationflags=CREATE_NO_WINDOW)
            self._update_installer_launched = True
        except (OSError, UpdateError, KeyError, AttributeError):
            # Keep the old connector executable and the staged file intact.
            self._log("Automatic update could not start; installed version is unchanged.")
