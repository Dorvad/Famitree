import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import type { TreeResponse } from '../../../shared/types.ts';

import { queryKeys, useMovePerson, useSession, useTree } from '../api/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import {
  PersonDossier,
  originFromElement,
  type LensOrigin,
} from '../components/PersonDossier.tsx';
import { TreeOverture } from '../components/TreeOverture.tsx';
import { Years } from '../components/Years.tsx';
import { generationVars, givenName, restTilt } from '../lib/format.ts';
import {
  NODE_SIZE,
  buildTreeLayout,
  centreOn,
  fitView,
  layoutAnchor,
  type Connector,
  type LayoutAnchor,
  type TreeLayout,
  type TreeNode,
} from '../lib/tree-layout.ts';
import {
  buildFamilyCells,
  type FamilyCell,
  type FamilyCellMap,
} from '../lib/family-cells.ts';
import { tidyPositions } from '../lib/tidy.ts';
import { usePanZoom } from '../lib/usePanZoom.ts';
import { useUi } from '../state/ui.tsx';
import styles from './TreeScreen.module.css';

/** Zoom applied when jumping to a specific person, as in the original. */
const FOCUS_SCALE = 1.2;

/**
 * The semantic-zoom boundary. Below it, single circles are too small to read
 * or tap, so the board switches to family cells; above it, the full tree.
 * Two thresholds, not one: crossing over must not flutter between modes while
 * a pinch hovers at the boundary.
 */
const CLUSTER_ENTER_K = 0.5;
const CLUSTER_EXIT_K = 0.58;

/**
 * The opening title belongs to arriving at the app, not to the route. Module
 * scope rather than state, so coming back to the tree from the archive does not
 * replay it — only a fresh load does.
 */
let overturePlayed = false;

interface Lens {
  personId: string;
  origin: LensOrigin;
}

/* ------------------------------------------------------------------ wires */

/**
 * The connector SVG, split out and memoised: a pan or zoom changes only the
 * canvas transform, and re-rendering every path sixty times a second was the
 * single biggest cost of dragging the view around. The paths only re-render
 * when the layout itself changes — someone moved, joined, or left.
 */
const Wires = memo(function Wires({
  connectors,
  width,
  height,
}: {
  connectors: Connector[];
  width: number;
  height: number;
}): React.JSX.Element {
  return (
    <svg className={styles.wires} width={width} height={height} aria-hidden="true">
      {connectors.map((wire) => (
        <path
          key={wire.id}
          className={wire.dashed ? styles.wire : `${styles.wire} ${styles.wireDrawn}`}
          d={wire.d}
          stroke={wire.color}
          {...(wire.dashed
            ? { strokeDasharray: '2 16' }
            : {
                style: {
                  strokeDasharray: wire.length,
                  '--draw-length': wire.length,
                  '--delay': `${wire.delaySeconds}s`,
                } as React.CSSProperties,
              })}
        />
      ))}
    </svg>
  );
});

/* ---------------------------------------------------------------- station */

interface StationProps {
  node: TreeNode;
  index: number;
  isOpen: boolean;
  /** Open and not yet closing — the circle is inside the lens right now. */
  lifted: boolean;
  isMe: boolean;
  editing: boolean;
  /** May this viewer drag this node in edit mode. */
  movable: boolean;
  /** Current zoom, read at drag time — client pixels ÷ k = canvas units. */
  scaleRef: React.RefObject<number>;
  consumedDrag: () => boolean;
  registerEl: (id: string, el: HTMLButtonElement | null) => void;
  onOpen: (id: string, el: HTMLButtonElement) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDrop: (id: string, x: number, y: number, moved: boolean) => void;
}

/** Client-pixel movement below this is a tap on the node, not a drag of it. */
const NODE_DRAG_THRESHOLD = 4;

const Station = memo(
  function Station({
    node,
    index,
    isOpen,
    lifted,
    isMe,
    editing,
    movable,
    scaleRef,
    consumedDrag,
    registerEl,
    onOpen,
    onMove,
    onDrop,
  }: StationProps): React.JSX.Element {
    const { person, generation } = node;

    const drag = useRef<{
      pointerId: number;
      startX: number;
      startY: number;
      baseX: number;
      baseY: number;
      moved: boolean;
    } | null>(null);
    const [held, setHeld] = useState(false);

    const canvasDelta = (event: React.PointerEvent, state: { startX: number; startY: number }) => {
      const k = Math.max(scaleRef.current ?? 1, 0.01);
      return {
        dx: (event.clientX - state.startX) / k,
        dy: (event.clientY - state.startY) / k,
      };
    };

    const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      drag.current = null;
      setHeld(false);
      const { dx, dy } = canvasDelta(event, state);
      onDrop(person.id, state.baseX + dx, state.baseY + dy, state.moved);
    };

    return (
      <div
        className={[
          styles.station,
          editing && movable && styles.stationMovable,
          held && styles.stationHeld,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          left: node.left,
          top: node.top,
          width: NODE_SIZE,
          zIndex: held ? 60 : isOpen ? 40 : 1,
          // A small permanent tilt on the name plate, so a row of them
          // reads as pinned labels rather than a ruled table.
          '--rest-tilt': restTilt(person.id, 1.4),
          ...generationVars(generation),
        } as React.CSSProperties}
        data-no-pan
      >
        {isOpen && <span className={styles.halo} aria-hidden="true" />}

        <button
          type="button"
          ref={(element) => registerEl(person.id, element)}
          className={[styles.node, isMe && styles.nodeMe, lifted && styles.nodeLifted]
            .filter(Boolean)
            .join(' ')}
          style={
            {
              // Capped so a large family still finishes planting itself
              // in about a second instead of trickling in.
              '--delay': `${Math.min(index * 0.055, 1.1).toFixed(2)}s`,
            } as React.CSSProperties
          }
          aria-expanded={isOpen}
          onPointerDown={(event) => {
            if (!editing || !movable) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.stopPropagation();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Capture can be refused mid-gesture; the drag still tracks.
            }
            drag.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              baseX: person.x,
              baseY: person.y,
              moved: false,
            };
            setHeld(true);
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (!state || state.pointerId !== event.pointerId) return;
            if (
              !state.moved &&
              Math.abs(event.clientX - state.startX) +
                Math.abs(event.clientY - state.startY) <
                NODE_DRAG_THRESHOLD
            ) {
              return;
            }
            state.moved = true;
            const { dx, dy } = canvasDelta(event, state);
            onMove(person.id, state.baseX + dx, state.baseY + dy);
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onClick={(event) => {
            // In edit mode a tap is the start of a possible drag, never a lens.
            if (editing) return;
            if (consumedDrag()) return;
            onOpen(person.id, event.currentTarget);
          }}
        >
          <Avatar person={person} generation={generation} size={NODE_SIZE} filled={isMe} />
          <span className="visually-hidden">
            {person.fullName}, {person.lifeSpan}
          </span>
        </button>

        <span className={styles.pill} aria-hidden="true">
          <span className={styles.pillName}>{givenName(person.fullName)}</span>{' '}
          <Years className={styles.pillYears}>{person.lifeSpan}</Years>
        </span>

        {isMe && (
          <span className={styles.youAreHere} style={{ top: NODE_SIZE + 44 }}>
            אתם כאן! ↑
          </span>
        )}
      </div>
    );
  },
  (a, b) =>
    // The layout is rebuilt object-by-object whenever a node moves, so
    // position and person identity are what decide whether this station
    // changed. Callbacks and refs are stable by construction upstream.
    a.node.left === b.node.left &&
    a.node.top === b.node.top &&
    a.node.person === b.node.person &&
    a.node.generation === b.node.generation &&
    a.index === b.index &&
    a.isOpen === b.isOpen &&
    a.lifted === b.lifted &&
    a.isMe === b.isMe &&
    a.editing === b.editing &&
    a.movable === b.movable,
);

/* --------------------------------------------------------------- contents */

interface CanvasContentsProps {
  layout: TreeLayout;
  lensPersonId: string | null;
  closing: boolean;
  myPersonId: string | null;
  editing: boolean;
  /** Steward moves anyone; otherwise only your own circle is yours to place. */
  moveAll: boolean;
  scaleRef: React.RefObject<number>;
  consumedDrag: () => boolean;
  registerEl: (id: string, el: HTMLButtonElement | null) => void;
  onOpen: (id: string, el: HTMLButtonElement) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDrop: (id: string, x: number, y: number, moved: boolean) => void;
}

/**
 * Everything inside the transformed canvas, memoised as one unit: while the
 * view pans or zooms, the parent re-renders every frame but this subtree —
 * wires, labels and all the stations — is skipped entirely. Only a change to
 * the layout or the lens re-enters it.
 */
const CanvasContents = memo(function CanvasContents({
  layout,
  lensPersonId,
  closing,
  myPersonId,
  editing,
  moveAll,
  scaleRef,
  consumedDrag,
  registerEl,
  onOpen,
  onMove,
  onDrop,
}: CanvasContentsProps): React.JSX.Element {
  return (
    <>
      <Wires connectors={layout.connectors} width={layout.width} height={layout.height} />

      {layout.branchLabels.map((label) => (
        <span
          key={label.id}
          className={styles.branchLabel}
          style={{ left: label.cx, top: label.top }}
        >
          {label.text}
        </span>
      ))}

      {layout.nodes.map((node, index) => {
        const isOpen = lensPersonId === node.person.id;
        return (
          <Station
            key={node.person.id}
            node={node}
            index={index}
            isOpen={isOpen}
            lifted={isOpen && !closing}
            isMe={myPersonId === node.person.id}
            editing={editing}
            movable={moveAll || myPersonId === node.person.id}
            scaleRef={scaleRef}
            consumedDrag={consumedDrag}
            registerEl={registerEl}
            onOpen={onOpen}
            onMove={onMove}
            onDrop={onDrop}
          />
        );
      })}
    </>
  );
});

/* ------------------------------------------------------------------ cells */

interface CellsLayerProps {
  data: FamilyCellMap;
  width: number;
  height: number;
  myPersonId: string | null;
  consumedDrag: () => boolean;
  onOpenCell: (cell: FamilyCell) => void;
}

/**
 * The zoomed-out board: one tappable card per nuclear family, joined by soft
 * curves of descent. Far fewer elements than the full tree, so the view that
 * shows the most family is also the cheapest one to move around.
 */
const CellsLayer = memo(function CellsLayer({
  data,
  width,
  height,
  myPersonId,
  consumedDrag,
  onOpenCell,
}: CellsLayerProps): React.JSX.Element {
  const myCellId = myPersonId ? data.cellOf.get(myPersonId) : undefined;

  return (
    <>
      <svg className={styles.wires} width={width} height={height} aria-hidden="true">
        {data.links.map((link) => (
          <path key={link.id} className={styles.cellLink} d={link.d} />
        ))}
      </svg>

      {data.cells.map((cell, index) => {
        const faces = cell.members.slice(0, 3);
        const rest = cell.members.length - faces.length;
        return (
          <button
            key={cell.id}
            type="button"
            className={styles.cell}
            style={
              {
                left: cell.cx,
                top: cell.cy,
                '--delay': `${Math.min(index * 0.05, 0.45).toFixed(2)}s`,
              } as React.CSSProperties
            }
            data-no-pan
            onClick={() => {
              if (consumedDrag()) return;
              onOpenCell(cell);
            }}
          >
            <span className={styles.cellFaces} aria-hidden="true">
              {faces.map((member) => (
                <Avatar
                  key={member.person.id}
                  person={member.person}
                  generation={member.generation}
                  size={62}
                  className={styles.cellFace}
                />
              ))}
              {rest > 0 && <span className={styles.cellMore}>+{rest}</span>}
            </span>
            <span className={styles.cellLabel}>{cell.label}</span>
            <span className={styles.cellCount}>{cell.members.length} בני משפחה</span>
            {myCellId === cell.id && <span className={styles.cellYou}>אתם כאן</span>}
            <span className="visually-hidden">
              {cell.members.map((m) => givenName(m.person.fullName)).join(', ')} — געו לפתיחה
            </span>
          </button>
        );
      })}
    </>
  );
});

/* ----------------------------------------------------------------- screen */

export function TreeScreen(): React.JSX.Element {
  const { data: tree, isPending, error, refetch } = useTree();
  const { data: session } = useSession();
  const { openSearch } = useUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const movePerson = useMovePerson();

  // Arriving on a person's link means you came for them, not for a title card.
  const [overture, setOverture] = useState(
    () => !overturePlayed && !searchParams.get('focus'),
  );
  useEffect(() => {
    overturePlayed = true;
  }, []);

  const [lens, setLens] = useState<Lens | null>(null);
  const [closing, setClosing] = useState(false);
  /** A person to open once the camera move that frames them has been painted. */
  const [pendingLens, setPendingLens] = useState<string | null>(null);

  /**
   * Edit mode: the corner toggle that turns the board into a workbench.
   * Dragging a circle moves the person; taps stop opening the lens so a
   * clumsy drag never flings a dossier open. `?edit=1` (the editor links
   * here) starts the screen already in it.
   */
  const [editing, setEditing] = useState(() => searchParams.get('edit') === '1');
  /** Live position of the node currently under a finger, in canvas units. */
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Board anchor captured on entering edit mode — see layoutAnchor. */
  const frozenAnchor = useRef<LayoutAnchor | null>(null);
  const [confirmTidy, setConfirmTidy] = useState(false);
  const [tidying, setTidying] = useState(false);

  /**
   * True while a double-tap zoom or a recentre is gliding the camera. It puts
   * the same transition on the canvas that walking between relatives uses, so
   * the jump reads as a camera move rather than a cut — and it is switched off
   * the moment a finger comes back down, so dragging never fights a transition.
   */
  const [gliding, setGliding] = useState(false);
  const glideTimer = useRef(0);
  const glide = useCallback(() => {
    window.clearTimeout(glideTimer.current);
    setGliding(true);
    glideTimer.current = window.setTimeout(() => setGliding(false), 900);
  }, []);
  useEffect(() => () => window.clearTimeout(glideTimer.current), []);

  // Node elements, so a lens can be measured from the circle it grows out of
  // even when the opening was not a click — a deep link, or a relative.
  const nodeEls = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);

  const registerEl = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) nodeEls.current.set(id, element);
    else nodeEls.current.delete(id);
  }, []);

  // The person being dragged deviates from the cache only until the drop
  // writes them back; everyone else always renders straight from the cache.
  const effectivePeople = useMemo(() => {
    if (!tree) return [];
    if (!dragPos) return tree.people;
    return tree.people.map((p) =>
      p.id === dragPos.id ? { ...p, x: dragPos.x, y: dragPos.y } : p,
    );
  }, [tree, dragPos]);

  const layout = useMemo(
    () =>
      buildTreeLayout(
        effectivePeople,
        tree?.relationships ?? [],
        tree?.generations ?? [],
        editing ? (frozenAnchor.current ?? undefined) : undefined,
      ),
    [effectivePeople, tree, editing],
  );

  const panZoom = usePanZoom({
    minScale: 0.25,
    maxScale: 2.4,
    content: { width: layout.width, height: layout.height },
  });
  const { setTransform, transform, viewport, consumedDrag } = panZoom;

  const cellsData = useMemo(
    () => buildFamilyCells(layout, tree?.relationships ?? []),
    [layout, tree],
  );

  // Semantic zoom, with hysteresis so the boundary never flutters mid-pinch.
  // Edit mode always shows the full board — a family card cannot be dragged.
  const wasClustered = useRef(false);
  const clustered =
    !editing &&
    cellsData.cells.length >= 2 &&
    transform.k < (wasClustered.current ? CLUSTER_EXIT_K : CLUSTER_ENTER_K);
  wasClustered.current = clustered;

  /** Latest zoom factor, for drag math that must not re-render per frame. */
  const scaleRef = useRef(1);
  useEffect(() => {
    scaleRef.current = transform.k;
  }, [transform.k]);

  // Entering edit mode by URL happens before the tree exists; take the anchor
  // as soon as there is something to anchor to.
  useEffect(() => {
    if (editing && tree && !frozenAnchor.current) {
      frozenAnchor.current = layoutAnchor(tree.people);
    }
  }, [editing, tree]);

  const myPersonId = session?.user?.personId ?? null;
  const canEnterEdit = Boolean(session?.user);
  const moveAll = session?.user?.role === 'steward';
  const focusParam = searchParams.get('focus');

  // Fit the whole tree on first paint, then leave the view alone so a pan or
  // zoom is never yanked back by a re-render. While the overture holds the
  // screen the camera waits a step further out, so pressing התחלה has
  // somewhere to arrive from.
  const hasFitted = useRef(false);
  useEffect(() => {
    if (hasFitted.current) return;
    if (viewport.width === 0 || layout.nodes.length === 0) return;
    hasFitted.current = true;
    const fit = fitView(layout, viewport, { maxScale: 1 });
    if (!overture) {
      setTransform(fit);
      return;
    }
    const k = fit.k * 0.86;
    setTransform({
      k,
      x: (viewport.width - layout.width * k) / 2,
      y: (viewport.height - layout.height * k) / 2,
    });
    // The effect must not re-run when the overture ends — beginEntry owns
    // that camera move — so `overture` stays out of the dependencies and the
    // hasFitted guard keeps this to a single run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, setTransform, viewport]);

  /**
   * Remounting the canvas replays the planting: nodes drop in, wires ink
   * themselves. Bumped once, when the overture's button is pressed, so the
   * entrance is an arrival rather than a curtain lifting on a finished scene.
   */
  const [entryEpoch, setEntryEpoch] = useState(0);
  const beginEntry = useCallback(() => {
    setEntryEpoch(1);
    glide();
    setTransform(fitView(layout, viewport, { maxScale: 1 }));
  }, [glide, layout, setTransform, viewport]);

  // A ?focus=<id> link (from search, a person's page, or joining) frames that
  // person — and opens their lens, unless the board is in edit mode, where the
  // point of arriving is to drag them.
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam || viewport.width === 0) return;
    if (handledFocus.current === focusParam) return;

    const node = layout.byId.get(focusParam);
    if (!node) return;

    handledFocus.current = focusParam;
    hasFitted.current = true;
    setTransform(centreOn(node, viewport, FOCUS_SCALE));
    if (!editing) setPendingLens(focusParam);
  }, [editing, focusParam, layout, setTransform, viewport]);

  /*
   * Turning a pending person into an open lens has to wait for the camera move
   * to be committed: the circle grows from where the node *is*, and until the
   * new transform has been painted the node is still somewhere else. A layout
   * effect runs after the commit and before the browser paints, so the
   * measurement is right and nothing is ever seen in the wrong place.
   */
  useLayoutEffect(() => {
    if (!pendingLens) return;
    const element = nodeEls.current.get(pendingLens);
    if (!element) return;
    lastOpened.current = pendingLens;
    setClosing(false);
    setLens({ personId: pendingLens, origin: originFromElement(element) });
    setPendingLens(null);
  }, [pendingLens, transform]);

  const openLens = useCallback((personId: string, origin: LensOrigin) => {
    lastOpened.current = personId;
    setClosing(false);
    setLens({ personId, origin });
  }, []);

  const handleOpen = useCallback(
    (personId: string, element: HTMLButtonElement) => {
      openLens(personId, originFromElement(element));
    },
    [openLens],
  );

  /* ------------------------------------------------------------ dragging */

  // One position update per painted frame, however fast the pointer reports.
  const moveRaf = useRef(0);
  const handleNodeMove = useCallback((id: string, x: number, y: number) => {
    cancelAnimationFrame(moveRaf.current);
    moveRaf.current = requestAnimationFrame(() => setDragPos({ id, x, y }));
  }, []);
  useEffect(() => () => cancelAnimationFrame(moveRaf.current), []);

  const { mutate: persistMove } = movePerson;
  const handleNodeDrop = useCallback(
    (id: string, x: number, y: number, moved: boolean) => {
      cancelAnimationFrame(moveRaf.current);
      if (!moved || !tree) {
        setDragPos(null);
        return;
      }

      // Snap: onto an existing row when the drop lands near one — that is
      // what keeps connectors as clean elbows instead of near-misses — and
      // onto a coarse grid otherwise.
      const rows = [...new Set(tree.people.filter((p) => p.id !== id).map((p) => p.y))];
      const nearRow = rows.find((rowY) => Math.abs(rowY - y) < 60);
      const snapped = { x: Math.round(x / 10) * 10, y: nearRow ?? Math.round(y / 10) * 10 };

      // Written straight into the cache so the release and the settled node
      // are one frame; the PATCH follows behind (see useMovePerson).
      qc.setQueryData<TreeResponse>(queryKeys.tree, (previous) =>
        previous
          ? {
              ...previous,
              people: previous.people.map((p) =>
                p.id === id ? { ...p, x: snapped.x, y: snapped.y } : p,
              ),
            }
          : previous,
      );
      setDragPos(null);
      persistMove({ id, ...snapped });
    },
    [persistMove, qc, tree],
  );

  /**
   * A tap on a family card unfolds it: the camera glides in until the whole
   * household fills the view — always past the cluster boundary, so the tap
   * reliably lands in the detailed tree.
   */
  const openCell = useCallback(
    (cell: FamilyCell) => {
      const pad = 130;
      const width = cell.bounds.maxX - cell.bounds.minX + pad * 2;
      const height = cell.bounds.maxY - cell.bounds.minY + pad * 2;
      const k = Math.min(
        Math.max(Math.min(viewport.width / width, viewport.height / height), CLUSTER_EXIT_K + 0.07),
        1.25,
      );
      const cx = (cell.bounds.minX + cell.bounds.maxX) / 2;
      const cy = (cell.bounds.minY + cell.bounds.maxY) / 2;
      glide();
      setTransform({ k, x: viewport.width / 2 - cx * k, y: viewport.height / 2 - cy * k });
    },
    [glide, setTransform, viewport],
  );

  /* ----------------------------------------------------------- edit mode */

  const enterEdit = useCallback(() => {
    if (tree) frozenAnchor.current = layoutAnchor(tree.people);
    setLens(null);
    setClosing(false);
    setPendingLens(null);
    // Editing needs the full board; from the cells view, step the camera in
    // first so the circles arrive at a size a finger can actually hold.
    if (transform.k < CLUSTER_EXIT_K) {
      const k = 0.75;
      const cx = (viewport.width / 2 - transform.x) / transform.k;
      const cy = (viewport.height / 2 - transform.y) / transform.k;
      glide();
      setTransform({ k, x: viewport.width / 2 - cx * k, y: viewport.height / 2 - cy * k });
    }
    setEditing(true);
  }, [glide, setTransform, transform, tree, viewport]);

  const exitEdit = useCallback(() => {
    // The board re-anchors to its natural origin on exit; shifting the view by
    // the same amount keeps every node exactly where the eye left it.
    if (tree && frozenAnchor.current) {
      const natural = layoutAnchor(tree.people);
      const dx = (frozenAnchor.current.minX - natural.minX) * transform.k;
      const dy = (frozenAnchor.current.minY - natural.minY) * transform.k;
      if (dx !== 0 || dy !== 0) {
        setTransform({ ...transform, x: transform.x - dx, y: transform.y - dy });
      }
    }
    frozenAnchor.current = null;
    setDragPos(null);
    setConfirmTidy(false);
    setEditing(false);
    if (searchParams.has('edit')) {
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, setTransform, transform, tree]);

  const { mutateAsync: persistMoveAsync } = movePerson;
  async function runTidy(): Promise<void> {
    if (!tree || tidying) return;
    setConfirmTidy(false);

    const moves = tidyPositions(tree.people, tree.relationships);
    if (moves.length === 0) return;
    const byIdMove = new Map(moves.map((m) => [m.id, m]));
    const arranged = tree.people.map((p) => {
      const move = byIdMove.get(p.id);
      return move ? { ...p, x: move.x, y: move.y } : p;
    });

    // The whole arrangement lands in one paint, the view glides to frame it,
    // and only then is it written home one person at a time.
    setTidying(true);
    frozenAnchor.current = layoutAnchor(arranged);
    qc.setQueryData<TreeResponse>(queryKeys.tree, (previous) =>
      previous ? { ...previous, people: arranged } : previous,
    );
    glide();
    setTransform(
      fitView(
        buildTreeLayout(arranged, tree.relationships, tree.generations),
        viewport,
        { maxScale: 1 },
      ),
    );

    try {
      for (const move of moves) {
        await persistMoveAsync(move);
      }
    } catch {
      // useMovePerson already refetches the truth on failure.
    } finally {
      setTidying(false);
    }
  }

  /** Walking to a relative re-forms the lens from that satellite's own circle. */
  const walkTo = useCallback(
    (personId: string, origin: LensOrigin) => {
      openLens(personId, origin);

      const node = layout.byId.get(personId);
      if (node) setTransform(centreOn(node, viewport, FOCUS_SCALE));

      // Keep the URL pointing at whoever is actually open, without letting the
      // focus effect treat it as a fresh arrival and re-open the lens.
      handledFocus.current = personId;
      const next = new URLSearchParams(searchParams);
      next.set('focus', personId);
      setSearchParams(next, { replace: true });
    },
    [layout, openLens, searchParams, setSearchParams, setTransform, viewport],
  );

  const beginClose = useCallback(() => setClosing(true), []);

  const finishClose = useCallback(() => {
    setLens(null);
    setClosing(false);
    setPendingLens(null);

    // Send the caret back to the node the lens came out of, so keyboard
    // navigation carries on from where it left off.
    const id = lastOpened.current;
    if (id) nodeEls.current.get(id)?.focus();

    if (searchParams.has('focus')) {
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const recentre = useCallback(() => {
    const mine = myPersonId ? layout.byId.get(myPersonId) : undefined;
    glide();
    setTransform(mine ? centreOn(mine, viewport, FOCUS_SCALE) : fitView(layout, viewport));
  }, [glide, layout, myPersonId, setTransform, viewport]);

  /** Double-tap (or double-click) zooms into that spot; deep in, it zooms back out. */
  const handleDoubleTap = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('[data-no-pan]')) return;
      if (consumedDrag()) return;
      glide();
      panZoom.zoomAtClient(transform.k > 1.6 ? 0.5 : 1.7, event.clientX, event.clientY);
    },
    [consumedDrag, glide, panZoom, transform.k],
  );

  if (isPending) return <LoadingScreen label="פורשים את האילן…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!tree || tree.people.length === 0) {
    return (
      <EmptyState
        title="האילן עדיין ריק"
        message="ברגע שיתווספו בני משפחה, הם יופיעו כאן עם הקשרים ביניהם."
        actionLabel="פתחו את התפריט"
        onAction={openSearch}
      />
    );
  }

  const screenClass = [
    styles.screen,
    lens && (closing ? styles.screenReturn : styles.screenRecede),
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div
        className={screenClass}
        ref={panZoom.containerRef}
        {...panZoom.handlers}
        onPointerDown={(event) => {
          // A finger down takes the camera back immediately — a drag must never
          // fight the glide transition.
          setGliding(false);
          panZoom.handlers.onPointerDown(event);
        }}
        onDoubleClick={handleDoubleTap}
      >
        <h1 className={styles.title}>אילן היוחסין</h1>

        <div className={styles.controls} data-no-pan>
          <button
            type="button"
            className={styles.zoomButton}
            onClick={() => panZoom.zoomBy(1.25)}
            aria-label="התקרבות"
          >
            +
          </button>
          <button
            type="button"
            className={styles.zoomButton}
            onClick={() => panZoom.zoomBy(0.8)}
            aria-label="התרחקות"
          >
            −
          </button>
          <button
            type="button"
            className={styles.homeButton}
            onClick={recentre}
            aria-label={myPersonId ? 'קחו אותי אל העיגול שלי' : 'מרכזו את האילן'}
            title={myPersonId ? 'קחו אותי אליי' : 'מרכזו הכל'}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="6.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
              />
              <circle cx="12" cy="12" r="1.9" fill="currentColor" />
              <path
                d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {canEnterEdit && (
            <button
              type="button"
              className={
                editing ? `${styles.editButton} ${styles.editButtonOn}` : styles.editButton
              }
              onClick={editing ? exitEdit : enterEdit}
              aria-pressed={editing}
              aria-label={editing ? 'סיום מצב עריכה' : 'מצב עריכה — גרירת אנשים על האילן'}
              title={editing ? 'סיום עריכה' : 'מצב עריכה'}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path
                  d="M4 20l1.2-4.2L15.8 5.2a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinejoin="round"
                />
                <path d="M13.9 7.1l3 3" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </button>
          )}
        </div>

        {editing && (
          <div className={styles.editBar} data-no-pan>
            {confirmTidy ? (
              <>
                <span className={styles.editBarNote}>
                  לסדר את כל האילן מחדש לפי הקשרים?
                </span>
                <button
                  type="button"
                  className={styles.editBarButton}
                  onClick={() => setConfirmTidy(false)}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  className={`${styles.editBarButton} ${styles.editBarPrimary}`}
                  onClick={() => void runTidy()}
                >
                  כן, סדרו
                </button>
              </>
            ) : (
              <>
                <span className={styles.editBarNote}>
                  {tidying ? 'מסדרים ושומרים…' : 'גררו עיגול כדי למקם אותו'}
                </span>
                <button
                  type="button"
                  className={styles.editBarButton}
                  disabled={tidying}
                  onClick={() => setConfirmTidy(true)}
                >
                  סידור אוטומטי
                </button>
                <button
                  type="button"
                  className={`${styles.editBarButton} ${styles.editBarPrimary}`}
                  onClick={exitEdit}
                >
                  סיום
                </button>
              </>
            )}
          </div>
        )}

        <div
          key={entryEpoch}
          className={
            lens || gliding ? `${styles.canvas} ${styles.canvasGlide}` : styles.canvas
          }
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            cursor: panZoom.isDragging ? 'grabbing' : 'grab',
          }}
        >
          {clustered ? (
            <CellsLayer
              data={cellsData}
              width={layout.width}
              height={layout.height}
              myPersonId={myPersonId}
              consumedDrag={consumedDrag}
              onOpenCell={openCell}
            />
          ) : (
            <CanvasContents
              layout={layout}
              lensPersonId={lens?.personId ?? null}
              closing={closing}
              myPersonId={myPersonId}
              editing={editing}
              moveAll={moveAll}
              scaleRef={scaleRef}
              consumedDrag={consumedDrag}
              registerEl={registerEl}
              onOpen={handleOpen}
              onMove={handleNodeMove}
              onDrop={handleNodeDrop}
            />
          )}
        </div>

        <p
          key={editing ? 'editing' : clustered ? 'cells' : 'viewing'}
          className={styles.hint}
        >
          {editing
            ? 'גררו עיגול כדי להזיז · ״סידור אוטומטי״ מסדר לפי הקשרים'
            : clustered
              ? 'געו במשפחה כדי לפרוש אותה · צבטו כדי להתקרב'
              : 'גררו לשוטט · הקשה כפולה לזום · געו באדם לפתיחה'}
        </p>

        {overture && (
          <TreeOverture onBegin={beginEntry} onDone={() => setOverture(false)} />
        )}
      </div>

      {lens && !editing && (
        <PersonDossier
          key={lens.personId}
          personId={lens.personId}
          origin={lens.origin}
          closing={closing}
          onWalkTo={walkTo}
          onClose={beginClose}
          onClosed={finishClose}
        />
      )}
    </>
  );
}
