import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useSession, useTree } from '../api/hooks.ts';
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
import { NODE_SIZE, buildTreeLayout, centreOn, fitView } from '../lib/tree-layout.ts';
import { usePanZoom } from '../lib/usePanZoom.ts';
import { useUi } from '../state/ui.tsx';
import styles from './TreeScreen.module.css';

/** Zoom applied when jumping to a specific person, as in the original. */
const FOCUS_SCALE = 1.2;

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

export function TreeScreen(): React.JSX.Element {
  const { data: tree, isPending, error, refetch } = useTree();
  const { data: session } = useSession();
  const { openSearch } = useUi();
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Node elements, so a lens can be measured from the circle it grows out of
  // even when the opening was not a click — a deep link, or a relative.
  const nodeEls = useRef(new Map<string, HTMLButtonElement>());
  const lastOpened = useRef<string | null>(null);

  const layout = useMemo(
    () =>
      tree
        ? buildTreeLayout(tree.people, tree.relationships, tree.generations)
        : buildTreeLayout([], [], []),
    [tree],
  );

  const panZoom = usePanZoom({
    minScale: 0.25,
    maxScale: 2.4,
    content: { width: layout.width, height: layout.height },
  });
  const { setTransform, transform, viewport, consumedDrag } = panZoom;

  const myPersonId = session?.user?.personId ?? null;
  const focusParam = searchParams.get('focus');

  // Fit the whole tree on first paint, then leave the view alone so a pan or
  // zoom is never yanked back by a re-render.
  const hasFitted = useRef(false);
  useEffect(() => {
    if (hasFitted.current) return;
    if (viewport.width === 0 || layout.nodes.length === 0) return;
    hasFitted.current = true;
    setTransform(fitView(layout, viewport, { maxScale: 1 }));
  }, [layout, setTransform, viewport]);

  // A ?focus=<id> link (from search, a person's page, or joining) frames that
  // person and opens their lens.
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam || viewport.width === 0) return;
    if (handledFocus.current === focusParam) return;

    const node = layout.byId.get(focusParam);
    if (!node) return;

    handledFocus.current = focusParam;
    hasFitted.current = true;
    setTransform(centreOn(node, viewport, FOCUS_SCALE));
    setPendingLens(focusParam);
  }, [focusParam, layout, setTransform, viewport]);

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
    setTransform(mine ? centreOn(mine, viewport, FOCUS_SCALE) : fitView(layout, viewport));
  }, [layout, myPersonId, setTransform, viewport]);

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
      <div className={screenClass} ref={panZoom.containerRef} {...panZoom.handlers}>
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
          <button type="button" className={styles.resetButton} onClick={recentre}>
            {myPersonId ? 'קחו אותי אליי' : 'מרכזו הכל'}
          </button>
        </div>

        <div
          className={lens ? `${styles.canvas} ${styles.canvasGlide}` : styles.canvas}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            cursor: panZoom.isDragging ? 'grabbing' : 'grab',
          }}
        >
          <svg
            className={styles.wires}
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.connectors.map((wire) => (
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
            const { person, generation } = node;
            const isOpen = lens?.personId === person.id;
            const isMe = myPersonId === person.id;
            // While the lens holds this person, their circle is *in* the lens.
            // Putting it back the moment the lens starts collapsing means the
            // shrinking disc lands on a node that is already there.
            const lifted = isOpen && !closing;

            return (
              <div
                key={person.id}
                className={styles.station}
                style={{
                  left: node.left,
                  top: node.top,
                  width: NODE_SIZE,
                  zIndex: isOpen ? 40 : 1,
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
                  ref={(element) => {
                    if (element) nodeEls.current.set(person.id, element);
                    else nodeEls.current.delete(person.id);
                  }}
                  className={[styles.node, isMe && styles.nodeMe, lifted && styles.nodeLifted]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ '--delay': `${(index * 0.06).toFixed(2)}s` } as React.CSSProperties}
                  aria-expanded={isOpen}
                  onClick={(event) => {
                    if (consumedDrag()) return;
                    openLens(person.id, originFromElement(event.currentTarget));
                  }}
                >
                  <Avatar
                    person={person}
                    generation={generation}
                    size={NODE_SIZE}
                    filled={isMe}
                  />
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
          })}
        </div>

        <p className={styles.hint}>גררו להזזה · גלגלת או צביטה לזום · לחצו על אדם</p>

        {overture && <TreeOverture onDone={() => setOverture(false)} />}
      </div>

      {lens && (
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
