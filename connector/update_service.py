"""Trusted, bounded update discovery and staging for the classic Windows connector.

Update channel is pinned to the project's own published GitHub releases.
A GitHub-provided SHA-256 digest is REQUIRED before a file can be staged.
This module cannot start installers, change broker configuration, or execute code.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
from urllib.parse import urlparse

REPO = "cash-factory/YoungMoney3"
CHANNEL = "staging"
API_URL = "https://api.github.com/repos/" + REPO + "/releases?per_page=40"
TAG_PREFIX = "staging-connector-v"
ASSET_NAME = "YoungMoney3.Connector.exe"
NOTES_NAME = "update-notes.json"
MAX_RELEASES_BYTES = 600_000
MAX_NOTES_BYTES = 16_384
MAX_EXECUTABLE_BYTES = 150 * 1024 * 1024
MIN_EXECUTABLE_BYTES = 1_000_000
ALLOWED_DOWNLOAD_HOSTS = frozenset({
    "github.com", "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
})
VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$")
DIGEST_PATTERN = re.compile(r"^sha256:([a-f0-9]{64})$", re.I)


class UpdateError(Exception):
    """Safe to report in the UI; never contains untrusted remote details."""


@dataclass(frozen=True)
class UpdateRelease:
    version: str
    tag: str
    url: str
    sha256: str
    size: int
    notes: tuple[str, ...] = ()
    headline: str = ""

    def public_summary(self) -> str:
        return self.headline or "Connector update available"


def version_key(version: str) -> tuple[int, int, int, int, int]:
    match = VERSION_PATTERN.fullmatch(str(version))
    if not match:
        raise UpdateError("Update version was not recognized.")
    major, minor, patch, candidate = match.groups()
    return (int(major), int(minor), int(patch),
            0 if candidate is not None else 1,
            int(candidate) if candidate is not None else 0)


def _get(url: str, *, max_bytes: int, opener=urllib.request.urlopen) -> bytes:
    if not url.startswith("https://"):
        raise UpdateError("Update location is not secure.")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "YoungMoney3-Connector-Updater",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with opener(request, timeout=12) as response:
            final = urlparse(response.geturl())
            if final.scheme != "https" or final.hostname not in (
                ALLOWED_DOWNLOAD_HOSTS | {"api.github.com"}
            ):
                raise UpdateError("Update download was redirected to an untrusted location.")
            data = response.read(max_bytes + 1)
    except (OSError, TimeoutError, ValueError) as exc:
        raise UpdateError("Could not contact the update service.") from exc
    if len(data) > max_bytes:
        raise UpdateError("Update response exceeded its safety limit.")
    return data


def _asset(release: dict, name: str):
    for item in release.get("assets", []):
        if isinstance(item, dict) and item.get("name") == name and item.get("state") == "uploaded":
            return item
    return None


def _expected_download_url(tag: str, filename: str) -> str:
    # Never accept arbitrary URLs from release notes or a JSON manifest.
    return f"https://github.com/{REPO}/releases/download/{tag}/{filename}"


def _asset_details(asset: dict, tag: str, filename: str, minimum: int, maximum: int):
    url = _expected_download_url(tag, filename)
    if asset.get("browser_download_url") != url:
        raise UpdateError("Update asset location did not match its release.")
    match = DIGEST_PATTERN.fullmatch(str(asset.get("digest") or ""))
    if not match:
        raise UpdateError("Update asset has no trusted checksum.")
    size = asset.get("size")
    if type(size) is not int or not minimum <= size <= maximum:
        raise UpdateError("Update asset size was not accepted.")
    return url, match.group(1).lower(), size


def _read_notes(release: dict, tag: str, version: str, opener):
    asset = _asset(release, NOTES_NAME)
    if not asset:
        return (), ""
    try:
        url, digest, size = _asset_details(asset, tag, NOTES_NAME, 20, MAX_NOTES_BYTES)
        data = _get(url, max_bytes=MAX_NOTES_BYTES, opener=opener)
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            return (), ""
        doc = json.loads(data.decode("utf-8-sig"))
        if not isinstance(doc, dict) or doc.get("version") != version:
            return (), ""
        summary = doc.get("headline")
        if not isinstance(summary, str) or len(summary) > 100:
            summary = ""
        # Only short, product-facing plain text. No HTML, Markdown, commit IDs or raw logs.
        changes = doc.get("changes")
        if not isinstance(changes, list):
            return (), summary
        clean = tuple(line.strip() for line in changes[:4]
                      if isinstance(line, str) and 1 <= len(line.strip()) <= 130
                      and not re.search(r"[\r\n<>]", line))
        return clean, summary
    except (UpdateError, ValueError, UnicodeError, TypeError, KeyError):
        # Release notes are optional and must never block a verified update.
        return (), ""


def parse_release_list(data, current_version: str, *, opener=urllib.request.urlopen):
    """Prefer only the newest compatible staging EXE strictly above current version."""
    current = version_key(current_version)
    if not isinstance(data, list):
        raise UpdateError("Update release list was not recognized.")
    candidates = []
    for release in data[:40]:
        if not isinstance(release, dict) or release.get("draft") or not release.get("prerelease"):
            continue
        tag = release.get("tag_name")
        if not isinstance(tag, str) or not tag.startswith(TAG_PREFIX):
            continue
        version = tag[len(TAG_PREFIX):]
        try:
            if version_key(version) <= current:
                continue
        except UpdateError:
            continue
        asset = _asset(release, ASSET_NAME)
        if not asset:
            continue
        try:
            url, digest, size = _asset_details(
                asset, tag, ASSET_NAME, MIN_EXECUTABLE_BYTES, MAX_EXECUTABLE_BYTES
            )
        except UpdateError:
            continue
        candidates.append((version_key(version), release, version, tag, url, digest, size))
    if not candidates:
        return None
    _, release, version, tag, url, digest, size = max(candidates, key=lambda item: item[0])
    notes, headline = _read_notes(release, tag, version, opener)
    return UpdateRelease(version, tag, url, digest, size, notes, headline)


def check_for_update(current_version: str, *, opener=urllib.request.urlopen):
    try:
        raw = _get(API_URL, max_bytes=MAX_RELEASES_BYTES, opener=opener)
        return parse_release_list(json.loads(raw.decode("utf-8")), current_version, opener=opener)
    except (ValueError, UnicodeError) as exc:
        raise UpdateError("Update service returned an unexpected response.") from exc


def stage_update(release: UpdateRelease, root: Path, progress=None, *,
                 opener=urllib.request.urlopen) -> Path:
    """Download a release with bounded streaming, compare GitHub digest and atomically stage.

    Never touch capture.db, keyring, user settings, live processes or the installed EXE.
    """
    version_key(release.version)
    if release.tag != TAG_PREFIX + release.version:
        raise UpdateError("The update channel did not match.")
    if release.url != _expected_download_url(release.tag, ASSET_NAME):
        raise UpdateError("The update source was not recognized.")
    if not re.fullmatch("[0-9a-f]{64}", release.sha256):
        raise UpdateError("The update checksum was invalid.")
    if not MIN_EXECUTABLE_BYTES <= release.size <= MAX_EXECUTABLE_BYTES:
        raise UpdateError("The update package size was invalid.")
    directory = Path(root) / "updates" / release.version
    directory.mkdir(parents=True, exist_ok=True)
    result = directory / ASSET_NAME
    if result.is_file() and _hash_file(result) == release.sha256 and result.stat().st_size == release.size:
        if progress:
            progress(100)
        return result
    temporary = directory / (ASSET_NAME + ".partial")
    request = urllib.request.Request(
        release.url, headers={"User-Agent": "YoungMoney3-Connector-Updater"}
    )
    total = 0
    digest = hashlib.sha256()
    try:
        with opener(request, timeout=30) as response, temporary.open("wb") as handle:
            location = urlparse(response.geturl())
            if location.scheme != "https" or location.hostname not in ALLOWED_DOWNLOAD_HOSTS:
                raise UpdateError("Update package came from an untrusted location.")
            while True:
                block = response.read(1024 * 256)
                if not block:
                    break
                total += len(block)
                if total > release.size:
                    raise UpdateError("Update package size did not match its release.")
                handle.write(block)
                digest.update(block)
                if progress:
                    progress(min(99, int(total * 100 / release.size)))
        if total != release.size or digest.hexdigest() != release.sha256:
            raise UpdateError("Update download failed its integrity check.")
        os.replace(temporary, result)
        if progress:
            progress(100)
        return result
    except (OSError, TimeoutError) as exc:
        raise UpdateError("Update download could not be completed.") from exc
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _hash_file(path: Path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
