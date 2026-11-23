"""Rebuild the public Python-source fallback ZIP from canonical connector files.

Use after editing a connector source. CI intentionally checks byte equality
rather than silently modifying the checked-in release artifact.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "README.md": "connector/README.md",
    "connect.py": "connector/connect.py",
    "version.py": "connector/version.py",
    "ledger.py": "connector/ledger.py",
    "history_range.py": "connector/history_range.py",
    "cash_history.py": "connector/cash_history.py",
    "lifecycle.py": "connector/lifecycle.py",
    "connector_gui.py": "connector/connector_gui.py",
    "studio_ui.py": "connector/studio_ui.py",
    "managed_accounts.py": "connector/managed_accounts.py",
    "terminal_launch.py": "connector/terminal_launch.py",
    "managed_mcp.py": "connector/managed_mcp.py",
    "spec_evidence.py": "connector/spec_evidence.py",
    "recovery.py": "connector/recovery.py",
    "presence.py": "connector/presence.py",
    "pc_identity.py": "connector/pc_identity.py",
    "sessions.py": "connector/sessions.py",
    "terminal_factory.py": "connector/terminal_factory.py",
    "concurrent_capture.py": "connector/concurrent_capture.py",
    "requirements.txt": "connector/requirements.txt",
    "assets/connector-scene.svg": "connector/assets/connector-scene.svg",
}


def main():
    dest = ROOT / "public" / "mt5-connector.zip"
    with ZipFile(dest, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for target, source in FILES.items():
            # Text is canonical LF regardless of checkout platform/autocrlf.
            # Fixed metadata makes the source fallback reproducible.
            info = ZipInfo(target, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / source).read_bytes().replace(b"\r\n", b"\n"))
    print("Built", dest, "with", len(FILES), "canonical connector files.")


if __name__ == "__main__":
    main()
