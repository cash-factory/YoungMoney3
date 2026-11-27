"""Build-locked Signal Desk service channel.

A runtime environment variable must never silently redirect a packaged connector,
Windows pairing token, or SQLite capture state to another workspace. A production
artifact requires a separately reviewed change of PACKAGED_CHANNEL, distinct Tauri
identity/updater channel, and operator-approved Windows acceptance.
"""
from __future__ import annotations

import os

ORIGINS = {
    'staging': 'https://ym-fx-staging.ethical-hacker263.workers.dev',
    'production': 'https://ym-fx.ethical-hacker263.workers.dev',
}

# This Tauri artifact has identifier za.youngmoney3.signaldesk.staging.
# Never switch channel in a user preference or remote request.
PACKAGED_CHANNEL = 'staging'


def select_channel(requested: str | None = None) -> tuple[str, str]:
    target = requested if requested is not None else os.environ.get(
        'YMFX_CONNECTOR_CHANNEL', PACKAGED_CHANNEL)
    if target != PACKAGED_CHANNEL or target not in ORIGINS:
        raise RuntimeError('This connector build is pinned to its approved workspace channel')
    return target, ORIGINS[target]


CHANNEL, SERVICE_ORIGIN = select_channel()
SESSION_NAMESPACE = CHANNEL + '-gui'
