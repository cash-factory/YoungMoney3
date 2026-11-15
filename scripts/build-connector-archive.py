"""Rebuild the public Python-source fallback ZIP from canonical connector files.

Use after editing a connector source. CI intentionally checks byte equality
rather than silently modifying the checked-in release artifact.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "README.md": "connector/README.md",
    "connect.py": "connector/connect.py",
    "ledger.py": "connector/ledger.py",
    "lifecycle.py": "connector/lifecycle.py",
    "connector_gui.py": "connector/connector_gui.py",
    "sessions.py": "connector/sessions.py",
    "requirements.txt": "connector/requirements.txt",
}


def main():
    dest = ROOT / "public" / "mt5-connector.zip"
    with ZipFile(dest, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for target, source in FILES.items():
            archive.write(ROOT / source, target)
    print("Built", dest, "with", len(FILES), "canonical connector files.")


if __name__ == "__main__":
    main()
