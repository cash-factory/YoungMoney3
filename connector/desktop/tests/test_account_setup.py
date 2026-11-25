"""Desktop account setup: no raw paths, passwords or automatic monitoring."""
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))

class Store:
    def __init__(self,path):self.records=[];self.path=Path(path)
    def snapshot(self):return [dict(x) for x in self.records]
    def add(self,path,name='',*,enabled=True):
        item={'id':'locally-created','terminal':str(path),'name':name,'enabled':enabled}
        self.records.append(item);return dict(item)
    def all_terminals(self):return [x['terminal'] for x in self.records]
    def active_terminals(self):return [x['terminal'] for x in self.records if x['enabled']]
    def armed_terminal(self):return None
    def set_enabled(self,key,value):
        for x in self.records:
            if x['id']==key:x['enabled']=value

sys.modules['sessions']=types.SimpleNamespace(SessionStore=Store)
from desktop_bridge import Bridge

class AccountSetupTests(unittest.TestCase):
    def test_add_account_creates_isolated_disabled_session_and_visible_login(self):
        with tempfile.TemporaryDirectory() as root:
            exe=Path(root)/'MT5 Installation'/'terminal64.exe'
            exe.parent.mkdir();exe.write_bytes(b'MT5')
            target=Path(root)/'YMFX Account'/'terminal64.exe'
            target.parent.mkdir();target.write_bytes(b'YMFX')
            (target.parent/'.ym-managed.json').write_text('{"kind":"youngmoney3-portable-mt5"}')
            calls=[]
            def fake_copy(source,managed,label,*,broker_directory=None,cancel=None):
                calls.append(('copy',str(source),label,broker_directory));return target
            def fake_open(path):calls.append(('open',str(path)))
            bridge=Bridge(Path(root)/'prefs.json',pairing_check=lambda:False)
            bridge._sources={'opaque-source':(str(exe),None)}
            with patch.dict(sys.modules,{
                'terminal_factory':types.SimpleNamespace(create_terminal=fake_copy),
                'terminal_launch':types.SimpleNamespace(open_managed_terminal=fake_open) }):
                accepted=bridge.dispatch('add_account',{'source_id':'opaque-source','name':'My Trading Account'})
                self.assertTrue(accepted['accepted'])
                bridge._setup_thread.join(timeout=5)
                self.assertFalse(bridge._setup_thread.is_alive())
                self.assertEqual(bridge.snapshot()['setup']['status'],'awaiting-login')
                self.assertEqual(len(bridge.snapshot()['sessions']),1)
                self.assertFalse(bridge.snapshot()['sessions'][0]['enabled'])
                self.assertIsNone(bridge.snapshot()['sessions'][0]['login'])
                self.assertEqual(calls[0][0],'copy')
                self.assertEqual(calls[1],('open',str(target)))
                self.assertNotIn(str(exe),str(bridge.snapshot()))
                self.assertNotIn(str(target),str(bridge.snapshot()))
    def test_reject_unscanned_program_paths_and_trade_authority(self):
        bridge=Bridge(Path('/tmp/ymfx-new-account-test.json'),pairing_check=lambda:False)
        with self.assertRaisesRegex(ValueError,'Scan MT5'):
            bridge.dispatch('add_account',{'source_id':'C:\\fake\\terminal64.exe','name':'Test Account'})
        for op in ('trade','copy_arm','execute_order','capture_unselected','connect_broker'):
            with self.assertRaisesRegex(ValueError,'Unsupported'):
                bridge.dispatch(op,{})
    def test_broker_discovery_does_not_fabricate_logged_in_identity(self):
        with tempfile.TemporaryDirectory() as root:
            bridge=Bridge(Path(root)/'prefs.json',pairing_check=lambda:False)
            self.assertEqual(bridge._scan_local_accounts(),[])
            self.assertIsNone(bridge.snapshot()['user'])
            self.assertFalse(bridge.snapshot()['copy_permission_available'])

if __name__=='__main__':unittest.main()