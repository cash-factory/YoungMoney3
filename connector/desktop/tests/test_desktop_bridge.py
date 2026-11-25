import io
import json
import sys
import threading
import time
import types
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))

class FakeSessionStore:
    def __init__(self,path):
        self.path=Path(path)
        self.items=[{'id':'abc','name':'Exness Demo','terminal':str(self.path.parent/'nonexistent'/'terminal64.exe'),'enabled':True}]
        self.changed=[]
    def snapshot(self):return [dict(x) for x in self.items]
    def all_terminals(self):return []
    def active_terminals(self):return []
    def armed_terminal(self):return None
    def rename(self,id,name):
        assert id=='abc'
        self.items[0]['name']=name
    def remove(self,id):
        assert id=='abc'
        self.items=[]
    def set_enabled(self,id,enabled):
        assert id=='abc'
        self.changed.append((id,enabled))
        self.items[0]['enabled']=enabled

sys.modules['sessions']=types.SimpleNamespace(SessionStore=FakeSessionStore)
from desktop_bridge import Bridge,serve

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge=Bridge(Path('/tmp/ymfx-safe-test-settings-do-not-create.json'),pairing_check=lambda:False)
    def test_unpaired_state_has_no_invented_broker_health(self):
        state=self.bridge.snapshot()
        self.assertEqual(state['connection_state'],'unpaired')
        self.assertFalse(state['paired'])
        self.assertFalse(state['copying_armed'])
        self.assertFalse(state['copy_permission_available'])
        self.assertIsNone(state['sessions'][0]['login'])
        self.assertEqual(state['sessions'][0]['status'],'terminal-missing')
        self.assertFalse(self.bridge.settings.exists())
    def test_reject_unknown_commands_and_pairing_secrets(self):
        for command in ('execute_order','authorize_live_copy','delete_trade','open_url'):
            with self.assertRaisesRegex(ValueError,'Unsupported'):
                self.bridge.dispatch(command,{})
        with self.assertRaisesRegex(ValueError,'32-character'):
            self.bridge.dispatch('pair_pc',{'code':'NOT-A-CODE'})
    def test_pause_preference_reuses_real_session_store(self):
        reply=self.bridge.dispatch('set_session_enabled',{'id':'abc','enabled':False})
        self.assertTrue(reply['updated'])
        self.assertEqual(self.bridge._store.changed,[('abc',False)])
        with self.assertRaises(ValueError):self.bridge.dispatch('set_session_enabled',{'id':'abc','enabled':'false'})
        with self.assertRaises(ValueError):self.bridge.dispatch('set_session_enabled',{'id':'wrong','enabled':True})
    def test_report_filters_sensitive_evidence_and_never_guesses_copy_permission(self):
        self.bridge._report({'state':'known-links','links':[{'slot':self.bridge._store.items[0]['terminal'],'server':'Exness-Real','login':'12345','token':'secret'}]})
        self.bridge._report({'state':'pc-online','token':'secret'})
        data=self.bridge.snapshot()
        self.assertEqual(data['sessions'][0]['login'],'12345')
        self.assertFalse(data['copying_armed'])
        self.assertNotIn('secret',json.dumps(data))
    def test_worker_rejection_and_safe_stop(self):
        with self.assertRaisesRegex(ValueError,'Pair'):
            self.bridge.dispatch('start_monitoring')
        self.assertIsNone(self.bridge.worker)
        reply=self.bridge.dispatch('stop_monitoring')
        self.assertTrue(reply['outbox_preserved'])
    def test_line_protocol_replies_no_secret_echo(self):
        wire=io.StringIO('\n'.join([
            json.dumps({'id':1,'method':'snapshot'}),
            json.dumps({'id':2,'method':'pair_pc','params':{'code':'SECRET'}}),
            json.dumps({'id':3,'method':'authorize_live_copy'}),
            json.dumps({'id':4,'method':'shutdown'}),'']))
        output=io.StringIO()
        serve(self.bridge,wire,output)
        replies=[json.loads(s) for s in output.getvalue().strip().splitlines()]
        self.assertEqual(len(replies),4)
        self.assertTrue(replies[0]['ok'])
        self.assertFalse(replies[1]['ok'])
        self.assertFalse(replies[2]['ok'])
        self.assertNotIn('SECRET',output.getvalue())
    def test_no_false_live_status_before_completed_broker_capture(self):
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            slot=Path(temp)/'terminal64.exe';slot.write_bytes(b'')
            self.bridge._store.items[0]['terminal']=str(slot)
            self.bridge.worker=types.SimpleNamespace(is_alive=lambda:True)
            self.bridge.worker_mode='capture'
            self.bridge.worker_started=1234
            self.bridge._report({'state':'known-links','links':[{'slot':str(slot),'login':'1234','server':'Example-Demo','link':'verified-link'}]})
            self.bridge._report({'state':'pc-online'})
            self.assertEqual(self.bridge.snapshot()['sessions'][0]['status'],'not-verified')
            self.bridge._report({'state':'session-synced','slot':str(slot),'message':'token=secret should not appear'})
            self.assertEqual(self.bridge.snapshot()['sessions'][0]['status'],'monitoring')
            self.assertNotIn('token=secret',json.dumps(self.bridge.snapshot()))
            self.bridge._report({'state':'session-error','slot':str(slot),'message':'password=stolen'})
            self.assertEqual(self.bridge.snapshot()['sessions'][0]['status'],'needs-attention')
            self.assertNotIn('password=stolen',json.dumps(self.bridge.snapshot()))

    def test_retry_requests_verified_slot_from_existing_supervisor(self):
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            slot=Path(temp)/'terminal64.exe';slot.write_bytes(b'')
            self.bridge._store.items[0]['terminal']=str(slot)
            with self.assertRaisesRegex(ValueError,'Start monitoring'):
                self.bridge.dispatch('retry_session',{'id':'abc'})
            self.bridge.worker=types.SimpleNamespace(is_alive=lambda:True)
            self.bridge.worker_mode='capture'
            with self.assertRaisesRegex(ValueError,'verified'):
                self.bridge.dispatch('retry_session',{'id':'abc'})
            self.bridge._report({'state':'known-links','links':[{'slot':str(slot),'login':'1234','server':'Example','link':'test-link'}]})
            self.assertTrue(self.bridge.dispatch('retry_session',{'id':'abc'})['retry_queued'])
            self.assertEqual(self.bridge.retry_queue.get_nowait(),str(slot))

    def test_session_rename_and_remove_require_validated_intent(self):
        with self.assertRaisesRegex(ValueError,'name'):
            self.bridge.dispatch('rename_session',{'id':'abc','name':'/'})
        self.assertTrue(self.bridge.dispatch('rename_session',{'id':'abc','name':'London Desk'})['updated'])
        self.assertEqual(self.bridge.snapshot()['sessions'][0]['name'],'London Desk')
        with self.assertRaisesRegex(ValueError,'confirmation'):
            self.bridge.dispatch('remove_session',{'id':'abc','confirm':'remove'})
        self.assertTrue(self.bridge.dispatch('remove_session',{'id':'abc','confirm':'REMOVE'})['broker_evidence_preserved'])
        self.assertEqual(self.bridge.snapshot()['sessions'],[])

    def test_pair_success_only_when_real_pairing_is_confirmed(self):
        present={'paired':False}
        def pair(code,report):
            self.assertEqual(len(code),32)
            present['paired']=True
        bridge=Bridge(Path('/tmp/ymfx-test-pairing.json'),pairing=pair,pairing_check=lambda:present['paired'])
        bridge.dispatch('pair_pc',{'code':'a'*32})
        bridge.worker.join(3)
        self.assertTrue(bridge.snapshot()['paired'])
        self.assertFalse(bridge.snapshot()['copying_armed'])

if __name__=='__main__':unittest.main()