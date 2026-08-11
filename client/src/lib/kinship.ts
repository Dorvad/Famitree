import type { Person, Relationship } from '../../../shared/types.ts';

/**
 * Working out how two people in the tree are related.
 *
 * The records carry no gender, so every term is written in the dual form the
 * rest of the app uses — "אח/אחות", "דוד/דודה". That is a limitation of the
 * data, not a style choice, and saying "אח/אחות" is honest where guessing from
 * a name would not be.
 *
 * Everything here is pure: it takes the tree it is given and returns a
 * description. No fetching, no state.
 */

export interface KinshipStep {
  /** The person arrived at by taking this step. */
  personId: string;
  /** How we got here from the previous person, in Hebrew. */
  via: 'הורה' | 'ילד/ה' | 'בן/בת זוג';
}

export interface Kinship {
  /** The sentence to show, e.g. "אח/אחות של". */
  label: string;
  /**
   * A longer note when the short label leaves something unsaid — a half
   * sibling, or a cousin several generations apart.
   */
  detail?: string;
  /** The chain of people from A to B, so the answer can be checked. */
  path: KinshipStep[];
  /** Generations between them: negative means A is older in the line. */
  generationGap: number;
}

interface Graph {
  /** person → their parents */
  parents: Map<string, string[]>;
  /** person → their children */
  children: Map<string, string[]>;
  /** person → their spouses */
  spouses: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildGraph(relationships: Relationship[]): Graph {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();

  for (const rel of relationships) {
    if (rel.type === 'parent') {
      // personId is the parent of relatedPersonId.
      push(parents, rel.relatedPersonId, rel.personId);
      push(children, rel.personId, rel.relatedPersonId);
    } else {
      // Stored once, but symmetric in fact.
      push(spouses, rel.personId, rel.relatedPersonId);
      push(spouses, rel.relatedPersonId, rel.personId);
    }
  }

  return { parents, children, spouses };
}

/**
 * Every ancestor of `start`, with how many generations up they are and the
 * line walked to reach them.
 *
 * Breadth-first, so the first time an ancestor is seen is by the shortest line
 * — which matters in a tree where two branches marry back together and the same
 * person is an ancestor twice over.
 */
function ancestorsOf(
  graph: Graph,
  start: string,
): Map<string, { depth: number; line: string[] }> {
  const found = new Map<string, { depth: number; line: string[] }>();
  found.set(start, { depth: 0, line: [] });

  const queue: Array<{ id: string; depth: number; line: string[] }> = [
    { id: start, depth: 0, line: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; depth: number; line: string[] };
    for (const parent of graph.parents.get(current.id) ?? []) {
      if (found.has(parent)) continue;
      const line = [...current.line, parent];
      found.set(parent, { depth: current.depth + 1, line });
      queue.push({ id: parent, depth: current.depth + 1, line });
    }
  }
  return found;
}

/** "רבא", "רבא-רבא", … for each generation past the first. */
function greats(times: number): string {
  if (times <= 0) return '';
  return ` ${Array.from({ length: times }, () => 'רבא').join('-')}`;
}

/** Hebrew for a small count of generations. */
function generationWord(count: number): string {
  if (count === 1) return 'דור אחד';
  if (count === 2) return 'שני דורות';
  return `${count} דורות`;
}

/**
 * The blood relation between two people, or null when the tree holds no line
 * between them.
 *
 * `up` is how many generations from A to the nearest shared ancestor and `down`
 * how many from that ancestor to B. Every kinship term falls out of that pair.
 */
function bloodKinship(graph: Graph, aId: string, bId: string): Kinship | null {
  const aUp = ancestorsOf(graph, aId);
  const bUp = ancestorsOf(graph, bId);

  let best: { id: string; up: number; down: number } | null = null;
  for (const [id, a] of aUp) {
    const b = bUp.get(id);
    if (!b) continue;
    // Closest shared ancestor: fewest generations walked in total, and where
    // that ties, the one nearest to A.
    if (
      !best ||
      a.depth + b.depth < best.up + best.down ||
      (a.depth + b.depth === best.up + best.down && a.depth < best.up)
    ) {
      best = { id, up: a.depth, down: b.depth };
    }
  }
  if (!best) return null;

  const { up, down } = best;
  const path = linePath(aUp.get(best.id)?.line ?? [], bUp.get(best.id)?.line ?? [], bId);
  const generationGap = down - up;

  // A is an ancestor of B.
  if (up === 0) {
    if (down === 1) return { label: 'ההורה של', path, generationGap };
    if (down === 2) return { label: 'סבא/סבתא של', path, generationGap };
    // Past a couple of "רבא"s the term stops being readable and the plain word
    // for a forebear, with the count spelled out, says it better.
    if (down > 4) {
      return {
        label: 'אב/אם קדמון/קדמונית של',
        detail: `${generationWord(down)} מעליו/ה באילן`,
        path,
        generationGap,
      };
    }
    return {
      label: `סבא/סבתא${greats(down - 2)} של`,
      detail: `${generationWord(down)} מעליו/ה באילן`,
      path,
      generationGap,
    };
  }

  // A is a descendant of B.
  if (down === 0) {
    if (up === 1) return { label: 'הילד/ה של', path, generationGap };
    if (up === 2) return { label: 'הנכד/ה של', path, generationGap };
    if (up === 3) return { label: 'הנין/ה של', path, generationGap };
    return {
      label: 'צאצא/ית של',
      detail: `${generationWord(up)} מתחתיו/ה באילן`,
      path,
      generationGap,
    };
  }

  // Siblings, and how much of a parentage they share.
  if (up === 1 && down === 1) {
    const aParents = new Set(graph.parents.get(aId) ?? []);
    const shared = (graph.parents.get(bId) ?? []).filter((p) => aParents.has(p));
    const half = shared.length === 1 && aParents.size > 1;
    return {
      label: half ? 'אח/אחות למחצה של' : 'אח/אחות של',
      ...(half && { detail: 'הורה אחד משותף' }),
      path,
      generationGap,
    };
  }

  // A is the sibling of one of B's ancestors: aunt or uncle, at a remove.
  if (up === 1) {
    return {
      label: `דוד/דודה${greats(down - 2)} של`,
      ...(down > 3 && { detail: `${generationWord(down - 1)} מעליו/ה באילן` }),
      path,
      generationGap,
    };
  }

  // A descends from B's sibling: niece or nephew, at a remove.
  if (down === 1) {
    return {
      label: `אחיין/ית${greats(up - 2)} של`,
      ...(up > 3 && { detail: `${generationWord(up - 1)} מתחתיו/ה באילן` }),
      path,
      generationGap,
    };
  }

  // Cousins. The degree is how far the nearer of them stands from the shared
  // ancestor; a difference between the two sides is a generation's remove.
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  const degreeLabel =
    degree === 1 ? 'בן/בת דוד' : degree === 2 ? 'בן/בת דוד שני' : `בן/בת דוד בדרגה ${degree}`;
  return {
    label: `${degreeLabel} של`,
    ...(removed > 0 && { detail: `בהפרש של ${generationWord(removed)}` }),
    path,
    generationGap,
  };
}

/**
 * The walk from A up to the shared ancestor and back down to B, as steps.
 *
 * `aUp[lca].line` is the chain of parents from A to the shared ancestor, ending
 * at it. `bUp[lca].line` is the same chain seen from B, so reversing it and
 * dropping the ancestor itself gives the way down — with B added at the end,
 * since a person's own line never contains them.
 */
function linePath(
  aLine: string[],
  bLine: string[],
  bId: string,
): KinshipStep[] {
  const down = [...bLine].reverse().slice(1);
  return [
    ...aLine.map((personId): KinshipStep => ({ personId, via: 'הורה' })),
    ...down.map((personId): KinshipStep => ({ personId, via: 'ילד/ה' })),
    // B is only a step of its own when the walk actually descends to it; when B
    // *is* the shared ancestor, the upward line already ended there.
    ...(bLine.length > 0 ? [{ personId: bId, via: 'ילד/ה' as const }] : []),
  ];
}

/**
 * The in-law relations Hebrew has a single word for.
 *
 * These are all reachable by the general composition below, but it would
 * describe a mother-in-law as "the parent of the partner of" — true, and not
 * what anybody calls it. Naming the four everyday ones is the difference
 * between a tool that answers and a tool that explains.
 */
function namedInLaw(
  graph: Graph,
  aId: string,
  bId: string,
  nameOf: (id: string) => string,
): Kinship | null {
  const aSpouses = graph.spouses.get(aId) ?? [];
  const bSpouses = graph.spouses.get(bId) ?? [];
  const aParents = graph.parents.get(aId) ?? [];
  const aChildren = graph.children.get(aId) ?? [];
  const bChildren = graph.children.get(bId) ?? [];

  const siblingsOf = (id: string): string[] => {
    const out = new Set<string>();
    for (const parent of graph.parents.get(id) ?? []) {
      for (const child of graph.children.get(parent) ?? []) {
        if (child !== id) out.add(child);
      }
    }
    return [...out];
  };

  // A is the parent of B's partner — a parent-in-law.
  for (const spouse of bSpouses) {
    if ((graph.parents.get(spouse) ?? []).includes(aId)) {
      return {
        label: 'חם/חמות של',
        detail: `דרך ${nameOf(spouse)}`,
        path: [{ personId: spouse, via: 'בן/בת זוג' }],
        generationGap: -1,
      };
    }
  }

  // A is the partner of B's child — a child-in-law.
  for (const child of bChildren) {
    if (aSpouses.includes(child)) {
      return {
        label: 'הכלה/החתן של',
        detail: `דרך ${nameOf(child)}`,
        path: [{ personId: child, via: 'בן/בת זוג' }],
        generationGap: 1,
      };
    }
  }

  // A and B are siblings-in-law, from either side of the marriage.
  const aSiblings = siblingsOf(aId);
  for (const spouse of bSpouses) {
    if (aSiblings.includes(spouse)) {
      return {
        label: 'גיס/גיסה של',
        detail: `דרך ${nameOf(spouse)}`,
        path: [{ personId: spouse, via: 'בן/בת זוג' }],
        generationGap: 0,
      };
    }
  }
  for (const spouse of aSpouses) {
    if (siblingsOf(spouse).includes(bId)) {
      return {
        label: 'גיס/גיסה של',
        detail: `דרך ${nameOf(spouse)}`,
        path: [{ personId: spouse, via: 'בן/בת זוג' }],
        generationGap: 0,
      };
    }
  }

  // Their children married each other — the relation Hebrew calls מחותנים.
  for (const child of aChildren) {
    for (const spouse of graph.spouses.get(child) ?? []) {
      if ((graph.parents.get(spouse) ?? []).includes(bId)) {
        return {
          label: 'מחותן/מחותנת של',
          detail: `הילדים שלהם נשואים — ${nameOf(child)} ו${nameOf(spouse)}`,
          path: [
            { personId: child, via: 'ילד/ה' },
            { personId: spouse, via: 'בן/בת זוג' },
          ],
          generationGap: 0,
        };
      }
    }
  }

  // A married one of B's parents without being B's own parent — a step-parent.
  for (const parent of graph.parents.get(bId) ?? []) {
    if (aSpouses.includes(parent) && !(graph.parents.get(bId) ?? []).includes(aId)) {
      return {
        label: 'בן/בת הזוג של ההורה של',
        detail: `דרך ${nameOf(parent)}`,
        path: [{ personId: parent, via: 'בן/בת זוג' }],
        generationGap: -1,
      };
    }
  }
  // The same the other way round: B married A's parent.
  for (const parent of aParents) {
    if (bSpouses.includes(parent) && !aParents.includes(bId)) {
      return {
        label: 'הילד/ה של בן/בת הזוג של',
        detail: `דרך ${nameOf(parent)}`,
        path: [{ personId: parent, via: 'הורה' }],
        generationGap: 1,
      };
    }
  }

  return null;
}

/**
 * Last resort: the shortest walk of any kind between the two, reported as a
 * walk.
 *
 * Two people can be connected through a chain of marriages that no single word
 * covers — a grandparent's brother's wife's nephew. Rather than answer "no
 * relation", which is false, or invent a term, this says how they connect and
 * lets the reader follow it.
 */
function bridgePath(graph: Graph, aId: string, bId: string): KinshipStep[] | null {
  const seen = new Set<string>([aId]);
  const queue: Array<{ id: string; steps: KinshipStep[] }> = [{ id: aId, steps: [] }];

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; steps: KinshipStep[] };
    if (current.steps.length > 8) continue; // a walk this long explains nothing

    const moves: Array<[string[], KinshipStep['via']]> = [
      [graph.parents.get(current.id) ?? [], 'הורה'],
      [graph.children.get(current.id) ?? [], 'ילד/ה'],
      [graph.spouses.get(current.id) ?? [], 'בן/בת זוג'],
    ];

    for (const [neighbours, via] of moves) {
      for (const next of neighbours) {
        if (seen.has(next)) continue;
        const steps = [...current.steps, { personId: next, via }];
        if (next === bId) return steps;
        seen.add(next);
        queue.push({ id: next, steps });
      }
    }
  }
  return null;
}

/**
 * How A is related to B, in one sentence.
 *
 * Blood first. Failing that, one step through a marriage on either side, which
 * is how a brother-in-law or a daughter-in-law is described — as the partner of
 * a relation, or the relation of a partner. Saying it that way keeps it true
 * without inventing terms the data cannot support.
 */
export function describeKinship(
  people: Person[],
  relationships: Relationship[],
  aId: string,
  bId: string,
): Kinship | null {
  if (!aId || !bId) return null;
  const graph = buildGraph(relationships);

  if (aId === bId) return { label: 'אותו אדם', path: [], generationGap: 0 };

  if ((graph.spouses.get(aId) ?? []).includes(bId)) {
    return { label: 'בן/בת הזוג של', path: [], generationGap: 0 };
  }

  const blood = bloodKinship(graph, aId, bId);
  if (blood) return blood;

  const nameOf = (id: string) => people.find((p) => p.id === id)?.fullName ?? 'מי שלא מצאנו';

  const named = namedInLaw(graph, aId, bId, nameOf);
  if (named) return named;

  // A married into B's family: A is the partner of someone related to B.
  for (const spouse of graph.spouses.get(aId) ?? []) {
    const via = bloodKinship(graph, spouse, bId);
    if (via) {
      return {
        label: `בן/בת הזוג של ${via.label.replace(/ של$/, '')} של`,
        detail: `דרך ${nameOf(spouse)}`,
        path: [{ personId: spouse, via: 'בן/בת זוג' }, ...via.path],
        generationGap: via.generationGap,
      };
    }
  }

  // B married into A's family: A is related to B's partner.
  for (const spouse of graph.spouses.get(bId) ?? []) {
    const via = bloodKinship(graph, aId, spouse);
    if (via) {
      return {
        label: `${via.label.replace(/ של$/, '')} של בן/בת הזוג של`,
        detail: `דרך ${nameOf(spouse)}`,
        path: [...via.path, { personId: spouse, via: 'בן/בת זוג' }],
        generationGap: via.generationGap,
      };
    }
  }

  // Connected, but by a chain no single word covers. Say so, and show the chain.
  const bridge = bridgePath(graph, aId, bId);
  if (bridge) {
    return {
      label: 'קרוב/ת משפחה של',
      detail: 'הקשר עובר דרך נישואין — הנה הדרך',
      path: bridge,
      generationGap: 0,
    };
  }

  return null;
}
