ALTER TABLE mt5_devices ADD COLUMN setup_state TEXT;
ALTER TABLE mt5_devices ADD COLUMN connector_version TEXT;
ALTER TABLE mt5_links ADD COLUMN monitoring_paused INTEGER NOT NULL DEFAULT 0;
