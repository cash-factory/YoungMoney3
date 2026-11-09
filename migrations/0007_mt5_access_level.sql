-- Account-level broker metadata only; never store credentials here.
ALTER TABLE mt5_links ADD COLUMN trade_mode INTEGER;
ALTER TABLE mt5_links ADD COLUMN access_level TEXT NOT NULL DEFAULT 'unknown'
  CHECK (access_level IN ('unknown','trading-enabled','trading-restricted'));
