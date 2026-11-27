"""Offline, side-effect-limited tests of the classic connector updater."""
import hashlib
import io
import sqlite3
import json
from pathlib import Path
import tempfile
import unittest

from update_service import (
    ASSET_NAME, REPO, TAG_PREFIX, NOTES_NAME, UpdateError,
    check_for_update, parse_release_list, stage_update, version_key,
)
from update_ui import ConnectorUpdateUI


class FakeResponse:
    def __init__(self, url, body):
        self.url = url
        self.data = io.BytesIO(body)

    def __enter__(self): return self
    def __exit__(self, *_): self.data.close()
    def geturl(self): return self.url
    def read(self, size=-1): return self.data.read(size)


def make_release(version, exe_data, *, tag=None, notes=None, digest=None, state="uploaded"):
    tag = tag or TAG_PREFIX + version
    url = f"https://github.com/{REPO}/releases/download/{tag}/{ASSET_NAME}"
    assets = [{
        "name": ASSET_NAME, "state": state,
        "browser_download_url": url,
        "digest": digest or "sha256:" + hashlib.sha256(exe_data).hexdigest(),
        "size": len(exe_data),
    }]
    if notes is not None:
        contents = json.dumps(notes).encode()
        assets.append({
            "name": NOTES_NAME, "state": "uploaded",
            "browser_download_url": f"https://github.com/{REPO}/releases/download/{tag}/{NOTES_NAME}",
            "digest": "sha256:" + hashlib.sha256(contents).hexdigest(),
            "size": len(contents),
        })
    return {"tag_name": tag, "draft": False, "prerelease": True, "assets": assets}


class UpdateServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.good_bytes = b"MZ" + b"X" * 1_000_003

    def fake_network(self, releases, contents):
        def open_fake(request, timeout):
            url = request.full_url
            if url.endswith("/releases?per_page=40"):
                return FakeResponse(url, json.dumps(releases).encode())
            if url in contents:
                return FakeResponse(url, contents[url])
            raise OSError("Unavailable in test")
        return open_fake

    def test_version_order_and_no_downgrades(self):
        self.assertLess(version_key("0.6.3-rc1"), version_key("0.6.3-rc2"))
        self.assertLess(version_key("0.6.3-rc7"), version_key("0.6.3"))
        self.assertLess(version_key("0.6.3"), version_key("0.7.0-rc1"))
        with self.assertRaises(UpdateError): version_key("../evil")

    def test_correct_channel_and_latest_eligible_version(self):
        old = make_release("0.6.3-rc1", self.good_bytes)
        upcoming = make_release("0.6.4-rc1", self.good_bytes)
        latest = make_release("0.6.5-rc2", self.good_bytes)
        latest["assets"][0]["browser_download_url"] = "https://evil.invalid/app.exe"
        bad_digest = make_release("0.6.8-rc1", self.good_bytes)
        bad_digest["assets"][0]["digest"] = None
        wrong_product = make_release("999.0.0-rc1", self.good_bytes, tag="staging-signaldesk-v999.0.0-rc1")
        release = parse_release_list([old, upcoming, latest, bad_digest, wrong_product], "0.6.3-rc1")
        self.assertEqual(release.version, "0.6.4-rc1")
        self.assertIsNone(parse_release_list([old], "0.6.3-rc1"))
        self.assertIsNone(parse_release_list([old], "0.6.9"))
        self.assertEqual(release.sha256, hashlib.sha256(self.good_bytes).hexdigest())

    def test_release_notes_are_curated_and_not_raw_internal_logs(self):
        release = make_release("0.7.0-rc1", self.good_bytes, notes={
            "version": "0.7.0-rc1",
            "headline": "Cleaner setup",
            "changes": ["Monitor several accounts", "Easier reconnection", "<script>x</script>", "A" * 200],
        })
        url = release["assets"][1]["browser_download_url"]
        fake = self.fake_network([release], {url: json.dumps({
            "version": "0.7.0-rc1",
            "headline": "Cleaner setup",
            "changes": ["Monitor several accounts", "Easier reconnection", "<script>x</script>", "A" * 200],
        }).encode()})
        result = check_for_update("0.6.3-rc1", opener=fake)
        self.assertEqual(result.headline, "Cleaner setup")
        self.assertEqual(result.notes, ("Monitor several accounts", "Easier reconnection"))

    def test_stage_validates_exact_size_and_digest_without_touching_journal(self):
        data = self.good_bytes
        doc = make_release("0.7.0-rc1", data)
        release = parse_release_list([doc], "0.6.3-rc1")
        network = self.fake_network([], {release.url: data})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            journal = root / "capture.db"
            journal.write_bytes(b"IMMUTABLE-SAVED-BROKER-EVIDENCE")
            status = []
            saved = stage_update(release, root, progress=status.append, opener=network)
            self.assertEqual(saved.read_bytes(), data)
            self.assertEqual(status[-1], 100)
            self.assertEqual(journal.read_bytes(), b"IMMUTABLE-SAVED-BROKER-EVIDENCE")
            self.assertFalse(saved.with_suffix(".exe.partial").exists())
            # The hash-validated cache avoids a second network request.
            again = stage_update(release, root, opener=lambda *_args, **_kw: self.fail("network called"))
            self.assertEqual(again, saved)

    def test_untrusted_or_corrupt_update_is_never_staged(self):
        doc = make_release("0.7.0-rc1", self.good_bytes)
        release = parse_release_list([doc], "0.6.3-rc1")
        network = self.fake_network([], {release.url: b"MZ" + b"Z" * 1_000_003})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(UpdateError):
                stage_update(release, root, opener=network)
            self.assertFalse((root / "updates" / release.version / ASSET_NAME).exists())
            self.assertFalse((root / "updates" / release.version / (ASSET_NAME + ".partial")).exists())

    def test_durable_local_copy_permission_blocks_update_after_restart(self):
        class Context:
            pass
        with tempfile.TemporaryDirectory() as tmp:
            ctx = Context()
            database = Path(tmp) / "capture.db"
            ctx.copy_authorization_by_slot = {}
            ctx.copy_worker = None
            ctx._copy_database_path = lambda: database
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "CREATE TABLE copy_local_permissions (link TEXT PRIMARY KEY, approved INTEGER NOT NULL)"
                )
                connection.execute(
                    "INSERT INTO copy_local_permissions VALUES ('live-follower', 1)"
                )
            self.assertFalse(ConnectorUpdateUI._update_is_safe(ctx),
                             "Persisted LIVE follower consent must block auto-install even after app restart")
            with sqlite3.connect(database) as connection:
                connection.execute("UPDATE copy_local_permissions SET approved=0")
            self.assertTrue(ConnectorUpdateUI._update_is_safe(ctx))
            ctx._copy_database_path = lambda: (_ for _ in ()).throw(OSError("locked credential store"))
            self.assertFalse(ConnectorUpdateUI._update_is_safe(ctx),
                             "Unknown broker permission state must block replacement")

    def test_copying_permission_blocks_auto_replacement(self):
        class Context: pass
        ctx = Context()
        ctx.copy_authorization_by_slot = {"follower-one": True}
        ctx.copy_worker = None
        self.assertFalse(ConnectorUpdateUI._update_is_safe(ctx))
        ctx.copy_authorization_by_slot = {"follower-one": False}
        self.assertTrue(ConnectorUpdateUI._update_is_safe(ctx))


if __name__ == "__main__":
    unittest.main()
