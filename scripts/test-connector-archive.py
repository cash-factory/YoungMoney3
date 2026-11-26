"""Check the current source distribution, never a potentially stale committed binary."""
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

from build_connector_source_archive import FILES, ROOT, generate_archive, normalized_files


def verify(path):
    expected = normalized_files()
    with ZipFile(path) as archive:
        assert archive.testzip() is None, "Connector ZIP is corrupt"
        assert set(archive.namelist()) == set(FILES), "Unexpected file in connector source ZIP"
        assert all(entry.create_system == 3 for entry in archive.infolist()), (
            "Connector ZIP metadata must be identical on Windows and Linux"
        )
        for packaged, source in FILES.items():
            assert archive.read(packaged) == expected[packaged], (
                "Stale connector source distribution: " + source
            )


if "--check-dist" in sys.argv:
    built = ROOT / "dist" / "mt5-connector.zip"
    assert built.is_file(), "Web build did not publish the connector source fallback"
    verify(built)
    print("Built web asset includes the exact current connector source ZIP.")
else:
    with tempfile.TemporaryDirectory() as temp:
        generated = generate_archive(Path(temp) / "mt5-connector.zip")
        verify(generated)
    print("Connector source generator produces an exact, curated and validated ZIP.")
