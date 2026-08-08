import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useSession, useTree } from '../api/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import { Years } from '../components/Years.tsx';
import { generationVars, givenName, restTilt } from '../lib/format.ts';
import { NODE_SIZE, buildTreeLayout, centreOn, fitView } from '../lib/tree-layout.ts';
import { usePanZoom } from '../lib/usePanZoom.ts';
import { useUi } from '../state/ui.tsx';
import styles from './TreeScreen.module.css';

/** Zoom applied when jumping to a specific person, as in the original. */
const FOCUS_SCALE = 1.2;

export function TreeScreen(): React.JSX.Element {
  const { data: tree, isPending, error, refetch } = useTree();
  const { data: session } = useSession();
  const { openSearch } = useUi();
  const [searchParams, setSearchParams] = useSearchParams();

  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

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

  // A ?focus=<id> link (from search, the home rail, or joining) centres that
  // person and opens their card.
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusParam || viewport.width === 0) return;
    if (handledFocus.current === focusParam) return;

    const node = layout.byId.get(focusParam);
    if (!node) return;

    handledFocus.current = focusParam;
    hasFitted.current = true;
    setTransform(centreOn(node, viewport, FOCUS_SCALE));
    setOpenPersonId(focusParam);
  }, [focusParam, layout, setTransform, viewport]);

  const recentre = useCallback(() => {
    const mine = myPersonId ? layout.byId.get(myPersonId) : undefined;
    setTransform(mine ? centreOn(mine, viewport, FOCUS_SCALE) : fitView(layout, viewport));
    if (mine) setOpenPersonId(mine.person.id);
  }, [layout, myPersonId, setTransform, viewport]);

  const closeCard = useCallback(() => {
    setOpenPersonId(null);
    if (searchParams.has('focus')) {
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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

  return (
    <div
      className={styles.screen}
      ref={panZoom.containerRef}
      {...panZoom.handlers}
      onClick={() => {
        // A click that ends a pan must not also dismiss the open card.
        if (!consumedDrag() && openPersonId) closeCard();
      }}
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
        <button type="button" className={styles.resetButton} onClick={recentre}>
          {myPersonId ? 'קחו אותי אליי' : 'מרכזו הכל'}
        </button>
      </div>

      <div
        className={styles.canvas}
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
          const isOpen = openPersonId === person.id;
          const isMe = myPersonId === person.id;

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
                className={
                  isMe ? `${styles.node} ${styles.nodeMe}` : styles.node
                }
                style={{ '--delay': `${(index * 0.06).toFixed(2)}s` } as React.CSSProperties}
                aria-expanded={isOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  if (consumedDrag()) return;
                  setOpenPersonId(isOpen ? null : person.id);
                }}
              >
                <Avatar person={person} generation={generation} size={NODE_SIZE} filled={isMe} />
                <span className="visually-hidden">
                  {person.fullName}, {person.lifeSpan}
                </span>
              </button>

              {!isOpen && (
                <span className={styles.pill} aria-hidden="true">
                  <span className={styles.pillName}>{givenName(person.fullName)}</span>{' '}
                  <Years className={styles.pillYears}>{person.lifeSpan}</Years>
                </span>
              )}

              {isOpen && (
                <div className={styles.card} onClick={(event) => event.stopPropagation()}>
                  <div className={styles.cardHead}>
                    <div>
                      <p className={styles.cardCohort}>
                        {[generation?.name, person.branch].filter(Boolean).join(' · ')}
                      </p>
                      <p className={styles.cardName}>{person.fullName}</p>
                    </div>
                    <button
                      type="button"
                      className={styles.cardClose}
                      onClick={closeCard}
                      aria-label="סגירת הכרטיס"
                    >
                      ×
                    </button>
                  </div>

                  <div className={styles.cardTags}>
                    <Years className={styles.tagCohort}>{person.lifeSpan}</Years>
                    {person.place && <span className={styles.tagPlace}>{person.place}</span>}
                  </div>

                  {person.story && <p className={styles.cardStory}>{person.story}</p>}

                  <Link to={`/person/${person.id}`} className={styles.cardLink}>
                    לסיפור המלא ←
                  </Link>
                </div>
              )}

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
    </div>
  );
}
