import type { Relationship } from '../../../shared/types.ts';

import type { TreeLayout, TreeNode } from './tree-layout.ts';

/**
 * Groups the tree into nuclear-family cells for the zoomed-out view.
 *
 * Far enough out, eighty separate circles are confetti: unreadable and
 * untappable. What a person actually scans for at that distance is "the
 * Rosenberg household", so that is what gets drawn — one card per nuclear
 * family, joined by one line per parent-child bond between families.
 *
 * Membership is one cell per person: anyone with a spouse or children heads
 * their own cell (with their partner beside them); everyone else sits in
 * their parents' cell; someone with no ties at all stands alone. The split
 * mirrors how families narrate themselves — a married child has "left home"
 * into a cell of their own, and the line back to the parents' card carries
 * the descent.
 */

export interface FamilyCell {
  id: string;
  members: TreeNode[];
  /** "משפחת רוזנברג", derived from the heads' most common family name. */
  label: string;
  /** Centre of the cell card, in canvas coordinates. */
  cx: number;
  cy: number;
  /** Bounds of the members' actual nodes — what a tap zooms in to. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface CellLink {
  id: string;
  d: string;
}

export interface FamilyCellMap {
  cells: FamilyCell[];
  links: CellLink[];
  /** Cell each person belongs to, for markers like "אתם כאן". */
  cellOf: Map<string, string>;
}

/** Minimum centre-to-centre distance before two cards get pushed apart. */
/**
 * Least distance allowed between two family cards, in canvas units.
 *
 * It has to be wider than a card, which is the bug this replaces: at 240 the
 * separation pass was pushing cards to 240 apart while the card itself measured
 * 269 across, so on a board with many families the cards overlapped and buried
 * each other's labels no matter how the board was zoomed.
 */
const CELL_CLEARANCE = 310;

/** The family name: last word once nicknames and maiden names are removed. */
export function familyName(fullName: string): string {
  const cleaned = fullName
    .replace(/["“”„״]+[^"“”„״]*["“”„״]+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

export function buildFamilyCells(
  layout: TreeLayout,
  relationships: Relationship[],
): FamilyCellMap {
  const nodes = layout.nodes;
  if (nodes.length === 0) return { cells: [], links: [], cellOf: new Map() };

  const has = (id: string) => layout.byId.has(id);
  const spousesOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const hasChildren = new Set<string>();

  for (const rel of relationships) {
    if (!has(rel.personId) || !has(rel.relatedPersonId)) continue;
    if (rel.type === 'spouse') {
      spousesOf.set(rel.personId, [...(spousesOf.get(rel.personId) ?? []), rel.relatedPersonId]);
      spousesOf.set(rel.relatedPersonId, [
        ...(spousesOf.get(rel.relatedPersonId) ?? []),
        rel.personId,
      ]);
    } else {
      parentsOf.set(rel.relatedPersonId, [
        ...(parentsOf.get(rel.relatedPersonId) ?? []),
        rel.personId,
      ]);
      hasChildren.add(rel.personId);
    }
  }

  const isHead = (id: string) => hasChildren.has(id) || (spousesOf.get(id)?.length ?? 0) > 0;

  /* -------------------------------------------------------------- members */

  const cellOf = new Map<string, string>();
  const membersOf = new Map<string, TreeNode[]>();

  const join = (cellId: string, node: TreeNode) => {
    if (cellOf.has(node.person.id)) return;
    cellOf.set(node.person.id, cellId);
    membersOf.set(cellId, [...(membersOf.get(cellId) ?? []), node]);
  };

  // Heads first: each spouse-connected component becomes one cell.
  for (const node of nodes) {
    const id = node.person.id;
    if (!isHead(id) || cellOf.has(id)) continue;

    const component = [id];
    for (let i = 0; i < component.length; i += 1) {
      for (const partner of spousesOf.get(component[i] as string) ?? []) {
        if (!component.includes(partner)) component.push(partner);
      }
    }
    const cellId = `cell-${[...component].sort().join('|')}`;
    for (const memberId of component) {
      const member = layout.byId.get(memberId);
      if (member) join(cellId, member);
    }
  }

  // Everyone else joins their parents' cell, or stands alone.
  for (const node of nodes) {
    const id = node.person.id;
    if (cellOf.has(id)) continue;
    const parentCell = (parentsOf.get(id) ?? [])
      .map((parentId) => cellOf.get(parentId))
      .find(Boolean);
    join(parentCell ?? `solo-${id}`, node);
  }

  /* ---------------------------------------------------------------- cells */

  const HALF = 42; // node radius on the canvas, for the bounds

  const cells: FamilyCell[] = [...membersOf.entries()].map(([id, members]) => {
    const xs = members.map((m) => m.cx);
    const ys = members.map((m) => m.cy);

    const names = members
      .filter((m) => isHead(m.person.id))
      .map((m) => familyName(m.person.fullName));
    const pool = names.length > 0 ? names : members.map((m) => familyName(m.person.fullName));
    const counts = new Map<string, number>();
    for (const name of pool) counts.set(name, (counts.get(name) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    return {
      id,
      members,
      label: top ? `משפחת ${top}` : 'משפחה',
      cx: xs.reduce((s, v) => s + v, 0) / xs.length,
      cy: ys.reduce((s, v) => s + v, 0) / ys.length,
      bounds: {
        minX: Math.min(...xs) - HALF,
        minY: Math.min(...ys) - HALF,
        maxX: Math.max(...xs) + HALF,
        maxY: Math.max(...ys) + HALF,
      },
    };
  });

  // Two small families can share a neighbourhood; their cards must not share
  // a spot. A few relaxation passes push near-coincident cards apart.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const a of cells) {
      for (const b of cells) {
        if (a === b || Math.abs(a.cy - b.cy) > CELL_CLEARANCE * 0.6) continue;
        const gap = b.cx - a.cx;
        if (Math.abs(gap) >= CELL_CLEARANCE) continue;
        const push = (CELL_CLEARANCE - Math.abs(gap)) / 2;
        const dir = gap >= 0 ? 1 : -1;
        a.cx -= dir * push;
        b.cx += dir * push;
      }
    }
  }

  /* ---------------------------------------------------------------- links */

  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const seen = new Set<string>();
  const links: CellLink[] = [];

  for (const cell of cells) {
    for (const member of cell.members) {
      if (!isHead(member.person.id)) continue;
      for (const parentId of parentsOf.get(member.person.id) ?? []) {
        const parentCellId = cellOf.get(parentId);
        if (!parentCellId || parentCellId === cell.id) continue;
        const parent = byId.get(parentCellId);
        if (!parent) continue;
        const linkId = `${parentCellId}->${cell.id}`;
        if (seen.has(linkId)) continue;
        seen.add(linkId);
        const bend = Math.max((cell.cy - parent.cy) * 0.5, 60);
        links.push({
          id: linkId,
          d:
            `M ${parent.cx} ${parent.cy} C ${parent.cx} ${parent.cy + bend}, ` +
            `${cell.cx} ${cell.cy - bend}, ${cell.cx} ${cell.cy}`,
        });
      }
    }
  }

  return { cells, links, cellOf };
}
