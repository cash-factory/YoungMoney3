CREATE TABLE auth_attempts (
  key TEXT PRIMARY KEY, window INTEGER NOT NULL, hits INTEGER NOT NULL
);
CREATE INDEX auth_attempts_window ON auth_attempts(window);
ALTER TABLE workspace_records ADD COLUMN request_hash TEXT;
CREATE TABLE trade_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL, operation TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  before_payload TEXT, after_payload TEXT
);
CREATE INDEX trade_audit_owner ON trade_audit(user_id,trade_id,sequence);
CREATE TRIGGER trade_audit_insert AFTER INSERT ON workspace_records WHEN NEW.table_name='trades'
BEGIN
  INSERT INTO trade_audit(user_id,trade_id,operation,after_payload) VALUES(NEW.user_id,NEW.id,'insert',NEW.payload);
END;
CREATE TRIGGER trade_audit_update AFTER UPDATE OF payload ON workspace_records WHEN NEW.table_name='trades' AND OLD.payload<>NEW.payload
BEGIN
  INSERT INTO trade_audit(user_id,trade_id,operation,before_payload,after_payload) VALUES(NEW.user_id,NEW.id,'update',OLD.payload,NEW.payload);
END;
CREATE TRIGGER trade_audit_delete AFTER DELETE ON workspace_records WHEN OLD.table_name='trades' AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
  INSERT INTO trade_audit(user_id,trade_id,operation,before_payload) VALUES(OLD.user_id,OLD.id,'delete',OLD.payload);
END;
