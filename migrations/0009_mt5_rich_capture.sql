-- 0009: staging rich-capture foundation; additive, no destructive conversion.
-- mt5_events and workspace_records remain available for legacy audit/retry.
-- Raw deal/order/stop observations are immutable; projection revisions are append-only.
CREATE TABLE mt5_raw_evidence (
  link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('deal','order','stop','position','specification','account')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(link,event_key)
);
CREATE INDEX mt5_evidence_owner_link ON mt5_raw_evidence(owner,link,evidence_kind);
CREATE TRIGGER mt5_raw_evidence_no_update BEFORE UPDATE ON mt5_raw_evidence BEGIN
  SELECT RAISE(ABORT,'Broker evidence is immutable; append an audited correction instead');
END;
CREATE TABLE mt5_evidence_corrections (
  id TEXT PRIMARY KEY,
  link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  old_sha256 TEXT NOT NULL,
  corrected_payload TEXT NOT NULL CHECK (json_valid(corrected_payload)),
  corrected_sha256 TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX mt5_corrections_owner ON mt5_evidence_corrections(owner,link,recorded_at);

-- Each lifecycle is unique even if a broker position_id is reused by netting
-- reversal. Immutable numbered versions make recalculation and audits possible.
CREATE TABLE mt5_position_versions (
  link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  lifecycle_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  calculation_version INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(link,lifecycle_id,version),
  UNIQUE(link,lifecycle_id,sha256)
);
CREATE INDEX mt5_position_owner_recent ON mt5_position_versions(owner,account_id,recorded_at DESC);
CREATE TRIGGER mt5_position_versions_no_update BEFORE UPDATE ON mt5_position_versions BEGIN
  SELECT RAISE(ABORT,'Position summaries are append-only');
END;

-- No legacy row is erased or auto-merged unless the exact position identity
-- can be proven. Ambiguous partial-close rows remain in review.
CREATE TABLE mt5_legacy_position_review (
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legacy_trade_id TEXT NOT NULL,
  link TEXT,
  candidate_lifecycle_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review','exact_verified','rejected')),
  evidence TEXT CHECK (evidence IS NULL OR json_valid(evidence)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner,legacy_trade_id)
);
CREATE INDEX mt5_legacy_review_status ON mt5_legacy_position_review(owner,status);

-- Broker timezone can be confirmed by user, but historical UTC conversion
-- remains separately unverified until confirmed with broker evidence.
ALTER TABLE mt5_links ADD COLUMN broker_timezone TEXT;
ALTER TABLE mt5_links ADD COLUMN timezone_confirmed_at TEXT;
ALTER TABLE mt5_links ADD COLUMN timezone_source TEXT NOT NULL DEFAULT 'unconfirmed';
ALTER TABLE mt5_links ADD COLUMN utc_conversion_status TEXT NOT NULL DEFAULT 'unverified';
