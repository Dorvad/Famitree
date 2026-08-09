import type { Person, Relationship } from '../../../shared/types.ts';

/**
 * Rearranges the whole board from the relationships alone.
 *
 * Positions on the tree are hand-placed, and hands drift: couples end up
 * split, a child lands beside their parents instead of below them, two people
 * share a spot. This computes a clean arrangement — rows by actual descent,
 * couples adjacent, every sibling group centred under its parents, nothing
 * overlapping — and returns the moves for the caller to apply and persist.
 *
 * The pitches match `placement.ts`, so a tree that was tidied and a tree that
 * grew one relative at a time speak the same grid.
 */

const SPOUSE_PITCH = 180;
const SIBLING_PITCH = 200;
/** Extra air between unrelated family clusters on the same row. */
const GROUP_GAP = 120;
const ROW_PITCH = 360;

export interface TidyMove {
  id: string;
  x: number;
  y: number;
}

export function tidyPositions(people: Person[], relationships: Relationship[]): TidyMove[] {
  if (people.length === 0) return [];

  const ids = new Set(people.map((p) => p.id));
  const byId = new Map(people.map((p) => [p.id, p]));

  const parentsOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();

  for (const rel of relationships) {
    if (!ids.has(rel.personId) || !ids.has(rel.relatedPersonId)) continue;
    if (rel.type === 'parent') {
      parentsOf.set(rel.relatedPersonId, [
        ...(parentsOf.get(rel.relatedPersonId) ?? []),
        rel.personId,
      ]);
    } else if (rel.type === 'spouse') {
      spousesOf.set(rel.personId, [...(spousesOf.get(rel.personId) ?? []), rel.relatedPersonId]);
      spousesOf.set(rel.relatedPersonId, [
        ...(spousesOf.get(rel.relatedPersonId) ?? []),
        rel.personId,
      ]);
    }
  }

  /* ------------------------------------------------------------- depths */

  // Descent depth: no parents in the data means row 0, a child sits one row
  // below their deepest parent, and spouses are pulled onto the same row.
  // Iterated to a fixpoint; the iteration cap makes bad data (a cycle of
  // parent links) terminate instead of pushing a row down forever.
  const depth = new Map<string, number>(people.map((p) => [p.id, 0]));
  for (let pass = 0; pass < people.length + 2; pass += 1) {
    let changed = false;
    for (const [childId, parentIds] of parentsOf) {
      const want = Math.max(...parentIds.map((id) => depth.get(id) ?? 0)) + 1;
      if (want > (depth.get(childId) ?? 0) && want <= people.length) {
        depth.set(childId, want);
        changed = true;
      }
    }
    for (const [a, partners] of spousesOf) {
      const want = Math.max(depth.get(a) ?? 0, ...partners.map((id) => depth.get(id) ?? 0));
      if (want > (depth.get(a) ?? 0)) {
        depth.set(a, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const rows = new Map<number, Person[]>();
  for (const person of people) {
    const d = depth.get(person.id) ?? 0;
    rows.set(d, [...(rows.get(d) ?? []), person]);
  }
  const rowDepths = [...rows.keys()].sort((a, b) => a - b);

  /* --------------------------------------------------------- horizontal */

  const newX = new Map<string, number>();
  const placedInRow = new Map<number, Set<string>>();

  /**
   * A person plus the partners who married into the tree (no parents of their
   * own here) — they ride along rather than belonging to a sibling group.
   */
  function cluster(person: Person, rowSet: Set<string>): Person[] {
    const members = [person];
    for (const partnerId of spousesOf.get(person.id) ?? []) {
      if (rowSet.has(partnerId)) continue;
      if (parentsOf.has(partnerId)) continue;
      if (depth.get(partnerId) !== depth.get(person.id)) continue;
      const partner = byId.get(partnerId);
      if (partner) {
        members.push(partner);
        rowSet.add(partnerId);
      }
    }
    return members;
  }

  /** Lays a cluster's members out from `startX`, returns the next free x. */
  function placeCluster(members: Person[], startX: number): number {
    let x = startX;
    for (const member of members) {
      newX.set(member.id, x);
      x += SPOUSE_PITCH;
    }
    return x - SPOUSE_PITCH;
  }

  for (const d of rowDepths) {
    const rowPeople = (rows.get(d) ?? []).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    const rowSet = new Set<string>();
    placedInRow.set(d, rowSet);

    // Sibling groups: children keyed by their parent couple, ordered by where
    // those parents now stand, so families never cross each other's drops.
    interface Group {
      desired: number;
      clusters: Person[][];
    }
    const groups: Group[] = [];
    const loose: Person[][] = [];

    const groupByKey = new Map<string, Group>();
    for (const person of rowPeople) {
      if (rowSet.has(person.id)) continue;
      const parentIds = parentsOf.get(person.id);
      if (!parentIds || parentIds.length === 0) {
        rowSet.add(person.id);
        loose.push(cluster(person, rowSet));
        continue;
      }
      rowSet.add(person.id);
      const key = [...parentIds].sort().join('|');
      const placedParents = parentIds.filter((id) => newX.has(id));
      const desired =
        placedParents.length > 0
          ? placedParents.reduce((sum, id) => sum + (newX.get(id) ?? 0), 0) /
            placedParents.length
          : person.x;
      const group = groupByKey.get(key) ?? { desired, clusters: [] };
      group.clusters.push(cluster(person, rowSet));
      groupByKey.set(key, group);
      if (!groups.includes(group)) groups.push(group);
    }

    groups.sort((a, b) => a.desired - b.desired);

    // One cursor sweeps the row: every group asks to be centred under its
    // parents and is pushed right exactly as far as earlier groups require.
    let cursor = Number.NEGATIVE_INFINITY;
    for (const group of groups) {
      const width = group.clusters.reduce(
        (sum, members, index) =>
          sum + (members.length - 1) * SPOUSE_PITCH + (index > 0 ? SIBLING_PITCH : 0),
        0,
      );
      let x = Math.max(group.desired - width / 2, cursor);
      for (const members of group.clusters) {
        x = placeCluster(members, x) + SIBLING_PITCH;
      }
      cursor = x - SIBLING_PITCH + GROUP_GAP + SIBLING_PITCH;
    }

    // People with no parents here — the founding row, and anyone unlinked —
    // continue after the last group, preserving their left-to-right order.
    for (const members of loose) {
      if (cursor === Number.NEGATIVE_INFINITY) cursor = 0;
      cursor = placeCluster(members, cursor) + SIBLING_PITCH + GROUP_GAP;
    }
  }

  /* ------------------------------------------------------------- output */

  const moves: TidyMove[] = [];
  for (const person of people) {
    const x = Math.round(newX.get(person.id) ?? person.x);
    const y = (depth.get(person.id) ?? 0) * ROW_PITCH;
    if (x !== person.x || y !== person.y) moves.push({ id: person.id, x, y });
  }
  return moves;
}
