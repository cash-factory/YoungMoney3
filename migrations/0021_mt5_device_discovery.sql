-- Connector-owned account discovery. No passwords, MT5 installation paths,
-- executable commands or order instructions are stored here.
CREATE TABLE IF NOT EXISTS mt5_device_scans (
  device TEXT PRIMARY KEY REFERENCES mt5_devices(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS mt5_device_scans_owner ON mt5_device_scans(owner);

CREATE TABLE IF NOT EXISTS mt5_discovered_accounts (
  device TEXT NOT NULL REFERENCES mt5_devices(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  login TEXT NOT NULL,
  server TEXT NOT NULL,
  account_name TEXT NOT NULL,
  company TEXT NOT NULL,
  currency TEXT NOT NULL,
  trade_mode INTEGER NOT NULL CHECK (trade_mode IN (0,1,2)),
  last_seen INTEGER NOT NULL,
  PRIMARY KEY(device,slot)
);
CREATE INDEX IF NOT EXISTS mt5_discovered_accounts_owner ON mt5_discovered_accounts(owner,last_seen DESC);

CREATE TABLE IF NOT EXISTS mt5_discovery_approvals (
  link TEXT PRIMARY KEY REFERENCES mt5_links(id) ON DELETE CASCADE,
  device TEXT NOT NULL REFERENCES mt5_devices(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  login TEXT NOT NULL,
  server TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS mt5_discovery_approvals_device ON mt5_discovery_approvals(device,verified_at);
