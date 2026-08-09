import type { Person, Relationship } from '../../../shared/types.ts';

/**
 * Where a newly added relative should sit on the tree canvas.
 *
 * The server can auto-place a person, but it only knows their birth year, so it
 * drops them at the next free slot in their generation's row. That is fine for
 * someone joining on their own and wrong for someone being added *as* a spouse
 * or a child — a new husband would land halfway across the board from his wife.
 *
 * The editor knows the intended relationship before the record exists, so it
 * computes the position here and sends explicit coordinates. Returning
 * `undefined` hands the decision back to the server.
 */

/** Node diameter; must match NODE_SIZE in tree-layout.ts. */
const NODE = 84;
/** Gap between two spouses, centre to centre. */
const SPOUSE_PITCH = 180;
/** Gap between siblings, centre to centre. */
const SIBLING_PITCH = 200;
/** Vertical distance between generations. */
const ROW_PITCH = 360;
/** Two nodes closer than this on the same row are overlapping. */
const MIN_CLEARANCE = NODE + 40;

export type NewPersonRelation =
  | { kind: 'none' }
  | { kind: 'spouse'; personId: string }
  | { kind: 'child'; parentIds: string[] }
  | { kind: 'parent'; childId: string };

export interface Placement {
  x: number;
  y: number;
}

function onSameRow(people: Person[], y: number): Person[] {
  return people.filter((p) => Math.abs(p.y - y) < NODE);
}

function isFree(people: Person[], x: number, y: number): boolean {
  return onSameRow(people, y).every((p) => Math.abs(p.x - x) >= MIN_CLEARANCE);
}

/**
 * Walks outward from `preferred` in `pitch` steps until a clear slot appears,
 * alternating sides so the tree grows evenly rather than always to one side.
 */
function nearestFreeSlot(
  people: Person[],
  preferred: number,
  y: number,
  pitch: number,
): number {
  if (isFree(people, preferred, y)) return preferred;
  for (let step = 1; step <= 24; step += 1) {
    for (const candidate of [preferred + step * pitch, preferred - step * pitch]) {
      if (isFree(people, candidate, y)) return candidate;
    }
  }
  return preferred;
}

export function placeNewPerson(
  relation: NewPersonRelation,
  people: Person[],
  relationships: Relationship[],
): Placement | undefined {
  const byId = new Map(people.map((p) => [p.id, p]));

  if (relation.kind === 'spouse') {
    const partner = byId.get(relation.personId);
    if (!partner) return undefined;

    // Sit beside the partner. Whichever side is clear wins; if both are, lean
    // away from the middle of that row so couples read as a pair on the edge
    // rather than being wedged between other people.
    const right = partner.x + SPOUSE_PITCH;
    const left = partner.x - SPOUSE_PITCH;
    const rightFree = isFree(people, right, partner.y);
    const leftFree = isFree(people, left, partner.y);

    if (rightFree && leftFree) {
      const row = onSameRow(people, partner.y);
      const centre = row.reduce((sum, p) => sum + p.x, 0) / Math.max(row.length, 1);
      return { x: partner.x >= centre ? right : left, y: partner.y };
    }
    if (rightFree) return { x: right, y: partner.y };
    if (leftFree) return { x: left, y: partner.y };

    return { x: nearestFreeSlot(people, right, partner.y, SPOUSE_PITCH), y: partner.y };
  }

  if (relation.kind === 'child') {
    const parents = relation.parentIds
      .map((id) => byId.get(id))
      .filter((p): p is Person => Boolean(p));
    if (parents.length === 0) return undefined;

    const y = Math.max(...parents.map((p) => p.y)) + ROW_PITCH;

    // Existing children of exactly these parents: line the new one up next to
    // its siblings so the sibling bus stays tight.
    const parentSet = new Set(relation.parentIds);
    const siblingIds = relationships
      .filter((r) => r.type === 'parent' && parentSet.has(r.personId))
      .map((r) => r.relatedPersonId);
    const siblings = [...new Set(siblingIds)]
      .map((id) => byId.get(id))
      .filter((p): p is Person => p !== undefined && Math.abs(p.y - y) < NODE);

    if (siblings.length > 0) {
      const rightmost = Math.max(...siblings.map((p) => p.x));
      return { x: nearestFreeSlot(people, rightmost + SIBLING_PITCH, y, SIBLING_PITCH), y };
    }

    // First child: directly below the midpoint of the parents.
    const midpoint = Math.round(
      parents.reduce((sum, p) => sum + p.x, 0) / parents.length,
    );
    return { x: nearestFreeSlot(people, midpoint, y, SIBLING_PITCH), y };
  }

  if (relation.kind === 'parent') {
    const child = byId.get(relation.childId);
    if (!child) return undefined;
    const y = child.y - ROW_PITCH;
    return { x: nearestFreeSlot(people, child.x, y, SPOUSE_PITCH), y };
  }

  return undefined;
}

