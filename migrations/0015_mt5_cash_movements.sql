-- Additive, owner-scoped MT5 cash ledger. Broker deal tickets are immutable.
-- DEAL_TYPE_BALANCE=2 includes cash movements AND broker adjustments.
-- a positive balance operation is a deposit candidate, never automatically
-- certified as an external deposit. Keep the original deal evidence separately.
CREATE TABLE mt5_cash_movements (
 link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL,
 ticket TEXT NOT NULL,
 amount TEXT NOT NULL,
 currency TEXT NOT NULL,
 direction TEXT NOT NULL CHECK (direction IN ('in','out')),
 classification TEXT NOT NULL DEFAULT 'unverified_balance_movement'
   CHECK (classification IN ('unverified_balance_movement')),
 broker_time_msc INTEGER NOT NULL,
 raw_evidence_key TEXT NOT NULL,
 raw_sha256 TEXT NOT NULL CHECK(length(raw_sha256)=64),
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(link,ticket)
);
CREATE INDEX mt5_cash_owner_account ON mt5_cash_movements(owner,account_id,broker_time_msc DESC);
CREATE TRIGGER mt5_cash_no_update BEFORE UPDATE ON mt5_cash_movements BEGIN
 SELECT RAISE(ABORT,'MT5 cash movements are immutable; correct with audited evidence instead');
END;
ALTER TABLE mt5_links ADD COLUMN cash_history_cursor INTEGER;
ALTER TABLE mt5_links ADD COLUMN cash_history_completed_at TEXT;
