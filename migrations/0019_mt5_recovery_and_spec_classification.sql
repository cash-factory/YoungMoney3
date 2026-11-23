-- 0019: Audit known connector specification-key identity defects without
-- deleting or mutating any saved original or conflict-candidate evidence.
-- The old connector hashed the symbol spec but added position_id AFTER hashing,
-- so several open positions sharing an instrument collided under the same key.
CREATE TABLE mt5_conflict_classifications (
 link TEXT NOT NULL,
 event_key TEXT NOT NULL,
 candidate_sha256 TEXT NOT NULL,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 classification TEXT NOT NULL CHECK(classification='connector_spec_position_alias_v1'),
 provenance TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(link,event_key,candidate_sha256),
 FOREIGN KEY(link,event_key,candidate_sha256)
   REFERENCES mt5_evidence_conflicts(link,event_key,candidate_sha256) ON DELETE CASCADE
);
CREATE INDEX mt5_classification_owner ON mt5_conflict_classifications(owner,link,classification);
CREATE TRIGGER mt5_classification_no_update BEFORE UPDATE ON mt5_conflict_classifications
BEGIN
 SELECT RAISE(ABORT,'Connector-defect classification is an immutable audit finding');
END;

-- Backfill ONLY structurally proven false positives. Reconstruct the original
-- and candidate excluding position_id: all other fields must be identical.
-- Existing broker deals, orders, histories and discrepancies remain untouched.
INSERT OR IGNORE INTO mt5_conflict_classifications
 (link,event_key,candidate_sha256,owner,classification,provenance,recorded_at)
SELECT c.link,c.event_key,c.candidate_sha256,c.owner,
 'connector_spec_position_alias_v1',
 'original_connector_spec_key_hash_excluded_position_id',
 CURRENT_TIMESTAMP
FROM mt5_evidence_conflicts c
JOIN mt5_raw_evidence e ON e.link=c.link AND e.event_key=c.event_key
WHERE c.evidence_kind='specification'
  AND c.changed_fields='["position_id"]'
  AND c.event_key GLOB 'spec-*'
  AND length(c.event_key)=33
  AND json_valid(c.candidate_payload)
  AND json_valid(e.payload)
  AND json_remove(c.candidate_payload,'$.position_id') =
      json_remove(e.payload,'$.position_id');

-- The last successful historical window and unresolved formerly open
-- positions belong in a separate source-of-truth status, not the trade ledger.
CREATE TABLE mt5_recovery_status (
 link TEXT PRIMARY KEY REFERENCES mt5_links(id) ON DELETE CASCADE,
 owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('catching_up','awaiting_broker_history','current')),
 scanned_through INTEGER NOT NULL,
 target_at INTEGER NOT NULL,
 unresolved_positions INTEGER NOT NULL CHECK(unresolved_positions BETWEEN 0 AND 100000),
 unobserved_stop_changes INTEGER NOT NULL DEFAULT 0 CHECK(unobserved_stop_changes IN (0,1)),
 updated_at TEXT NOT NULL
);
CREATE INDEX mt5_recovery_status_owner ON mt5_recovery_status(owner,state);
