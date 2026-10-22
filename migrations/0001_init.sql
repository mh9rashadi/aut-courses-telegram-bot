-- Initial schema. Never edit an applied migration: add 0002_*.sql instead.

-- Small singleton values (token, cursors, conversation state). value is JSON.
CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Courses with "new content" notifications switched on.
-- snapshot: JSON of visible activities/files at the last check (NULL until the first check).
-- checked_at: unix time used as `since` for core_course_get_updates_since.
CREATE TABLE subscriptions (
  course_id  INTEGER PRIMARY KEY,
  snapshot   TEXT,
  checked_at INTEGER
);

-- Deadline reminders already sent, so each is sent once. key = "<eventid>:<window>".
CREATE TABLE sent_reminders (
  key     TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
