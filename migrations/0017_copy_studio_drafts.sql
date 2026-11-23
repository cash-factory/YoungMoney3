-- 0017: Copy Studio configuration only. No MT5 execution credentials,
-- no order instructions, no transport queue, and no automatic trade copying.
-- Each draft refers to two existing, verified MT5 connections belonging to
-- the same owner; the service also checks ownership and demo mode on mutation.
CREATE TABLE copy_profiles (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
  source_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  follower_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  sizing_mode TEXT NOT NULL DEFAULT 'fixed_multiplier'
    CHECK(sizing_mode='fixed_multiplier'),
  multiplier REAL NOT NULL CHECK(multiplier BETWEEN 0.10 AND 3.0),
  max_follower_lots REAL NOT NULL CHECK(max_follower_lots BETWEEN 0.01 AND 50.0),
  planned_max_daily_loss_pct REAL NOT NULL CHECK(planned_max_daily_loss_pct BETWEEN 0.25 AND 10.0),
  state TEXT NOT NULL DEFAULT 'paused' CHECK(state='paused'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(source_link<>follower_link),
  UNIQUE(owner,source_link,follower_link)
);
CREATE INDEX copy_profile_owner_recent ON copy_profiles(owner,updated_at DESC);
CREATE TABLE copy_profile_events (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('created','updated','deleted','previewed')),
  details TEXT NOT NULL CHECK(json_valid(details)),
  created_at TEXT NOT NULL
);
CREATE INDEX copy_event_owner_recent ON copy_profile_events(owner,created_at DESC);
CREATE TRIGGER copy_events_no_update BEFORE UPDATE ON copy_profile_events BEGIN
  SELECT RAISE(ABORT,'Copy Studio audit events are append-only');
END;
