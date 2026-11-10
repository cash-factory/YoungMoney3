from pathlib import Path
from zipfile import ZipFile

root=Path(__file__).resolve().parent.parent
names=['README.md','connect.py','ledger.py','metrics.py','desktop.py','app_runtime.py','requirements.txt','requirements-build.txt','requirements-build.lock.txt','YoungMoney3.spec','build.ps1']
mapping={name:'connector/'+name for name in names}
with ZipFile(root/'public/mt5-connector.zip') as archive:
    assert archive.testzip() is None, 'Connector ZIP is corrupt'
    assert set(archive.namelist()) == set(mapping), 'Connector ZIP contents differ from supported package'
    for packaged,source in mapping.items():
        assert archive.read(packaged)==(root/source).read_bytes(), f'Stale connector ZIP: {packaged}'
print('Distributed MT5 ZIP matches all checked-in connector sources.')
