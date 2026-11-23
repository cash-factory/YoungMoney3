-- 0018: Preserve the first immutable broker record and every distinct later
-- conflicting candidate. A conflict is NEVER an automatically approved correction.
-- This table is separate from mt5_evidence_corrections (verified corrections).
-- All entries are owner-scoped and append-only, with explicit needs_review status.
CREATE TABLE mt5_evidence_conflicts (
  link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('deal','order','stop','position','specification')),
  original_sha256 TEXT NOT NULL CHECK(length(original_sha256)=64),
  candidate_sha256 TEXT NOT NULL CHECK(length(candidate_sha256)=64),
  candidate_payload TEXT NOT NULL CHECK(json_valid(candidate_payload)),
  changed_fields TEXT NOT NULL CHECK(json_valid(changed_fields)),
  review_status TEXT NOT NULL DEFAULT 'needs_review' CHECK(review_status='needs_review'),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(link,event_key,candidate_sha256),
  CHECK(original_sha256<>candidate_sha256)
);
CREATE INDEX mt5_conflicts_owner_recent ON mt5_evidence_conflicts(owner,link,recorded_at DESC);
CREATE TRIGGER mt5_conflicts_no_update BEFORE UPDATE ON mt5_evidence_conflicts BEGIN
  SELECT RAISE(ABORT,'Unreviewed broker evidence conflicts are immutable');
END;
