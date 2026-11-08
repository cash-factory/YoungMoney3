CREATE TABLE mt5_devices (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 pair_hash TEXT UNIQUE, expires INTEGER NOT NULL, token_hash TEXT UNIQUE,
 public_key TEXT, last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mt5_device_owner ON mt5_devices(owner);
CREATE TABLE mt5_links (
 id TEXT PRIMARY KEY, device TEXT NOT NULL REFERENCES mt5_devices(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 envelope TEXT, expires INTEGER NOT NULL, server TEXT, login TEXT, company TEXT,
 currency TEXT, broker_balance REAL, broker_equity REAL, linked_at TEXT, last_sync TEXT, gap INTEGER DEFAULT 0, last_error TEXT
);
CREATE UNIQUE INDEX mt5_verified_login ON mt5_links(owner,server,login) WHERE status='connected';
CREATE UNIQUE INDEX mt5_active_account ON mt5_links(account_id) WHERE status='connected';
CREATE TABLE mt5_events (
 link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE, event_key TEXT NOT NULL,
 payload TEXT NOT NULL, PRIMARY KEY(link,event_key)
);
CREATE TABLE mt5_matches (
 imported_id TEXT PRIMARY KEY, manual_id TEXT NOT NULL UNIQUE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, original TEXT NOT NULL
);
