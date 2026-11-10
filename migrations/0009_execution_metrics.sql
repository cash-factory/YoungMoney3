CREATE TABLE mt5_risk_snapshots (
  link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  cycle TEXT NOT NULL, entry_ticket TEXT NOT NULL,
  payload TEXT NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY(link,cycle,entry_ticket)
);
CREATE TABLE mt5_execution_fills (
  link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  ticket TEXT NOT NULL, cycle TEXT NOT NULL, payload TEXT NOT NULL,
  recorded_at TEXT NOT NULL, PRIMARY KEY(link,ticket)
);
CREATE INDEX workspace_visible_trades ON workspace_records(user_id,table_name,json_extract(payload,'$.superseded_by'));
