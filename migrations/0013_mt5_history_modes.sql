-- 0013: owner-selected historical lookbacks and broker-deposit provenance.
-- Preserve legacy history rows and all immutable fill/evidence records.
ALTER TABLE mt5_links ADD COLUMN history_mode TEXT NOT NULL DEFAULT 'days';
ALTER TABLE mt5_links ADD COLUMN history_anchor_at INTEGER;
ALTER TABLE mt5_links ADD COLUMN history_anchor_ticket TEXT;
ALTER TABLE mt5_links ADD COLUMN history_anchor_amount REAL;
ALTER TABLE mt5_links ADD COLUMN history_scanned_until INTEGER;
