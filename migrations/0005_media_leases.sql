CREATE TABLE active_media_uploads(
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires INTEGER NOT NULL
);
CREATE INDEX uploads_by_owner ON active_media_uploads(owner,expires);
