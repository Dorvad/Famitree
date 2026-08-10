/**
 * The schema, as a string rather than a .sql file.
 *
 * It has to be readable from inside a serverless function bundle, where there
 * is no `server/src/db/` to read a sibling file out of — a bundler inlines
 * modules, not the data files sitting next to them. Keeping it as a TypeScript
 * constant means one source of truth that every entry point can reach: the
 * long-running server, the migration script, and the function.
 *
 * Every statement is `IF NOT EXISTS`, so applying it repeatedly is a no-op.
 */
export const SCHEMA = `-- שורשים — schema.
--
-- Nothing is ever hard-deleted. People, milestones and archive items carry an
-- \`archived_at\` tombstone instead: an heirloom archive that can silently lose a
-- letter or a photograph is worse than one that keeps a little clutter, and a
-- mistaken removal stays recoverable.
--
-- Postgres. Timestamps are stored as ISO-8601 TEXT rather than TIMESTAMPTZ:
-- they are written and read as strings end to end, all the way to the client
-- contract in shared/types.ts, and converting them here would only add a
-- serialisation step that has to be undone on the way out. \`is_provisional\`
-- stays INTEGER for the same reason — one place decides it is a boolean, and
-- that place is the repo that maps the row.

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

-- The tree listing reads every living person ordered by board position; a
-- partial index in that exact order lets a large family come back without a
-- sort step.
CREATE INDEX IF NOT EXISTS idx_people_live_board
  ON people (y ASC, x DESC) WHERE archived_at IS NULL;

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

-- The feed's exact shape: live items, newest first. Partial, so archived rows
-- neither bloat it nor slow it.
CREATE INDEX IF NOT EXISTS idx_archive_live_created
  ON archive_items (created_at DESC) WHERE archived_at IS NULL;

-- A treasure can belong to a whole scene, not one sitter. \`person_id\` above
-- survives as "the first linked person" for old callers; these rows are the
-- truth. The backfill below copies the single-link era across and is a no-op
-- on every later boot.
CREATE TABLE IF NOT EXISTS archive_item_people (
  item_id   TEXT NOT NULL REFERENCES archive_items (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_people_person ON archive_item_people (person_id);

INSERT INTO archive_item_people (item_id, person_id)
  SELECT id, person_id FROM archive_items WHERE person_id IS NOT NULL
  ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS timeline_events (
  id          TEXT    PRIMARY KEY,
  year        INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  person_id   TEXT REFERENCES people (id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timeline_year ON timeline_events (year);

CREATE INDEX IF NOT EXISTS idx_timeline_live_year
  ON timeline_events (year) WHERE archived_at IS NULL;

-- Same arrangement as archive_item_people: a wedding involves two people at
-- the very least.
CREATE TABLE IF NOT EXISTS timeline_event_people (
  event_id  TEXT NOT NULL REFERENCES timeline_events (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_people_person ON timeline_event_people (person_id);

INSERT INTO timeline_event_people (event_id, person_id)
  SELECT id, person_id FROM timeline_events WHERE person_id IS NOT NULL
  ON CONFLICT DO NOTHING;

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
`;
