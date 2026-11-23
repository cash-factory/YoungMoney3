"""Stable, non-secret identifier for this Windows connector installation.

This UUID is NOT a password, machine fingerprint or authorization credential.
Windows Credential Manager continues to hold the private key and bearer token.
Keep the ID across connector upgrades so new pairing codes cannot create
multiple active devices for one staging workspace and one local installation.
"""
import hashlib
import json
import os
import uuid
from pathlib import Path

def identity_file(origin, *, appdata=None):
    base = Path(appdata) if appdata is not None else Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
    suffix=hashlib.sha256(origin.rstrip("/").encode("utf-8")).hexdigest()[:16]
    return base / "YMFX" / ("pc-installation-" + suffix + ".json")

def installation_id(origin, *, appdata=None):
    file=identity_file(origin, appdata=appdata)
    file.parent.mkdir(parents=True, exist_ok=True)
    if file.exists():
        try:
            value=json.loads(file.read_text(encoding="utf-8")).get("installation_id")
            parsed=uuid.UUID(value)
            if parsed.version != 4 or str(parsed)!=value:
                raise ValueError("invalid installation UUID")
            return value
        except (OSError, ValueError, TypeError, AttributeError) as error:
            # Never quietly mint another ID after a disk corruption: that
            # could create another paired PC while the original is still live.
            raise RuntimeError("Saved PC identity is unreadable. Restore the file or ask the account owner to revoke this PC before resetting it.") from error
    value=str(uuid.uuid4())
    try:
        with file.open("x", encoding="utf-8") as stream:
            json.dump({"version":1,"installation_id":value},stream)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        # Another connector process just created the same identity.
        return installation_id(origin,appdata=appdata)
    return value


def pairing_request(origin, code, public_key, *, appdata=None):
    """Bind the first pairing claim to the same durable installation ID used by presence.

    This is a deduplication hint, not an authentication credential. The server
    still requires a one-time, owner-scoped code and a public key.
    """
    return {"code": code, "publicKey": public_key,
            "installationId": installation_id(origin, appdata=appdata)}
