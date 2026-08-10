import type { ArchiveItem, ArchiveKind, TimelineEvent } from '../../../shared/types.js';

import { exec, nowIso, one, query, transact } from '../db/index.js';
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

/**
 * People links live in a junction table — a photograph of the wedding belongs
 * to everyone in it. The legacy `person_id` column is maintained as "the first
 * linked person" so nothing that predates multi-linking has to change shape.
 */
interface LinkRow {
  item_id: string;
  person_id: string;
}

function toItem(row: ArchiveRow, personIds: string[]): ArchiveItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    yearLabel: row.year_label,
    subject: row.subject,
    story: row.story,
    personId: personIds[0] ?? row.person_id,
    personIds,
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

/**
 * Replaces an item's people links wholesale, mirroring the first into person_id.
 *
 * One transaction, one multi-row insert. The first version deleted and then
 * inserted row by row outside any transaction — a wedding photograph of twenty
 * people cost twenty-two round trips, and a failure halfway left the links
 * half-written. Now a crash mid-way rolls back to the links it had before.
 */
async function setItemPeople(itemId: string, personIds: string[]): Promise<void> {
  await transact(async (tx) => {
    await tx.run('DELETE FROM archive_item_people WHERE item_id = @itemId', { itemId });
    if (personIds.length > 0) {
      await tx.run(
        `INSERT INTO archive_item_people (item_id, person_id)
         SELECT @itemId, unnest(@personIds::text[]) ON CONFLICT DO NOTHING`,
        { itemId, personIds },
      );
    }
    await tx.run('UPDATE archive_items SET person_id = @first WHERE id = @itemId', {
      itemId,
      first: personIds[0] ?? null,
    });
  });
}

/** Rows as the aggregate query returns them: links folded in as an array. */
type ArchiveRowWithPeople = ArchiveRow & { person_ids: string[] };

export async function listArchiveItems(
  filter: { kind?: ArchiveKind; personId?: string } = {},
): Promise<ArchiveItem[]> {
  const where = ['i.archived_at IS NULL'];
  const params: Record<string, unknown> = {};
  if (filter.kind) {
    where.push('i.kind = @kind');
    params['kind'] = filter.kind;
  }
  if (filter.personId) {
    where.push(
      'i.id IN (SELECT item_id FROM archive_item_people WHERE person_id = @personId)',
    );
    params['personId'] = filter.personId;
  }
  // Links come back folded into each row. The old shape fetched *every* link
  // in the table on every listing — even a single person's four keepsakes
  // paid for the whole archive's junction rows, and paid it again per filter.
  const rows = await query<ArchiveRowWithPeople>(
    `SELECT i.id, i.kind, i.title, i.year_label, i.subject, i.story, i.person_id,
            i.media_id, i.tile_height, i.created_by, i.created_at, i.archived_at,
            COALESCE(
              array_agg(l.person_id ORDER BY (l.person_id <> i.person_id), l.person_id)
                FILTER (WHERE l.person_id IS NOT NULL),
              '{}'
            ) AS person_ids
       FROM archive_items i
       LEFT JOIN archive_item_people l ON l.item_id = i.id
      WHERE ${where.join(' AND ')}
      GROUP BY i.id
      ORDER BY i.created_at DESC`,
    params,
  );
  return rows.map((row) => toItem(row, row.person_ids));
}

export async function getArchiveItem(id: string): Promise<ArchiveItem | null> {
  const row = await one<ArchiveRow>(`SELECT ${COLUMNS} FROM archive_items WHERE id = @id`, {
    id,
  });
  if (!row) return null;
  const links = await query<LinkRow>(
    'SELECT item_id, person_id FROM archive_item_people WHERE item_id = @id',
    { id },
  );
  return toItem(row, links.map((l) => l.person_id));
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
  personIds: string[];
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
      personId: input.personIds[0] ?? null,
      mediaId: input.mediaId ?? null,
      tileHeight: tileHeightFor(id),
      createdBy,
      createdAt: nowIso(),
    },
  );
  await setItemPeople(id, input.personIds);

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
  mediaId: 'media_id',
};

export async function updateArchiveItem(
  id: string,
  patch: Record<string, unknown> & { personIds?: string[] },
): Promise<ArchiveItem | null> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, column] of Object.entries(ARCHIVE_UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    // mediaId is a nullable link; the text columns are not.
    params[key] = patch[key] ?? (key === 'mediaId' ? null : '');
  }

  if (sets.length > 0) {
    await exec(
      `UPDATE archive_items SET ${sets.join(', ')} WHERE id = @id AND archived_at IS NULL`,
      params,
    );
  }
  if (patch.personIds) {
    await setItemPeople(id, patch.personIds);
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

interface EventLinkRow {
  event_id: string;
  person_id: string;
}

function toEvent(row: EventRow, personIds: string[]): TimelineEvent {
  return {
    id: row.id,
    year: row.year,
    title: row.title,
    personId: personIds[0] ?? row.person_id,
    personIds,
  };
}

/** Same shape as setItemPeople: one transaction, one multi-row insert. */
async function setEventPeople(eventId: string, personIds: string[]): Promise<void> {
  await transact(async (tx) => {
    await tx.run('DELETE FROM timeline_event_people WHERE event_id = @eventId', { eventId });
    if (personIds.length > 0) {
      await tx.run(
        `INSERT INTO timeline_event_people (event_id, person_id)
         SELECT @eventId, unnest(@personIds::text[]) ON CONFLICT DO NOTHING`,
        { eventId, personIds },
      );
    }
    await tx.run('UPDATE timeline_events SET person_id = @first WHERE id = @eventId', {
      eventId,
      first: personIds[0] ?? null,
    });
  });
}

export async function listTimelineEvents(): Promise<TimelineEvent[]> {
  // Links folded in per row, exactly as the archive listing does it.
  const rows = await query<EventRow & { person_ids: string[] }>(
    `SELECT e.id, e.year, e.title, e.person_id,
            COALESCE(
              array_agg(l.person_id ORDER BY (l.person_id <> e.person_id), l.person_id)
                FILTER (WHERE l.person_id IS NOT NULL),
              '{}'
            ) AS person_ids
       FROM timeline_events e
       LEFT JOIN timeline_event_people l ON l.event_id = e.id
      WHERE e.archived_at IS NULL
      GROUP BY e.id
      ORDER BY e.year ASC`,
  );
  return rows.map((row) => toEvent(row, row.person_ids));
}

export async function createTimelineEvent(input: {
  year: number;
  title: string;
  personIds: string[];
}): Promise<TimelineEvent> {
  const id = newId('ev');
  await exec(
    `INSERT INTO timeline_events (id, year, title, person_id, created_at)
     VALUES (@id, @year, @title, @personId, @at)`,
    {
      id,
      year: input.year,
      title: input.title,
      personId: input.personIds[0] ?? null,
      at: nowIso(),
    },
  );
  await setEventPeople(id, input.personIds);
  return {
    id,
    year: input.year,
    title: input.title,
    personId: input.personIds[0] ?? null,
    personIds: input.personIds,
  };
}

export async function getTimelineEvent(id: string): Promise<TimelineEvent | null> {
  const row = await one<EventRow>(
    'SELECT id, year, title, person_id FROM timeline_events WHERE id = @id AND archived_at IS NULL',
    { id },
  );
  if (!row) return null;
  const links = await query<EventLinkRow>(
    'SELECT event_id, person_id FROM timeline_event_people WHERE event_id = @id',
    { id },
  );
  return toEvent(row, links.map((l) => l.person_id));
}

const EVENT_UPDATABLE: Record<string, string> = {
  year: 'year',
  title: 'title',
};

export async function updateTimelineEvent(
  id: string,
  patch: Record<string, unknown> & { personIds?: string[] },
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
  if (patch.personIds) {
    await setEventPeople(id, patch.personIds);
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
