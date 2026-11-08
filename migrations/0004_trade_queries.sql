CREATE INDEX workspace_trade_time ON workspace_records(user_id, table_name, json_extract(payload,'$.entry_time') DESC,id DESC);
CREATE INDEX workspace_account_time ON workspace_records(user_id,table_name,json_extract(payload,'$.account_id'),json_extract(payload,'$.entry_time') DESC,id DESC);
