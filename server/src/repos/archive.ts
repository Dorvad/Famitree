import type { ArchiveItem, ArchiveKind, TimelineEvent } from '../../../shared/types.ts';

import { db, nowIso } from '../db/index.ts';
import { newId } from '../lib/ids.ts';

interface ArchiveRow {
  id: string;
  kind: ArchiveKind;
  title: string;
  year_label: string;
  subject: string;
  story: string;
  person_id: string | null;
  media_id: string | null;
  tile_height: number;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
}

function toItem(row: ArchiveRow): ArchiveItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    yearLabel: row.year_label,
    subject: row.subject,
    story: row.story,
    personId: row.person_id,
    mediaId: row.media_id,
    tileHeight: row.tile_height,
    createdBy: row.created_by,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

const COLUMNS = `
  id, kind, title, year_label, subject, story, person_id, media_id,
  tile_height, created_by, created_at, archived_at
`;

export function listArchiveItems(filter: {
  kind?: ArchiveKind;
  personId?: string;
} = {}): ArchiveItem[] {
  const where = ['archived_at IS NULL'];
  const params: unknown[] = [];
  if (filter.kind) {
    where.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.personId) {
    where.push('person_id = ?');
    params.push(filter.personId);
  }
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM archive_items WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    )
    .all(...params) as ArchiveRow[];
  return rows.map(toItem);
}

export function getArchiveItem(id: string): ArchiveItem | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM archive_items WHERE id = ?`).get(id) as
    | ArchiveRow
    | undefined;
  return row ? toItem(row) : null;
}

/**
 * Masonry tiles need varied heights to look alive, but a random height on every
 * render makes the feed jitter. Deriving it from the id keeps each tile's
 * height stable forever while still varying across the feed.
 */
function tileHeightFor(id: string): number {
  const buckets = [88, 96, 104, 112, 120, 126, 130, 140, 150];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return buckets[hash % buckets.length] ?? 112;
}

export interface CreateArchiveInput {
  kind: ArchiveKind;
  title: string;
  yearLabel?: string;
  subject?: string;
  story?: string;
  personId?: string | null;
  mediaId?: string | null;
}

export function createArchiveItem(
  input: CreateArchiveInput,
  createdBy: string | null,
): ArchiveItem {
  const id = newId('it');
  db.prepare(
    `INSERT INTO archive_items
       (id, kind, title, year_label, subject, story, person_id, media_id, tile_height, created_by, created_at)
     VALUES (@id, @kind, @title, @yearLabel, @subject, @story, @personId, @mediaId, @tileHeight, @createdBy, @createdAt)`,
  ).run({
    id,
    kind: input.kind,
    title: input.title,
    yearLabel: input.yearLabel?.trim() || 'לא ידוע',
    subject: input.subject?.trim() || 'כל המשפחה',
    story: input.story ?? '',
    personId: input.personId ?? null,
    mediaId: input.mediaId ?? null,
    tileHeight: tileHeightFor(id),
    createdBy,
    createdAt: nowIso(),
  });

  const created = getArchiveItem(id);
  if (!created) throw new Error('archive insert did not round-trip');
  return created;
}

/** Columns `updateArchiveItem` may touch, mapped from the API shape. */
const ARCHIVE_UPDATABLE: Record<string, string> = {
  kind: 'kind',
  title: 'title',
  yearLabel: 'year_label',
  subject: 'subject',
  story: 'story',
  personId: 'person_id',
  mediaId: 'media_id',
};

export function updateArchiveItem(
  id: string,
  patch: Record<string, unknown>,
): ArchiveItem | null {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, column] of Object.entries(ARCHIVE_UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    // personId and mediaId are nullable links; the text columns are not.
    const nullable = key === 'personId' || key === 'mediaId';
    params[key] = patch[key] ?? (nullable ? null : '');
  }

  if (sets.length > 0) {
    db.prepare(
      `UPDATE archive_items SET ${sets.join(', ')} WHERE id = @id AND archived_at IS NULL`,
    ).run(params);
  }
  return getArchiveItem(id);
}

export function archiveArchiveItem(id: string): void {
  db.prepare('UPDATE archive_items SET archived_at = ? WHERE id = ?').run(nowIso(), id);
}

/* ------------------------------------------------------------- timeline */

interface EventRow {
  id: string;
  year: number;
  title: string;
  person_id: string | null;
}

export function listTimelineEvents(): TimelineEvent[] {
  const rows = db
    .prepare(
      `SELECT id, year, title, person_id FROM timeline_events
        WHERE archived_at IS NULL ORDER BY year ASC`,
    )
    .all() as EventRow[];
  return rows.map((r) => ({
    id: r.id,
    year: r.year,
    title: r.title,
    personId: r.person_id,
  }));
}

export function createTimelineEvent(input: {
  year: number;
  title: string;
  personId?: string | null;
}): TimelineEvent {
  const id = newId('ev');
  db.prepare(
    'INSERT INTO timeline_events (id, year, title, person_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, input.year, input.title, input.personId ?? null, nowIso());
  return { id, year: input.year, title: input.title, personId: input.personId ?? null };
}

export function getTimelineEvent(id: string): TimelineEvent | null {
  const row = db
    .prepare(
      'SELECT id, year, title, person_id FROM timeline_events WHERE id = ? AND archived_at IS NULL',
    )
    .get(id) as EventRow | undefined;
  return row
    ? { id: row.id, year: row.year, title: row.title, personId: row.person_id }
    : null;
}

const EVENT_UPDATABLE: Record<string, string> = {
  year: 'year',
  title: 'title',
  personId: 'person_id',
};

export function updateTimelineEvent(
  id: string,
  patch: Record<string, unknown>,
): TimelineEvent | null {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, column] of Object.entries(EVENT_UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    params[key] = patch[key] ?? null;
  }

  if (sets.length > 0) {
    db.prepare(
      `UPDATE timeline_events SET ${sets.join(', ')} WHERE id = @id AND archived_at IS NULL`,
    ).run(params);
  }
  return getTimelineEvent(id);
}

/** Soft delete, matching every other record in the archive. */
export function archiveTimelineEvent(id: string): void {
  db.prepare('UPDATE timeline_events SET archived_at = ? WHERE id = ?').run(nowIso(), id);
}
