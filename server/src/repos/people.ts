import type {
  Milestone,
  Person,
  Relationship,
  RelationshipType,
} from '../../../shared/types.js';

import { exec, nowIso, one, query } from '../db/index.js';
import { generationIdForYear } from '../lib/generations.js';
import { newId } from '../lib/ids.js';

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

export async function listPeople(includeArchived = false): Promise<Person[]> {
  const rows = await query<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM people ${
      includeArchived ? '' : 'WHERE archived_at IS NULL'
    } ORDER BY y ASC, x DESC`,
  );
  return rows.map(toPerson);
}

export async function getPerson(id: string): Promise<Person | null> {
  const row = await one<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM people WHERE id = @id`,
    { id },
  );
  return row ? toPerson(row) : null;
}

/**
 * How many of these ids belong to living (non-archived) records. One query no
 * matter how many ids — the route that validates a treasure's people links
 * used to ask about each person separately.
 */
export async function countLivingPeople(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const row = await one<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM people
      WHERE id = ANY(@ids::text[]) AND archived_at IS NULL`,
    { ids },
  );
  return row?.count ?? 0;
}

export async function listMilestones(personId: string): Promise<Milestone[]> {
  const rows = await query<MilestoneRow>(
    `SELECT id, person_id, year_label, title, body, sort_order, created_by, created_at
       FROM milestones
      WHERE person_id = @personId AND archived_at IS NULL
      ORDER BY sort_order ASC, created_at ASC`,
    { personId },
  );
  return rows.map(toMilestone);
}

export async function listRelationships(): Promise<Relationship[]> {
  const rows = await query<RelationshipRow>(
    `SELECT r.id, r.person_id, r.related_person_id, r.type
       FROM relationships r
       JOIN people a ON a.id = r.person_id         AND a.archived_at IS NULL
       JOIN people b ON b.id = r.related_person_id AND b.archived_at IS NULL`,
  );
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
 * A generation is a row: everyone born into the same cohort stands on the row
 * that cohort already occupies, and a cohort with nobody on the board yet opens
 * one below the lowest.
 *
 * The row then simply grows sideways. That is the whole correction here — the
 * previous version tried twelve slots either side of the row's centre and, when
 * all of them were taken, started a *new row* for that one person. Which meant
 * a growing archive stopped being a tree: a hundred and fifty relatives came
 * out as thirty-nine rows, most holding a single person, on a board fourteen
 * thousand pixels tall that no screen could open at a readable scale. A row is
 * allowed to be as wide as the family is; it is not allowed to spawn rows.
 */
export async function suggestPosition(
  birthYear: number | null,
): Promise<{ x: number; y: number }> {
  // Only the coordinates matter here; hauling every row's story text across
  // the wire to place one node was the expensive part of adding a person.
  const people = await query<{ x: number; y: number; generation_id: string }>(
    'SELECT x, y, generation_id FROM people WHERE archived_at IS NULL',
  );
  if (people.length === 0) return { x: CANVAS_CENTRE_X, y: 140 };

  const generationId = generationIdForYear(birthYear);
  const sameGen = people.filter((p) => p.generation_id === generationId);

  const lowestY = Math.max(...people.map((p) => p.y));
  const row = sameGen.length > 0 ? Math.min(...sameGen.map((p) => p.y)) : lowestY + ROW_PITCH;

  const occupied = people.filter((p) => Math.abs(p.y - row) < NODE_SIZE).map((p) => p.x);
  if (occupied.length === 0) return { x: CANVAS_CENTRE_X, y: row };

  const CLEARANCE = NODE_SIZE + 40;
  const clear = (x: number) => occupied.every((o) => Math.abs(o - x) >= CLEARANCE);

  // Outwards from the row's centre of mass, looking for a gap between people
  // who are already there — a returning relative slotted between cousins reads
  // better than one tacked onto the end.
  const anchor = Math.round(occupied.reduce((a, b) => a + b, 0) / occupied.length);
  for (let step = 1; step <= 12; step += 1) {
    for (const x of [anchor + step * COL_PITCH, anchor - step * COL_PITCH]) {
      if (clear(x)) return { x, y: row };
    }
  }

  // No gap near the middle: extend the row past whichever end is nearer, so the
  // cohort widens instead of the board growing another storey.
  const leftEnd = Math.min(...occupied);
  const rightEnd = Math.max(...occupied);
  const beyondRight = rightEnd + COL_PITCH;
  const beyondLeft = leftEnd - COL_PITCH;
  const x =
    Math.abs(beyondRight - anchor) <= Math.abs(beyondLeft - anchor) ? beyondRight : beyondLeft;
  return { x, y: row };
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
  portraitMediaId?: string | null;
  audioMediaId?: string | null;
  audioLabel?: string | null;
}

export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const at = nowIso();
  const id = newId('p');
  const birthYear = input.birthYear ?? null;
  const position =
    input.x != null && input.y != null
      ? { x: input.x, y: input.y }
      : await suggestPosition(birthYear);

  await exec(
    `INSERT INTO people
       (id, full_name, initial, life_span, place, story, birth_year, death_year,
        branch, x, y, is_provisional, generation_id,
        portrait_media_id, audio_media_id, audio_label, created_at, updated_at)
     VALUES
       (@id, @fullName, @initial, @lifeSpan, @place, @story, @birthYear, @deathYear,
        @branch, @x, @y, @isProvisional, @generationId,
        @portraitMediaId, @audioMediaId, @audioLabel, @at, @at)`,
    {
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
      portraitMediaId: input.portraitMediaId ?? null,
      audioMediaId: input.audioMediaId ?? null,
      audioLabel: input.audioLabel ?? null,
      at,
    },
  );

  const created = await getPerson(id);
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

export async function updatePerson(
  id: string,
  patch: Record<string, unknown>,
): Promise<Person | null> {
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

  await exec(
    `UPDATE people SET ${sets.join(', ')}, updated_at = @at WHERE id = @id AND archived_at IS NULL`,
    params,
  );

  return getPerson(id);
}

/** Soft delete. The row and everything hanging off it stays recoverable. */
export async function archivePerson(id: string): Promise<Person | null> {
  await exec(
    'UPDATE people SET archived_at = @at, updated_at = @at WHERE id = @id AND archived_at IS NULL',
    { at: nowIso(), id },
  );
  return getPerson(id);
}

export async function restorePerson(id: string): Promise<Person | null> {
  await exec('UPDATE people SET archived_at = NULL, updated_at = @at WHERE id = @id', {
    at: nowIso(),
    id,
  });
  return getPerson(id);
}

export async function addMilestone(
  personId: string,
  input: { yearLabel: string; title: string; body?: string },
  createdBy: string | null,
): Promise<Milestone> {
  const id = newId('ms');
  const ordering = await one<{ next: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM milestones WHERE person_id = @personId',
    { personId },
  );

  const [row] = await query<MilestoneRow>(
    `INSERT INTO milestones (id, person_id, year_label, title, body, sort_order, created_by, created_at)
     VALUES (@id, @personId, @yearLabel, @title, @body, @sortOrder, @createdBy, @at)
     RETURNING id, person_id, year_label, title, body, sort_order, created_by, created_at`,
    {
      id,
      personId,
      yearLabel: input.yearLabel,
      title: input.title,
      body: input.body ?? '',
      sortOrder: ordering?.next ?? 0,
      createdBy,
      at: nowIso(),
    },
  );
  if (!row) throw new Error('milestone insert did not round-trip');
  return toMilestone(row);
}

/** Columns `updateMilestone` may touch, mapped from the API shape. */
const MILESTONE_UPDATABLE: Record<string, string> = {
  yearLabel: 'year_label',
  title: 'title',
  body: 'body',
};

export async function updateMilestone(
  id: string,
  patch: Record<string, unknown>,
): Promise<Milestone | null> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, column] of Object.entries(MILESTONE_UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    params[key] = patch[key] ?? '';
  }

  if (sets.length > 0) {
    await exec(
      `UPDATE milestones SET ${sets.join(', ')} WHERE id = @id AND archived_at IS NULL`,
      params,
    );
  }

  const row = await one<MilestoneRow>(
    `SELECT id, person_id, year_label, title, body, sort_order, created_by, created_at
       FROM milestones WHERE id = @id AND archived_at IS NULL`,
    { id },
  );
  return row ? toMilestone(row) : null;
}

export async function archiveMilestone(id: string): Promise<void> {
  await exec('UPDATE milestones SET archived_at = @at WHERE id = @id', { at: nowIso(), id });
}

export async function addRelationship(
  personId: string,
  relatedPersonId: string,
  type: RelationshipType,
): Promise<Relationship> {
  const id = newId('rel');
  // A spouse link is symmetric; storing it in both directions would double the
  // connectors drawn, so an existing pair in either direction wins.
  if (type === 'spouse') {
    const existing = await one<RelationshipRow>(
      `SELECT id, person_id, related_person_id, type FROM relationships
        WHERE type = 'spouse'
          AND ((person_id = @personId AND related_person_id = @relatedPersonId)
            OR (person_id = @relatedPersonId AND related_person_id = @personId))`,
      { personId, relatedPersonId },
    );
    if (existing) {
      return {
        id: existing.id,
        personId: existing.person_id,
        relatedPersonId: existing.related_person_id,
        type: existing.type,
      };
    }
  }

  await exec(
    `INSERT INTO relationships (id, person_id, related_person_id, type, created_at)
     VALUES (@id, @personId, @relatedPersonId, @type, @at)
     ON CONFLICT (person_id, related_person_id, type) DO NOTHING`,
    { id, personId, relatedPersonId, type, at: nowIso() },
  );

  const row = await one<RelationshipRow>(
    `SELECT id, person_id, related_person_id, type FROM relationships
      WHERE person_id = @personId AND related_person_id = @relatedPersonId AND type = @type`,
    { personId, relatedPersonId, type },
  );
  if (!row) throw new Error('relationship insert did not round-trip');

  return {
    id: row.id,
    personId: row.person_id,
    relatedPersonId: row.related_person_id,
    type: row.type,
  };
}

export async function removeRelationship(id: string): Promise<void> {
  await exec('DELETE FROM relationships WHERE id = @id', { id });
}

/**
 * True when adding `parentId → childId` would put a person in their own
 * ancestry. Walks up from the prospective parent looking for the child.
 */
export async function wouldCreateCycle(parentId: string, childId: string): Promise<boolean> {
  if (parentId === childId) return true;

  // One query, then walk in memory. The old version issued a query per node
  // visited, which was free against a local file and is a network round-trip
  // per ancestor against managed Postgres.
  const edges = await query<{ child: string; parent: string }>(
    `SELECT related_person_id AS child, person_id AS parent
       FROM relationships WHERE type = 'parent'`,
  );
  const parentsOf = new Map<string, string[]>();
  for (const edge of edges) {
    parentsOf.set(edge.child, [...(parentsOf.get(edge.child) ?? []), edge.parent]);
  }

  const seen = new Set<string>();
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === childId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(parentsOf.get(current) ?? []));
  }
  return false;
}
