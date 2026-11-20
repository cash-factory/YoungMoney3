-- 0016: audited owner review of historical broker balance movements.
-- Broker deal evidence remains immutable in mt5_cash_movements and mt5_raw_evidence.
-- Review metadata is separate and append-only in mt5_cash_review_events.
CREATE TABLE mt5_cash_reviews (
 link TEXT NOT NULL,
 ticket TEXT NOT NULL,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 classification TEXT NOT NULL CHECK(classification IN
   ('external_deposit','external_withdrawal','broker_adjustment','internal_transfer','unresolved')),
 statement_reference TEXT,
 note TEXT,
 attested_at TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 PRIMARY KEY(link,ticket),
 FOREIGN KEY(link,ticket) REFERENCES mt5_cash_movements(link,ticket)
);
CREATE INDEX mt5_cash_review_owner ON mt5_cash_reviews(owner,link);
CREATE TABLE mt5_cash_review_events (
 id TEXT PRIMARY KEY,
 link TEXT NOT NULL,
 ticket TEXT NOT NULL,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 classification TEXT NOT NULL,
 statement_reference TEXT,
 note TEXT,
 revision INTEGER NOT NULL,
 attested_at TEXT NOT NULL,
 FOREIGN KEY(link,ticket) REFERENCES mt5_cash_movements(link,ticket)
);
CREATE TRIGGER mt5_cash_review_events_no_update BEFORE UPDATE ON mt5_cash_review_events
BEGIN
  SELECT RAISE(ABORT,'Cash review audit events are immutable');
END;
CREATE TRIGGER mt5_cash_review_events_no_delete BEFORE DELETE ON mt5_cash_review_events
BEGIN
  SELECT RAISE(ABORT,'Cash review audit events are immutable');
END;

-- Capture the FIRST observed broker balance/equity exactly once. A later
-- snapshot must not silently shift the comparison baseline.
ALTER TABLE mt5_links ADD COLUMN performance_baseline_balance REAL;
ALTER TABLE mt5_links ADD COLUMN performance_baseline_equity REAL;
ALTER TABLE mt5_links ADD COLUMN performance_baseline_at TEXT;
