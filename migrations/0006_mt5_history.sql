ALTER TABLE mt5_links ADD COLUMN history_id TEXT;
ALTER TABLE mt5_links ADD COLUMN history_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE mt5_links ADD COLUMN history_since INTEGER;
