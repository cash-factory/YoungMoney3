-- Retain the actual playbook text and checkable criteria effective at each entry.
CREATE TABLE decision_playbook_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL, record_id TEXT NOT NULL,
  effective_at TEXT NOT NULL, payload TEXT
);
CREATE INDEX decision_playbook_at ON decision_playbook_history(owner,collection,record_id,effective_at DESC,sequence DESC);
INSERT INTO decision_playbook_history(owner,collection,record_id,effective_at,payload)
SELECT user_id,table_name,id,updated_at,payload FROM workspace_records
WHERE table_name IN ('trader_strategies','strategy_entry_models','trading_plans','strategy_checklist_items','pre_trade_checklist');
CREATE TRIGGER decision_playbook_insert AFTER INSERT ON workspace_records
WHEN NEW.table_name IN ('trader_strategies','strategy_entry_models','trading_plans','strategy_checklist_items','pre_trade_checklist')
BEGIN
 INSERT INTO decision_playbook_history(owner,collection,record_id,effective_at,payload) VALUES(NEW.user_id,NEW.table_name,NEW.id,NEW.updated_at,NEW.payload);
END;
CREATE TRIGGER decision_playbook_update AFTER UPDATE OF payload ON workspace_records
WHEN OLD.payload <> NEW.payload AND NEW.table_name IN ('trader_strategies','strategy_entry_models','trading_plans','strategy_checklist_items','pre_trade_checklist')
BEGIN
 INSERT INTO decision_playbook_history(owner,collection,record_id,effective_at,payload) VALUES(NEW.user_id,NEW.table_name,NEW.id,NEW.updated_at,NEW.payload);
END;
CREATE TRIGGER decision_playbook_delete AFTER DELETE ON workspace_records
WHEN OLD.table_name IN ('trader_strategies','strategy_entry_models','trading_plans','strategy_checklist_items','pre_trade_checklist')
AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 INSERT INTO decision_playbook_history(owner,collection,record_id,effective_at,payload) VALUES(OLD.user_id,OLD.table_name,OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL);
END;
