"""Build a versionless, current Windows MT5 Python source fallback.

This is an explicitly curated source distribution. It never includes broker
credentials, user terminal data, the local SQLite outbox, test fixtures or an
arbitrary directory traversal. Build the ZIP immediately before web bundling.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "README.md": "connector/README.md",
    "connect.py": "connector/connect.py",
    "ledger.py": "connector/ledger.py",
    "history_range.py": "connector/history_range.py",
    "cash_history.py": "connector/cash_history.py",
    "lifecycle.py": "connector/lifecycle.py",
    "connector_gui.py": "connector/connector_gui.py",
    "studio_ui.py": "connector/studio_ui.py",
    "managed_accounts.py": "connector/managed_accounts.py",
    "presence.py": "connector/presence.py",
    "pc_identity.py": "connector/pc_identity.py",
    "sessions.py": "connector/sessions.py",
    "terminal_factory.py": "connector/terminal_factory.py",
    "concurrent_capture.py": "connector/concurrent_capture.py",
    "requirements.txt": "connector/requirements.txt",
    "assets/connector-scene.svg": "connector/assets/connector-scene.svg",
}
MAX_SOURCE_BYTES = 4 * 1024 * 1024


def normalized_files(root=ROOT):
    result = {}
    for packaged, relative in FILES.items():
        source = root / relative
        if source.is_symlink() or not source.is_file():
            raise RuntimeError("Connector source missing or unsafe: " + relative)
        data = source.read_bytes().replace(b"\r\n", b"\n")
        if not data or len(data) > MAX_SOURCE_BYTES:
            raise RuntimeError("Connector source has invalid size: " + relative)
        result[packaged] = data
    return result


def generate_archive(destination: Path, root=ROOT):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    contents = normalized_files(root)
    fd, intermediate = tempfile.mkstemp(prefix=".mt5-source-", suffix=".zip",
                                         dir=str(destination.parent))
    os.close(fd)
    try:
        with ZipFile(intermediate, "w") as archive:
            for packaged, data in contents.items():
                info = ZipInfo(packaged, (1980, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
        with ZipFile(intermediate) as archive:
            if archive.testzip() is not None:
                raise RuntimeError("Generated MT5 connector ZIP failed its integrity check.")
            if set(archive.namelist()) != set(contents):
                raise RuntimeError("Generated MT5 connector ZIP has unexpected files.")
            for name, data in contents.items():
                if archive.read(name) != data:
                    raise RuntimeError("Connector source changed during packaging: " + name)
        os.replace(intermediate, destination)
    finally:
        if os.path.exists(intermediate):
            os.unlink(intermediate)
    return destination


if __name__ == "__main__":
    file = generate_archive(ROOT / "public" / "mt5-connector.zip")
    print("Generated curated MT5 connector source fallback:", file.relative_to(ROOT))
