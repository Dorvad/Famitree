import type { ArchiveItem, ArchiveKind, TimelineEvent } from '../../../shared/types.js';

import { exec, nowIso, one, query } from '../db/index.js';
import { newId } from '../lib/ids.js';

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

export async function listArchiveItems(
  filter: { kind?: ArchiveKind; personId?: string } = {},
): Promise<ArchiveItem[]> {
  const where = ['archived_at IS NULL'];
  const params: Record<string, unknown> = {};
  if (filter.kind) {
    where.push('kind = @kind');
    params['kind'] = filter.kind;
  }
  if (filter.personId) {
    where.push('person_id = @personId');
    params['personId'] = filter.personId;
  }
  const rows = await query<ArchiveRow>(
    `SELECT ${COLUMNS} FROM archive_items WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(toItem);
}

export async function getArchiveItem(id: string): Promise<ArchiveItem | null> {
  const row = await one<ArchiveRow>(`SELECT ${COLUMNS} FROM archive_items WHERE id = @id`, {
    id,
  });
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

export async function createArchiveItem(
  input: CreateArchiveInput,
  createdBy: string | null,
): Promise<ArchiveItem> {
  const id = newId('it');
  await exec(
    `INSERT INTO archive_items
       (id, kind, title, year_label, subject, story, person_id, media_id, tile_height, created_by, created_at)
     VALUES (@id, @kind, @title, @yearLabel, @subject, @story, @personId, @mediaId, @tileHeight, @createdBy, @createdAt)`,
    {
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
    },
  );

  const created = await getArchiveItem(id);
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

export async function updateArchiveItem(
  id: string,
  patch: Record<string, unknown>,
): Promise<ArchiveItem | null> {
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
    await exec(
      `UPDATE archive_items SET ${sets.join(', ')} WHERE id = @id AND archived_at IS NULL`,
      params,
    );
  }
  return getArchiveItem(id);
}

export async function archiveArchiveItem(id: string): Promise<void> {
  await exec('UPDATE archive_items SET archived_at = @at WHERE id = @id', { at: nowIso(), id });
}

/* ------------------------------------------------------------- timeline */

interface EventRow {
  id: string;
  year: number;
  title: string;
  person_id: string | null;
}

export async function listTimelineEvents(): Promise<TimelineEvent[]> {
  const rows = await query<EventRow>(
    `SELECT id, year, title, person_id FROM timeline_events
      WHERE archived_at IS NULL ORDER BY year ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    year: r.year,
    title: r.title,
    personId: r.person_id,
  }));
}

export async function createTimelineEvent(input: {
  year: number;
  title: string;
  personId?: string | null;
}): Promise<TimelineEvent> {
  const id = newId('ev');
  await exec(
    `INSERT INTO timeline_events (id, year, title, person_id, created_at)
     VALUES (@id, @year, @title, @personId, @at)`,
    { id, year: input.year, title: input.title, personId: input.personId ?? null, at: nowIso() },
  );
  return { id, year: input.year, title: input.title, personId: input.personId ?? null };
}

export async function getTimelineEvent(id: string): Promise<TimelineEvent | null> {
  const row = await one<EventRow>(
    'SELECT id, year, title, person_id FROM timeline_events WHERE id = @id AND archived_at IS NULL',
    { id },
  );
  return row
    ? { id: row.id, year: row.year, title: row.title, personId: row.person_id }
    : null;
}

const EVENT_UPDATABLE: Record<string, string> = {
  year: 'year',
  title: 'title',
  personId: 'person_id',
};

export async function updateTimelineEvent(
  id: string,
  patch: Record<string, unknown>,
): Promise<TimelineEvent | null> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, column] of Object.entries(EVENT_UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    params[key] = patch[key] ?? null;
  }

  if (sets.length > 0) {
    await exec(
      `UPDATE timeline_events SET ${sets.join(', ')} WHERE id = @id AND archived_at IS NULL`,
      params,
    );
  }
  return getTimelineEvent(id);
}

/** Soft delete, matching every other record in the archive. */
export async function archiveTimelineEvent(id: string): Promise<void> {
  await exec('UPDATE timeline_events SET archived_at = @at WHERE id = @id', {
    at: nowIso(),
    id,
  });
}
