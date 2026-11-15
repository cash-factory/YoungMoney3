from pathlib import Path
from zipfile import ZipFile

root=Path(__file__).resolve().parent.parent
mapping={'README.md':'connector/README.md','connect.py':'connector/connect.py','ledger.py':'connector/ledger.py','lifecycle.py':'connector/lifecycle.py','connector_gui.py':'connector/connector_gui.py','sessions.py':'connector/sessions.py','terminal_factory.py':'connector/terminal_factory.py','concurrent_capture.py':'connector/concurrent_capture.py','requirements.txt':'connector/requirements.txt'}
with ZipFile(root/'public/mt5-connector.zip') as archive:
    assert archive.testzip() is None, 'Connector ZIP is corrupt'
    assert set(archive.namelist()) == set(mapping), 'Connector ZIP contents differ from supported package'
    for packaged,source in mapping.items():
        assert archive.read(packaged)==(root/source).read_bytes(), f'Stale connector ZIP: {packaged}'
print('Distributed MT5 ZIP matches all checked-in connector sources.')
