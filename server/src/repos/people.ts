import type {
  Milestone,
  Person,
  Relationship,
  RelationshipType,
} from '../../../shared/types.ts';

import { db, nowIso } from '../db/index.ts';
import { generationIdForYear } from '../lib/generations.ts';
import { newId } from '../lib/ids.ts';

interface PersonRow {
  id: string;
  full_name: string;
  initial: string;
  life_span: string;
  place: string;
  story: string;
  birth_year: number | null;
  death_year: number | null;
  branch: string | null;
  audio_label: string | null;
  audio_media_id: string | null;
  portrait_media_id: string | null;
  x: number;
  y: number;
  is_provisional: number;
  generation_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    fullName: row.full_name,
    initial: row.initial,
    lifeSpan: row.life_span,
    place: row.place,
    story: row.story,
    birthYear: row.birth_year,
    deathYear: row.death_year,
    branch: row.branch,
    audioLabel: row.audio_label,
    audioMediaId: row.audio_media_id,
    portraitMediaId: row.portrait_media_id,
    x: row.x,
    y: row.y,
    isProvisional: row.is_provisional === 1,
    generationId: row.generation_id,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface MilestoneRow {
  id: string;
  person_id: string;
  year_label: string;
  title: string;
  body: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    personId: row.person_id,
    yearLabel: row.year_label,
    title: row.title,
    body: row.body,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

interface RelationshipRow {
  id: string;
  person_id: string;
  related_person_id: string;
  type: RelationshipType;
}

const PERSON_COLUMNS = `
  id, full_name, initial, life_span, place, story, birth_year, death_year,
  branch, audio_label, audio_media_id, portrait_media_id, x, y,
  is_provisional, generation_id, archived_at, created_at, updated_at
`;

export function listPeople(includeArchived = false): Person[] {
  const sql = `SELECT ${PERSON_COLUMNS} FROM people ${
    includeArchived ? '' : 'WHERE archived_at IS NULL'
  } ORDER BY y ASC, x DESC`;
  return (db.prepare(sql).all() as PersonRow[]).map(toPerson);
}

export function getPerson(id: string): Person | null {
  const row = db
    .prepare(`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`)
    .get(id) as PersonRow | undefined;
  return row ? toPerson(row) : null;
}

export function listMilestones(personId: string): Milestone[] {
  const rows = db
    .prepare(
      `SELECT id, person_id, year_label, title, body, sort_order, created_by, created_at
         FROM milestones
        WHERE person_id = ? AND archived_at IS NULL
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(personId) as MilestoneRow[];
  return rows.map(toMilestone);
}

export function listRelationships(): Relationship[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.person_id, r.related_person_id, r.type
         FROM relationships r
         JOIN people a ON a.id = r.person_id         AND a.archived_at IS NULL
         JOIN people b ON b.id = r.related_person_id AND b.archived_at IS NULL`,
    )
    .all() as RelationshipRow[];
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    relatedPersonId: r.related_person_id,
    type: r.type,
  }));
}

/** Node size and row pitch on the tree canvas; mirrored by the client layout. */
const NODE_SIZE = 84;
const ROW_PITCH = 360;
const COL_PITCH = 200;
const CANVAS_CENTRE_X = 910;

/**
 * Places a new node on the canvas without overlapping anyone.
 *
 * People of the same generation belong on the same row, so the row is chosen by
 * birth year where the generation already exists on the board; otherwise the
 * node lands on a fresh row below everything. Within a row we walk outwards
 * from the centre until a slot is clear.
 */
export function suggestPosition(birthYear: number | null): { x: number; y: number } {
  const people = listPeople();
  if (people.length === 0) return { x: CANVAS_CENTRE_X, y: 140 };

  const generationId = generationIdForYear(birthYear);
  const sameGen = people.filter((p) => p.generationId === generationId);

  const lowestY = Math.max(...people.map((p) => p.y));
  const row = sameGen.length > 0 ? Math.min(...sameGen.map((p) => p.y)) : lowestY + ROW_PITCH;

  const occupied = people.filter((p) => Math.abs(p.y - row) < NODE_SIZE).map((p) => p.x);
  if (occupied.length === 0) return { x: CANVAS_CENTRE_X, y: row };

  const clear = (x: number) => occupied.every((o) => Math.abs(o - x) >= NODE_SIZE + 40);

  const anchor = Math.round(occupied.reduce((a, b) => a + b, 0) / occupied.length);
  for (let step = 1; step <= 12; step += 1) {
    for (const x of [anchor + step * COL_PITCH, anchor - step * COL_PITCH]) {
      if (clear(x)) return { x, y: row };
    }
  }
  // Board is unusually full at this row — start a new one rather than overlap.
  return { x: CANVAS_CENTRE_X, y: lowestY + ROW_PITCH };
}

export interface CreatePersonInput {
  fullName: string;
  initial?: string;
  lifeSpan?: string;
  place?: string;
  story?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  branch?: string | null;
  x?: number;
  y?: number;
  isProvisional?: boolean;
}

export function createPerson(input: CreatePersonInput): Person {
  const at = nowIso();
  const id = newId('p');
  const birthYear = input.birthYear ?? null;
  const position =
    input.x != null && input.y != null
      ? { x: input.x, y: input.y }
      : suggestPosition(birthYear);

  db.prepare(
    `INSERT INTO people
       (id, full_name, initial, life_span, place, story, birth_year, death_year,
        branch, x, y, is_provisional, generation_id, created_at, updated_at)
     VALUES
       (@id, @fullName, @initial, @lifeSpan, @place, @story, @birthYear, @deathYear,
        @branch, @x, @y, @isProvisional, @generationId, @at, @at)`,
  ).run({
    id,
    fullName: input.fullName,
    initial: input.initial?.slice(0, 2) || [...input.fullName.trim()][0] || '✦',
    lifeSpan: input.lifeSpan ?? (birthYear ? `נ׳ ${birthYear}` : ''),
    place: input.place ?? '',
    story: input.story ?? '',
    birthYear,
    deathYear: input.deathYear ?? null,
    branch: input.branch ?? null,
    x: position.x,
    y: position.y,
    isProvisional: input.isProvisional ? 1 : 0,
    generationId: generationIdForYear(birthYear),
    at,
  });

  const created = getPerson(id);
  if (!created) throw new Error('person insert did not round-trip');
  return created;
}

/** Column names that `updatePerson` is allowed to touch, mapped from the API shape. */
const UPDATABLE: Record<string, string> = {
  fullName: 'full_name',
  initial: 'initial',
  lifeSpan: 'life_span',
  place: 'place',
  story: 'story',
  birthYear: 'birth_year',
  deathYear: 'death_year',
  branch: 'branch',
  audioLabel: 'audio_label',
  audioMediaId: 'audio_media_id',
  portraitMediaId: 'portrait_media_id',
  x: 'x',
  y: 'y',
};

export function updatePerson(id: string, patch: Record<string, unknown>): Person | null {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, at: nowIso() };

  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    params[key] = patch[key] ?? null;
  }

  // Birth year drives the cohort colour, so they must move together.
  if ('birthYear' in patch) {
    sets.push('generation_id = @generationId');
    params['generationId'] = generationIdForYear(patch['birthYear'] as number | null);
  }

  if (sets.length === 0) return getPerson(id);

  db.prepare(
    `UPDATE people SET ${sets.join(', ')}, updated_at = @at WHERE id = @id AND archived_at IS NULL`,
  ).run(params);

  return getPerson(id);
}

/** Soft delete. The row and everything hanging off it stays recoverable. */
export function archivePerson(id: string): Person | null {
  db.prepare('UPDATE people SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL')
    .run(nowIso(), nowIso(), id);
  return getPerson(id);
}

export function restorePerson(id: string): Person | null {
  db.prepare('UPDATE people SET archived_at = NULL, updated_at = ? WHERE id = ?').run(
    nowIso(),
    id,
  );
  return getPerson(id);
}

export function addMilestone(
  personId: string,
  input: { yearLabel: string; title: string; body?: string },
  createdBy: string | null,
): Milestone {
  const id = newId('ms');
  const { next } = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM milestones WHERE person_id = ?',
    )
    .get(personId) as { next: number };

  db.prepare(
    `INSERT INTO milestones (id, person_id, year_label, title, body, sort_order, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, personId, input.yearLabel, input.title, input.body ?? '', next, createdBy, nowIso());

  const row = db
    .prepare(
      `SELECT id, person_id, year_label, title, body, sort_order, created_by, created_at
         FROM milestones WHERE id = ?`,
    )
    .get(id) as MilestoneRow;
  return toMilestone(row);
}

export function archiveMilestone(id: string): void {
  db.prepare('UPDATE milestones SET archived_at = ? WHERE id = ?').run(nowIso(), id);
}

export function addRelationship(
  personId: string,
  relatedPersonId: string,
  type: RelationshipType,
): Relationship {
  const id = newId('rel');
  // A spouse link is symmetric; storing it in both directions would double the
  // connectors drawn, so an existing pair in either direction wins.
  if (type === 'spouse') {
    const existing = db
      .prepare(
        `SELECT id, person_id, related_person_id, type FROM relationships
          WHERE type = 'spouse'
            AND ((person_id = ? AND related_person_id = ?) OR (person_id = ? AND related_person_id = ?))`,
      )
      .get(personId, relatedPersonId, relatedPersonId, personId) as
      | RelationshipRow
      | undefined;
    if (existing) {
      return {
        id: existing.id,
        personId: existing.person_id,
        relatedPersonId: existing.related_person_id,
        type: existing.type,
      };
    }
  }

  db.prepare(
    `INSERT INTO relationships (id, person_id, related_person_id, type, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (person_id, related_person_id, type) DO NOTHING`,
  ).run(id, personId, relatedPersonId, type, nowIso());

  const row = db
    .prepare(
      `SELECT id, person_id, related_person_id, type FROM relationships
        WHERE person_id = ? AND related_person_id = ? AND type = ?`,
    )
    .get(personId, relatedPersonId, type) as RelationshipRow;

  return {
    id: row.id,
    personId: row.person_id,
    relatedPersonId: row.related_person_id,
    type: row.type,
  };
}

export function removeRelationship(id: string): void {
  db.prepare('DELETE FROM relationships WHERE id = ?').run(id);
}

/**
 * True when adding `parentId → childId` would put a person in their own
 * ancestry. Walks up from the prospective parent looking for the child.
 */
export function wouldCreateCycle(parentId: string, childId: string): boolean {
  if (parentId === childId) return true;
  const parentsOf = db.prepare(
    "SELECT person_id AS id FROM relationships WHERE related_person_id = ? AND type = 'parent'",
  );
  const seen = new Set<string>();
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === childId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const row of parentsOf.all(current) as Array<{ id: string }>) {
      queue.push(row.id);
    }
  }
  return false;
}
