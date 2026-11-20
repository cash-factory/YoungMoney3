# Build only project source and installed package dependencies. Local state is outside the bundle.
from PyInstaller.utils.hooks import collect_submodules

hidden = collect_submodules('keyring.backends') + collect_submodules('cryptography')
hidden += ['connect', 'ledger', 'app_runtime', 'metrics', 'MetaTrader5', 'numpy', 'win32ctypes.pywin32']
a = Analysis(['desktop.py'], pathex=[SPECPATH], binaries=[], datas=[], hiddenimports=hidden,
             hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=['pytest', 'unittest'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='YoungMoney3 Connector',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=False,
          disable_windowed_traceback=True)
