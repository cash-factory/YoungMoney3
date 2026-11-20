-- Stable connector-installation recognition and human-readable owner labels.
-- The installation identifier is hashed before storage; neither the hash nor
-- the label authenticates a PC. Existing broker links and immutable evidence
-- continue to use the original device UUID, and are never migrated/deleted.
ALTER TABLE mt5_devices ADD COLUMN pc_name TEXT;
ALTER TABLE mt5_devices ADD COLUMN installation_hash TEXT;
CREATE UNIQUE INDEX mt5_owner_installation_active
  ON mt5_devices(owner, installation_hash)
  WHERE revoked=0 AND installation_hash IS NOT NULL AND public_key IS NOT NULL;
