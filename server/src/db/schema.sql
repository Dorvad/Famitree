-- שורשים — schema.
--
-- Nothing is ever hard-deleted. People, milestones and archive items carry an
-- `archived_at` tombstone instead: an heirloom archive that can silently lose a
-- letter or a photograph is worse than one that keeps a little clutter, and a
-- mistaken removal stays recoverable.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS generations (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  range_label  TEXT    NOT NULL,
  age_label    TEXT    NOT NULL,
  color        TEXT    NOT NULL,
  color_light  TEXT    NOT NULL,
  color_text   TEXT    NOT NULL,
  shadow       TEXT    NOT NULL,
  year_from    INTEGER NOT NULL,
  year_to      INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,
  -- Random on-disk name. Never derived from the upload, so a hostile filename
  -- cannot escape the upload directory.
  stored_name   TEXT    NOT NULL UNIQUE,
  original_name TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  byte_size     INTEGER NOT NULL,
  created_by    TEXT,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id                 TEXT PRIMARY KEY,
  full_name          TEXT    NOT NULL,
  initial            TEXT    NOT NULL,
  life_span          TEXT    NOT NULL DEFAULT '',
  place              TEXT    NOT NULL DEFAULT '',
  story              TEXT    NOT NULL DEFAULT '',
  birth_year         INTEGER,
  death_year         INTEGER,
  branch             TEXT,
  audio_label        TEXT,
  audio_media_id     TEXT REFERENCES media (id) ON DELETE SET NULL,
  portrait_media_id  TEXT REFERENCES media (id) ON DELETE SET NULL,
  x                  INTEGER NOT NULL DEFAULT 0,
  y                  INTEGER NOT NULL DEFAULT 0,
  is_provisional     INTEGER NOT NULL DEFAULT 0,
  generation_id      TEXT    NOT NULL REFERENCES generations (id),
  archived_at        TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_active ON people (archived_at);

CREATE TABLE IF NOT EXISTS relationships (
  id                TEXT PRIMARY KEY,
  person_id         TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  related_person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  -- 'spouse' (symmetric, stored once) or 'parent' (person_id parents related_person_id)
  type              TEXT NOT NULL CHECK (type IN ('spouse', 'parent')),
  created_at        TEXT NOT NULL,
  UNIQUE (person_id, related_person_id, type),
  CHECK (person_id <> related_person_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_person ON relationships (person_id);
CREATE INDEX IF NOT EXISTS idx_rel_related ON relationships (related_person_id);

CREATE TABLE IF NOT EXISTS milestones (
  id          TEXT    PRIMARY KEY,
  person_id   TEXT    NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  -- Free text: dates in a family archive are often approximate or a span.
  year_label  TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  archived_at TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_milestones_person ON milestones (person_id, sort_order);

CREATE TABLE IF NOT EXISTS archive_items (
  id          TEXT    PRIMARY KEY,
  kind        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  year_label  TEXT    NOT NULL DEFAULT '',
  subject     TEXT    NOT NULL DEFAULT '',
  story       TEXT    NOT NULL DEFAULT '',
  person_id   TEXT REFERENCES people (id) ON DELETE SET NULL,
  media_id    TEXT REFERENCES media (id) ON DELETE SET NULL,
  tile_height INTEGER NOT NULL DEFAULT 112,
  created_by  TEXT,
  archived_at TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_kind ON archive_items (kind, archived_at);
CREATE INDEX IF NOT EXISTS idx_archive_created ON archive_items (created_at DESC);

CREATE TABLE IF NOT EXISTS timeline_events (
  id         TEXT    PRIMARY KEY,
  year       INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  person_id  TEXT REFERENCES people (id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timeline_year ON timeline_events (year);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  birth_year   INTEGER,
  person_id    TEXT REFERENCES people (id) ON DELETE SET NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'steward')),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Records that the seed has run, so restarting the server never duplicates it.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
