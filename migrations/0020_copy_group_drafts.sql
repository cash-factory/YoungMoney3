-- 0020: Owner-controlled multi-follower Copy Studio intentions.
-- No commands to brokers, no execution routing, no unpaused states.
-- Historic 2-account drafts remain available and unchanged.
CREATE TABLE copy_groups (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 64),
  source_link TEXT NOT NULL REFERENCES mt5_links(id) ON DELETE CASCADE,
  followers TEXT NOT NULL CHECK(json_valid(followers) AND json_type(followers)='array'),
  state TEXT NOT NULL DEFAULT 'paused' CHECK(state='paused'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX copy_groups_owner ON copy_groups(owner,updated_at DESC);
CREATE TABLE copy_group_events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK(event IN ('created','updated','deleted','previewed')),
  detail TEXT NOT NULL CHECK(json_valid(detail)),
  recorded_at TEXT NOT NULL
);
CREATE INDEX copy_group_events_owner ON copy_group_events(owner,recorded_at DESC);
CREATE TRIGGER copy_group_events_immutable BEFORE UPDATE ON copy_group_events
BEGIN SELECT RAISE(ABORT,'Copy-group audit events cannot be rewritten'); END;
CREATE TRIGGER copy_group_created AFTER INSERT ON copy_groups
BEGIN
 INSERT INTO copy_group_events(id,group_id,owner,event,detail,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.owner,'created',
        json_object('follower_count',json_array_length(NEW.followers),'version',NEW.version),NEW.created_at);
END;
CREATE TRIGGER copy_group_updated AFTER UPDATE ON copy_groups
BEGIN
 INSERT INTO copy_group_events(id,group_id,owner,event,detail,recorded_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.owner,'updated',
        json_object('previous_version',OLD.version,'version',NEW.version,'follower_count',json_array_length(NEW.followers)),NEW.updated_at);
END;
CREATE TRIGGER copy_group_deleted AFTER DELETE ON copy_groups
BEGIN
 INSERT INTO copy_group_events(id,group_id,owner,event,detail,recorded_at)
 VALUES(lower(hex(randomblob(16))),OLD.id,OLD.owner,'deleted',
        json_object('version',OLD.version),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;