import json
import tempfile
import unittest
import uuid
from pathlib import Path

from pc_identity import identity_file, installation_id, pairing_request


class InstallationIdentityTests(unittest.TestCase):
    def test_installation_identity_is_stable_and_scoped_to_origin(self):
        with tempfile.TemporaryDirectory() as root:
            a=installation_id("https://staging.example",appdata=root)
            self.assertEqual(a,installation_id("https://staging.example/",appdata=root))
            self.assertEqual(str(uuid.UUID(a)),a)
            self.assertEqual(uuid.UUID(a).version,4)
            self.assertNotEqual(a,installation_id("https://production.example",appdata=root))
            self.assertEqual(json.loads(identity_file("https://staging.example",appdata=root).read_text())["installation_id"],a)

    def test_pairing_claim_binds_to_saved_installation(self):
        with tempfile.TemporaryDirectory() as root:
            first = pairing_request("https://staging.example", "one-time-code", "public-key", appdata=root)
            second = pairing_request("https://staging.example/", "another-code", "another-key", appdata=root)
            self.assertEqual(first["installationId"], second["installationId"])
            self.assertEqual(first["installationId"], installation_id("https://staging.example", appdata=root))
            self.assertEqual(first["code"], "one-time-code")
            self.assertEqual(first["publicKey"], "public-key")
            self.assertEqual(set(first), {"code", "publicKey", "installationId"})

    def test_corrupted_identity_never_silently_creates_second_pc(self):
        with tempfile.TemporaryDirectory() as root:
            original=installation_id("https://staging.example",appdata=root)
            identity_file("https://staging.example",appdata=root).write_text('{"installation_id":"bad"}')
            with self.assertRaisesRegex(RuntimeError,"Saved PC identity"):
                installation_id("https://staging.example",appdata=root)
            self.assertNotEqual(original,"bad")

    def test_existing_identity_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as root:
            value=installation_id("https://staging.example",appdata=root)
            path=identity_file("https://staging.example",appdata=root)
            stamp=path.stat().st_mtime_ns
            self.assertEqual(installation_id("https://staging.example",appdata=root),value)
            self.assertEqual(path.stat().st_mtime_ns,stamp)


if __name__=="__main__":
    unittest.main()
