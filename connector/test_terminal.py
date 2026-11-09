from pathlib import Path
import ast
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import connect

class TerminalLoginTests(unittest.TestCase):
    def setUp(self):
        self.patch=patch.object(connect,'mt5')
        self.api=self.patch.start()
        self.addCleanup(self.patch.stop)
        self.slot=Path.cwd()/'demo'/'terminal64.exe'
        self.api.terminal_info.return_value=SimpleNamespace(data_path=str(self.slot.parent),connected=True)
        self.account=SimpleNamespace(login=42,server='FundedNext-Server 3',trade_allowed=False)
        self.api.account_info.return_value=self.account
    def verify(self,new=True):
        return connect.terminal_account(str(self.slot),42,'FundedNext-Server 3','fixture',new)
    def test_new_request_authenticates_even_if_terminal_already_connected(self):
        self.assertEqual(self.verify(),self.account)
        self.api.initialize.assert_called_once_with(str(self.slot), portable=True, timeout=60000, login=42, password='fixture', server='FundedNext-Server 3')
    def test_existing_investor_session_can_sync_without_reauthenticating(self):
        self.verify(False)
        self.api.login.assert_not_called()
    def test_standard_password_with_trading_permission_allows_capture(self):
        self.account.trade_allowed=True
        self.assertEqual(self.verify(),self.account)
        self.api.order_send.assert_not_called()
        self.api.order_check.assert_not_called()
    def test_investor_password_still_works(self):
        self.account.trade_allowed=False
        self.assertEqual(self.verify(),self.account)
    def test_connector_does_not_call_order_execution_apis(self):
        tree=ast.parse(Path(connect.__file__).read_text(encoding='utf-8'))
        forbidden={'order_send','order_check','positions_close','TRADE_ACTION_DEAL','TRADE_ACTION_PENDING'}
        for node in ast.walk(tree):
            if isinstance(node,ast.Attribute) and node.attr in forbidden:
                self.fail('Capture-only connector must never reference MT5 trade execution API: '+node.attr)
    def test_wrong_terminal_never_receives_password(self):
        self.api.terminal_info.return_value.data_path=str(Path.cwd())
        with self.assertRaisesRegex(connect.LoginFailure,'wrong_terminal'): self.verify()
        self.api.login.assert_not_called()
    def test_preserves_broker_failure_code(self):
        self.api.initialize.return_value=False
        self.api.last_error.return_value=(-6,'Authorization failed')
        with self.assertRaisesRegex(connect.LoginFailure,'broker_rejected') as caught: self.verify()
        self.assertEqual(caught.exception.api_code,-6)
