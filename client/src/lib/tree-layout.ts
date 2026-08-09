import type { Generation, Person, Relationship } from '../../../shared/types.ts';

/**
 * Turns people plus relationships into the geometry the tree screen draws.
 *
 * The prototype hard-coded its SVG connector paths, which meant the tree broke
 * the moment anyone was added. Here the same shapes are derived: a horizontal
 * bar between spouses, a trunk dropping from the couple's midpoint, a sibling
 * bus, and a drop to each child. Fed the seed family, this reproduces the
 * original paths exactly.
 */

export const NODE_SIZE = 84;
const HALF = NODE_SIZE / 2;

/** Breathing room around the outermost nodes, in canvas pixels. */
const PADDING = 160;

/**
 * Where the sibling bus sits between the parent row and the child row, as a
 * fraction of the gap. 0.44 is what the original artwork used.
 */
const BUS_FRACTION = 0.44;

/** Vertical gap between a node's top edge and its branch label. */
const BRANCH_LABEL_GAP = 62;

export interface TreeNode {
  person: Person;
  generation: Generation | undefined;
  /** Top-left on the layout canvas, with the centring offset already applied. */
  left: number;
  top: number;
  cx: number;
  cy: number;
  /** Row ordinal from the top, used to stagger the draw-in animation. */
  row: number;
}

export interface Connector {
  id: string;
  d: string;
  dashed: boolean;
  color: string;
  delaySeconds: number;
  /** Path length, so the draw animation can size its dash offset. */
  length: number;
}

export interface BranchLabel {
  id: string;
  text: string;
  /** Centre point of the label. */
  cx: number;
  top: number;
}

export interface TreeLayout {
  nodes: TreeNode[];
  byId: Map<string, TreeNode>;
  connectors: Connector[];
  branchLabels: BranchLabel[];
  width: number;
  height: number;
}

export const EMPTY_LAYOUT: TreeLayout = {
  nodes: [],
  byId: new Map(),
  connectors: [],
  branchLabels: [],
  width: 1,
  height: 1,
};

/** Corner radius where a wire turns — soft enough to read as hand-drawn. */
const ELBOW_RADIUS = 18;

/**
 * One elbow, rounded at both turns: down from the couple's anchor, across the
 * bus, down into the child. The radius shrinks when the segments are short so
 * a tight turn never overshoots its own corner.
 */
function roundedElbow(
  ax: number,
  ay: number,
  busY: number,
  cx: number,
  cy: number,
): string {
  if (cx === ax) return `M ${ax} ${ay} V ${cy}`;
  const dir = cx > ax ? 1 : -1;
  const r = Math.max(
    Math.min(ELBOW_RADIUS, Math.abs(busY - ay), Math.abs(cy - busY), Math.abs(cx - ax) / 2),
    0,
  );
  if (r < 2) return `M ${ax} ${ay} V ${busY} H ${cx} V ${cy}`;
  return (
    `M ${ax} ${ay} V ${busY - r} Q ${ax} ${busY} ${ax + dir * r} ${busY} ` +
    `H ${cx - dir * r} Q ${cx} ${busY} ${cx} ${busY + r} V ${cy}`
  );
}

/**
 * An outermost child's drop, curving off the end of the sibling bus. Returns
 * where the bus itself should stop so the curve continues it seamlessly.
 */
function roundedDrop(
  cx: number,
  cy: number,
  busY: number,
  inwardDir: 1 | -1,
): { d: string; busEndX: number } {
  const r = Math.max(Math.min(ELBOW_RADIUS, Math.abs(cy - busY) / 2), 0);
  if (r < 2) return { d: `M ${cx} ${busY} V ${cy}`, busEndX: cx };
  return {
    d: `M ${cx + inwardDir * r} ${busY} Q ${cx} ${busY} ${cx} ${busY + r} V ${cy}`,
    busEndX: cx + inwardDir * r,
  };
}

/** Rough length of an axis-aligned path, good enough to size a dash offset. */
function pathLength(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  }
  return Math.max(total, 1);
}

/**
 * The canvas normally re-anchors itself to the leftmost/topmost node. While a
 * node is being dragged that is exactly wrong — pulling the outermost person
 * left would shift the whole board under the finger. The tree screen captures
 * the anchor when edit mode opens and passes it here so only the dragged node
 * moves.
 */
export interface LayoutAnchor {
  minX: number;
  minY: number;
}

export function layoutAnchor(people: Person[]): LayoutAnchor {
  return {
    minX: Math.min(...people.map((p) => p.x)),
    minY: Math.min(...people.map((p) => p.y)),
  };
}

export function buildTreeLayout(
  people: Person[],
  relationships: Relationship[],
  generations: Generation[],
  anchor?: LayoutAnchor,
): TreeLayout {
  if (people.length === 0) return EMPTY_LAYOUT;

  const genById = new Map(generations.map((g) => [g.id, g]));

  // Shift everything so the leftmost/topmost node sits one padding in. Stored
  // coordinates can be negative once people start dragging nodes around.
  const minX = anchor?.minX ?? Math.min(...people.map((p) => p.x));
  const minY = anchor?.minY ?? Math.min(...people.map((p) => p.y));
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;

  const rowTops = [...new Set(people.map((p) => p.y))].sort((a, b) => a - b);

  const nodes: TreeNode[] = people.map((person) => {
    const left = person.x + offsetX;
    const top = person.y + offsetY;
    return {
      person,
      generation: genById.get(person.generationId),
      left,
      top,
      cx: left + HALF,
      cy: top + HALF,
      row: rowTops.indexOf(person.y),
    };
  });

  const byId = new Map(nodes.map((n) => [n.person.id, n]));

  const width = Math.max(...nodes.map((n) => n.left)) + NODE_SIZE + PADDING;
  const height = Math.max(...nodes.map((n) => n.top)) + NODE_SIZE + PADDING;

  const connectors: Connector[] = [];
  const delayFor = (row: number) => 0.1 + row * 0.2;

  /* ---------------------------------------------------------- spouse bars */

  for (const rel of relationships) {
    if (rel.type !== 'spouse') continue;
    const a = byId.get(rel.personId);
    const b = byId.get(rel.relatedPersonId);
    if (!a || !b) continue;

    const dashed = a.person.isProvisional || b.person.isProvisional;
    connectors.push({
      id: `spouse-${rel.id}`,
      d: `M ${a.cx} ${a.cy} L ${b.cx} ${b.cy}`,
      dashed,
      color: dashed ? (a.generation?.color ?? 'var(--connector)') : 'var(--connector)',
      delaySeconds: delayFor(Math.min(a.row, b.row)),
      length: pathLength([
        [a.cx, a.cy],
        [b.cx, b.cy],
      ]),
    });
  }

  /* ------------------------------------------------------ parents → kids */

  // Children with the same set of parents share one trunk and one sibling bus,
  // which is what makes a couple's family read as a unit.
  const parentsByChild = new Map<string, string[]>();
  for (const rel of relationships) {
    if (rel.type !== 'parent') continue;
    if (!byId.has(rel.personId) || !byId.has(rel.relatedPersonId)) continue;
    const list = parentsByChild.get(rel.relatedPersonId) ?? [];
    list.push(rel.personId);
    parentsByChild.set(rel.relatedPersonId, list);
  }

  const groups = new Map<string, { parentIds: string[]; childIds: string[] }>();
  for (const [childId, parentIds] of parentsByChild) {
    const key = [...parentIds].sort().join('|');
    const group = groups.get(key) ?? { parentIds: [...parentIds].sort(), childIds: [] };
    group.childIds.push(childId);
    groups.set(key, group);
  }

  /**
   * Two families whose parents sit on the same row used to get their sibling
   * buses at the same height; where their spans overlapped horizontally the
   * lines merged into one confusing rail. Each bus now checks the ones already
   * placed and steps down until it has clear air.
   */
  const placedBuses: Array<{ y: number; x1: number; x2: number }> = [];
  function clearBusY(preferred: number, x1: number, x2: number): number {
    let y = preferred;
    const collides = (bus: { y: number; x1: number; x2: number }) =>
      Math.abs(bus.y - y) < 12 && x1 - 24 < bus.x2 && x2 + 24 > bus.x1;
    while (placedBuses.some(collides)) y += 16;
    placedBuses.push({ y, x1, x2 });
    return y;
  }

  for (const [key, group] of groups) {
    const parentNodes = group.parentIds
      .map((id) => byId.get(id))
      .filter((n): n is TreeNode => Boolean(n));
    const childNodes = group.childIds
      .map((id) => byId.get(id))
      .filter((n): n is TreeNode => Boolean(n))
      .sort((a, b) => a.cx - b.cx);

    if (parentNodes.length === 0 || childNodes.length === 0) continue;

    const anchorX = Math.round(
      parentNodes.reduce((sum, n) => sum + n.cx, 0) / parentNodes.length,
    );
    const anchorY = Math.max(...parentNodes.map((n) => n.cy));
    const topChildY = Math.min(...childNodes.map((n) => n.cy));
    const delay = delayFor(Math.max(...parentNodes.map((n) => n.row)));

    // A child placed level with or above its parents has no room for the
    // elbow routing, so fall back to a direct line rather than draw nonsense.
    if (topChildY <= anchorY) {
      for (const child of childNodes) {
        connectors.push({
          id: `child-${key}-${child.person.id}`,
          d: `M ${anchorX} ${anchorY} L ${child.cx} ${child.cy}`,
          dashed: child.person.isProvisional,
          color: child.person.isProvisional
            ? (child.generation?.color ?? 'var(--connector)')
            : 'var(--connector)',
          delaySeconds: delay,
          length: pathLength([
            [anchorX, anchorY],
            [child.cx, child.cy],
          ]),
        });
      }
      continue;
    }

    const preferredBusY = Math.round(anchorY + (topChildY - anchorY) * BUS_FRACTION);

    const onlyChild = childNodes.length === 1 ? childNodes[0] : undefined;
    if (onlyChild) {
      // Straight drop when the child sits directly below the couple's midpoint,
      // otherwise a single elbow through the bus line.
      const straight = onlyChild.cx === anchorX;
      const busY = straight
        ? preferredBusY
        : clearBusY(
            preferredBusY,
            Math.min(anchorX, onlyChild.cx),
            Math.max(anchorX, onlyChild.cx),
          );
      const d = roundedElbow(anchorX, anchorY, busY, onlyChild.cx, onlyChild.cy);
      connectors.push({
        id: `child-${key}-${onlyChild.person.id}`,
        d,
        dashed: onlyChild.person.isProvisional,
        color: onlyChild.person.isProvisional
          ? (onlyChild.generation?.color ?? 'var(--connector)')
          : 'var(--connector)',
        delaySeconds: delay,
        length: pathLength([
          [anchorX, anchorY],
          [anchorX, busY],
          [onlyChild.cx, busY],
          [onlyChild.cx, onlyChild.cy],
        ]),
      });
      continue;
    }

    const leftmost = childNodes[0] as TreeNode;
    const rightmost = childNodes[childNodes.length - 1] as TreeNode;
    const busY = clearBusY(
      preferredBusY,
      Math.min(leftmost.cx, anchorX),
      Math.max(rightmost.cx, anchorX),
    );

    // The two outermost drops curve off the ends of the bus; everyone in
    // between tees straight into it. The bus itself stops where each end
    // curve takes over, so the whole family reads as one soft bracket.
    const leftDrop = roundedDrop(leftmost.cx, leftmost.cy, busY, 1);
    const rightDrop = roundedDrop(rightmost.cx, rightmost.cy, busY, -1);
    const busFrom = Math.min(leftDrop.busEndX, anchorX);
    const busTo = Math.max(rightDrop.busEndX, anchorX);

    connectors.push({
      id: `trunk-${key}`,
      d: `M ${anchorX} ${anchorY} V ${busY} M ${busFrom} ${busY} H ${busTo}`,
      dashed: false,
      color: 'var(--connector)',
      delaySeconds: delay,
      length: Math.abs(busY - anchorY) + Math.abs(busTo - busFrom),
    });

    for (const child of childNodes) {
      const isEnd = child === leftmost || child === rightmost;
      const drop = child === leftmost ? leftDrop : child === rightmost ? rightDrop : null;
      connectors.push({
        id: `child-${key}-${child.person.id}`,
        d: isEnd && drop ? drop.d : `M ${child.cx} ${busY} V ${child.cy}`,
        dashed: child.person.isProvisional,
        color: child.person.isProvisional
          ? (child.generation?.color ?? 'var(--connector)')
          : 'var(--connector)',
        delaySeconds: delay + 0.1,
        length: Math.abs(child.cy - busY) + ELBOW_RADIUS,
      });
    }
  }

  /* -------------------------------------------------------- branch labels */

  // Only the founding row is labelled. Repeating a branch name on every row
  // below it clutters the canvas without telling anyone anything new.
  const branchLabels: BranchLabel[] = [];
  const topRow = rowTops[0];
  if (topRow !== undefined) {
    const clusters = new Map<string, TreeNode[]>();
    for (const node of nodes) {
      if (node.person.y !== topRow) continue;
      const branch = node.person.branch?.trim();
      if (!branch) continue;
      clusters.set(branch, [...(clusters.get(branch) ?? []), node]);
    }

    for (const [branch, members] of clusters) {
      const lefts = members.map((m) => m.left);
      // "ברלין → חיפה" reads better as just the origin on a founding label.
      const origin = members[0]?.person.place?.split('→')[0]?.trim();
      branchLabels.push({
        id: `branch-${branch}`,
        text: origin ? `${branch} · ${origin}` : branch,
        cx: (Math.min(...lefts) + Math.max(...lefts) + NODE_SIZE) / 2,
        top: (members[0] as TreeNode).top - BRANCH_LABEL_GAP,
      });
    }
  }

  return { nodes, byId, connectors, branchLabels, width, height };
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/** Scale and centre the whole canvas inside the viewport. */
export function fitView(
  layout: Pick<TreeLayout, 'width' | 'height'>,
  viewport: Viewport,
  { maxScale = 1, minScale = 0.2 }: { maxScale?: number; minScale?: number } = {},
): ViewTransform {
  if (viewport.width === 0 || viewport.height === 0) return { x: 0, y: 0, k: maxScale };
  const k = Math.max(
    minScale,
    Math.min(viewport.width / layout.width, viewport.height / layout.height, maxScale),
  );
  return {
    x: (viewport.width - layout.width * k) / 2,
    y: (viewport.height - layout.height * k) / 2,
    k,
  };
}

/** Put one node in the middle of the viewport at a given zoom. */
export function centreOn(node: TreeNode, viewport: Viewport, k: number): ViewTransform {
  return {
    x: viewport.width / 2 - node.cx * k,
    y: viewport.height / 2 - node.cy * k,
    k,
  };
}
