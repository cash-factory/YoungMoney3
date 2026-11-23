"""Safety and idempotence of the managed MT5 MCP-port collision mitigation."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from managed_mcp import disable_internal_mcp


class ManagedMcpTests(unittest.TestCase):
    def test_managed_profile_disables_only_internal_mcp_with_other_settings_intact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/".ym-managed.json").write_text('{"kind":"youngmoney3-portable-mt5"}')
            config=root/"Config"
            config.mkdir()
            assistant=config/"assistant.ini"
            assistant.write_text("[Other]\nExisting=keep\n[MCP.MetaTrader]\nEnable=1\nEndpoint=127.0.0.1\n[MCP.MetaEditor]\nenable=1\n",encoding="utf-8")
            self.assertTrue(disable_internal_mcp(root))
            result=assistant.read_text(encoding="utf-8")
            self.assertIn("Existing = keep",result)
            self.assertIn("Endpoint = 127.0.0.1",result)
            self.assertEqual(result.count("Enable = 0"),2)
            self.assertNotIn("enable = 1",result)
            self.assertTrue(disable_internal_mcp(root))
            self.assertEqual(assistant.read_text(encoding="utf-8"),result)
    def test_never_touches_unmanaged_installation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.assertFalse(disable_internal_mcp(root))
            self.assertFalse((root/"Config").exists())
    def test_preserves_unfamiliar_binary_ini_and_explicit_opt_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/".ym-managed.json").write_text("{}")
            (root/"Config").mkdir()
            assistant=root/"Config"/"assistant.ini"
            assistant.write_bytes(b"\xff\x00\x01binary")
            self.assertFalse(disable_internal_mcp(root))
            self.assertEqual(assistant.read_bytes(),b"\xff\x00\x01binary")
            assistant.unlink()
            with patch.dict(os.environ,{"YMFX_ENABLE_TERMINAL_MCP":"1"}):
                self.assertFalse(disable_internal_mcp(root))
            self.assertFalse(assistant.exists())
