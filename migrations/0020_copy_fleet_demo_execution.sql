-- 0020: Owner-scoped, explicit DEMO or LIVE multi-follower fleets (disabled by default).
-- These tables do not modify or activate legacy paused Copy Studio drafts.
-- A separately consented Windows follower process owns all broker execution.
CREATE TABLE copy_fleets (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 64),
 source_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
 execution_mode TEXT NOT NULL DEFAULT 'demo' CHECK(execution_mode IN ('demo','live')),
 state TEXT NOT NULL DEFAULT 'paused' CHECK(state IN ('paused','demo_armed','live_armed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 max_age_ms INTEGER NOT NULL DEFAULT 12000 CHECK(max_age_ms BETWEEN 1000 AND 15000),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX copy_fleets_owner ON copy_fleets(owner,updated_at DESC);
CREATE TABLE copy_fleet_followers (
 fleet_id TEXT NOT NULL REFERENCES copy_fleets(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 follower_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
 sizing_mode TEXT NOT NULL CHECK(sizing_mode IN ('risk_pct_equity','fixed_risk','equity_ratio','lot_multiplier')),
 sizing_value REAL NOT NULL CHECK(sizing_value>0 AND sizing_value<=1000000),
 max_lots REAL NOT NULL CHECK(max_lots>0 AND max_lots<=100),
 max_daily_loss_pct REAL NOT NULL CHECK(max_daily_loss_pct>0 AND max_daily_loss_pct<=10),
 symbol_map TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(symbol_map)),
 mirror_pending INTEGER NOT NULL DEFAULT 1 CHECK(mirror_pending IN (0,1)),
 mirror_protection INTEGER NOT NULL DEFAULT 1 CHECK(mirror_protection IN (0,1)),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(fleet_id,follower_link)
);
CREATE INDEX copy_fleet_followers_link ON copy_fleet_followers(owner,follower_link,fleet_id);
CREATE TABLE copy_device_consents (
 follower_link TEXT PRIMARY KEY REFERENCES mt5_links(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device TEXT NOT NULL REFERENCES mt5_devices(id) ON DELETE CASCADE,
 demo_authorized INTEGER NOT NULL DEFAULT 0 CHECK(demo_authorized IN (0,1)),
 authorization_mode TEXT NOT NULL DEFAULT 'none' CHECK(authorization_mode IN ('none','demo','live')),
 broker_login TEXT,
 broker_server TEXT,
 expires_at INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE TABLE copy_source_states (
 source_link TEXT PRIMARY KEY REFERENCES mt5_links(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 snapshot_sha256 TEXT NOT NULL,
 observed_at_ms INTEGER NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE copy_execution_tasks (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id TEXT NOT NULL REFERENCES copy_fleets(id) ON DELETE CASCADE,
 follower_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
 source_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
 source_key TEXT NOT NULL,
 execution_mode TEXT NOT NULL DEFAULT 'demo' CHECK(execution_mode IN ('demo','live')),
 action TEXT NOT NULL CHECK(action IN (
  'open_market','place_pending','modify_sl_tp','modify_pending',
  'cancel_pending','reduce_position','close_position')),
 source_revision TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 status TEXT NOT NULL DEFAULT 'queued'
  CHECK(status IN ('queued','dispatched','applied','rejected','unknown','cancelled')),
 broker_ticket TEXT,
 retcode INTEGER,
 result_code TEXT,
 result_payload TEXT CHECK(result_payload IS NULL OR json_valid(result_payload)),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 dispatched_at INTEGER,
 finished_at INTEGER,
 UNIQUE(fleet_id,follower_link,source_key,source_revision,action)
);
CREATE INDEX copy_tasks_target_pending ON copy_execution_tasks(follower_link,status,expires_at,created_at);
CREATE INDEX copy_tasks_owner_recent ON copy_execution_tasks(owner,created_at DESC);
CREATE TABLE copy_execution_audit (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id TEXT NOT NULL,
 follower_link TEXT,
 source_key TEXT,
 event TEXT NOT NULL,
 details TEXT NOT NULL CHECK(json_valid(details)),
 created_at TEXT NOT NULL
);
CREATE INDEX copy_execution_audit_owner ON copy_execution_audit(owner,created_at DESC);
CREATE TRIGGER copy_execution_audit_no_update BEFORE UPDATE ON copy_execution_audit BEGIN
 SELECT RAISE(ABORT,'Copy execution audit is immutable');
END;

-- Each report is scoped to the verified linked MT5 account and signed device.
-- Only non-sensitive operating metrics; no passwords, symbol/account tickets,
-- or private strategy parameters are saved in this heartbeat table.
CREATE TABLE copy_account_reports (
 link TEXT PRIMARY KEY REFERENCES mt5_links(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device TEXT NOT NULL REFERENCES mt5_devices(id) ON DELETE CASCADE,
 account_currency TEXT NOT NULL,
 account_balance REAL NOT NULL,
 account_equity REAL NOT NULL,
 margin_free REAL NOT NULL,
 open_positions INTEGER NOT NULL CHECK(open_positions BETWEEN 0 AND 100000),
 pending_orders INTEGER NOT NULL CHECK(pending_orders BETWEEN 0 AND 100000),
 broker_connected INTEGER NOT NULL CHECK(broker_connected IN (0,1)),
 demo_trading_enabled INTEGER NOT NULL CHECK(demo_trading_enabled IN (0,1)),
 observed_at_ms INTEGER NOT NULL
);
CREATE INDEX copy_reports_owner ON copy_account_reports(owner,observed_at_ms DESC);
