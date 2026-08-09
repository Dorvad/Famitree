import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import { useTimeline, useTree } from '../api/hooks.ts';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import { givenName, restTilt } from '../lib/format.ts';
import { usePanZoom } from '../lib/usePanZoom.ts';
import { useUi } from '../state/ui.tsx';
import styles from './TimelineScreen.module.css';

/** Horizontal pixels per year. Wide enough that a busy decade still breathes. */
const PX_PER_YEAR = 26;
/** Clearance at each end so the outermost card is never clipped. */
const EDGE = 200;

const CARD_WIDTH = 164;
const CARD_GAP = 14;
/** Worst-case card height the lane geometry budgets for. */
const CARD_ESTIMATE = 132;

/** Preference order per event, so consecutive events still straddle the axis. */
const LANE_ORDER = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
] as const;

const TONES = ['var(--accent)', 'var(--amber)', 'var(--teal)', 'var(--violet)'] as const;

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

/**
 * Time runs right to left, matching the reading direction: the earliest year
 * sits at the right edge and the present is away to the left.
 */
export function TimelineScreen(): React.JSX.Element {
  const { data: events, isPending, error, refetch } = useTimeline();
  const { data: tree } = useTree();
  const { openSearch } = useUi();

  // The horizontal scale depends only on the events, so it is computed before
  // the pan hook (which needs the width) — the vertical arrangement, which
  // depends on the viewport the hook measures, comes after.
  const span = useMemo(() => {
    if (!events || events.length === 0) return null;

    const years = events.map((e) => e.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const width = (maxYear - minYear) * PX_PER_YEAR + EDGE * 2;
    const xOf = (year: number) => Math.round(width - EDGE - (year - minYear) * PX_PER_YEAR);

    const decades: Array<{ year: number; x: number }> = [];
    for (let year = Math.ceil(minYear / 10) * 10; year <= maxYear; year += 10) {
      decades.push({ year, x: xOf(year) });
    }

    return { minYear, maxYear, width, decades, xOf };
  }, [events]);

  const panZoom = usePanZoom({
    axis: 'x',
    zoomable: false,
    content: { width: span?.width ?? 1, height: 1 },
  });
  const { setTransform, transform, viewport } = panZoom;

  /**
   * The vertical arrangement, cut to the screen it is on.
   *
   * The band fills the viewport's height; as many lanes as genuinely fit are
   * opened — two inner ones hugging the axis, two outer ones when there is
   * room, which is how a phone ends up with two clear rows instead of four
   * cramped ones. Cards pack into the freest lane, and when a cluster of
   * same-year events exhausts every lane, the card slides sideways instead of
   * on top of its neighbour — its dot stays on the true year, and the card's
   * own year badge keeps the record straight. Overlap is impossible by
   * construction: a lane only ever accepts a card a full card-width clear of
   * the one before.
   */
  const layout = useMemo(() => {
    if (!events || events.length === 0 || !span) return null;

    const bandHeight = viewport.height > 0 ? clamp(viewport.height - 30, 440, 720) : 640;
    const axisY = Math.round(bandHeight * 0.5);

    const laneTops = [axisY - CARD_ESTIMATE - 34, axisY + 66];
    const outerAbove = axisY - CARD_ESTIMATE * 2 - 52;
    if (outerAbove >= 6) laneTops.push(outerAbove);
    const outerBelow = axisY + 66 + CARD_ESTIMATE + 16;
    if (outerBelow + CARD_ESTIMATE <= bandHeight - 4) laneTops.push(outerBelow);

    // x decreases as the year rises, so a lane is free when the last card put
    // there sits at least a card-width further right.
    const lastXInLane: number[] = laneTops.map(() => Number.POSITIVE_INFINITY);

    const placed = [...events]
      .sort((a, b) => a.year - b.year)
      .map((event, index) => {
        const trueX = span.xOf(event.year);
        const order = (LANE_ORDER[index % 2] as readonly number[]).filter(
          (lane) => lane < laneTops.length,
        );
        const lane =
          order.find(
            (candidate) =>
              (lastXInLane[candidate] as number) - trueX >= CARD_WIDTH + CARD_GAP,
          ) ??
          (order.reduce((best, candidate) =>
            (lastXInLane[candidate] as number) > (lastXInLane[best] as number)
              ? candidate
              : best,
          ) as number);

        const x = Math.min(trueX, (lastXInLane[lane] as number) - CARD_WIDTH - CARD_GAP);
        lastXInLane[lane] = x;
        return {
          ...event,
          x,
          dotX: trueX,
          top: laneTops[lane] as number,
          tone: TONES[index % TONES.length] as string,
        };
      });

    return { placed, bandHeight, axisY };
  }, [events, span, viewport.height]);

  // Open on the earliest years, which sit at the right-hand end.
  const hasPositioned = useRef(false);
  useEffect(() => {
    if (hasPositioned.current || !span || viewport.width === 0) return;
    hasPositioned.current = true;
    setTransform({ x: viewport.width - span.width, y: 0, k: 1 });
  }, [span, setTransform, viewport]);

  const jumpTo = useCallback(
    (year: number) => {
      if (!span) return;
      setTransform({ x: viewport.width / 2 - span.xOf(year), y: 0, k: 1 });
    },
    [span, setTransform, viewport.width],
  );

  if (isPending) return <LoadingScreen label="מסדרים את ציר הזמן…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!span || !layout) {
    return (
      <EmptyState
        title="אין עדיין אירועים בציר"
        message="כל אירוע שיתווסף — לידה, מסע, חתונה — יופיע כאן לפי שנה."
        actionLabel="פתחו את התפריט"
        onAction={openSearch}
      />
    );
  }

  // The axis gradient walks the accent palette across the whole span.
  const axisGradient = `linear-gradient(90deg, var(--violet) 0%, var(--teal) 34%, var(--amber) 64%, var(--accent) 100%)`;

  return (
    <div className={styles.screen} ref={panZoom.containerRef} {...panZoom.handlers}>
      <h1 className={styles.title}>ציר הזמן של המשפחה</h1>
      <p className={styles.hint}>
        {span.minYear} מימין → {span.maxYear} משמאל · גררו
      </p>

      <div
        className={styles.canvas}
        style={{
          width: span.width,
          height: layout.bandHeight,
          // Centre the axis in the viewport, not the band, so the rows above
          // and below it stay balanced on screen whatever their heights.
          marginTop: -layout.axisY,
          '--axis-y': `${layout.axisY}px`,
          transform: `translateX(${transform.x}px)`,
          cursor: panZoom.isDragging ? 'grabbing' : 'grab',
        } as React.CSSProperties}
      >
        <span
          className={styles.axis}
          style={{ '--axis': axisGradient } as React.CSSProperties}
          aria-hidden="true"
        />

        {span.decades.map((decade) => (
          <span key={decade.year} className={styles.decade} style={{ left: decade.x }}>
            {decade.year}
          </span>
        ))}

        {layout.placed.map((event, index) => {
          const linked = event.personIds
            .map((id) => tree?.people.find((p) => p.id === id))
            .filter((p): p is NonNullable<typeof p> => Boolean(p));
          // The card still opens one page — the first person carries the tap;
          // everyone involved is named on the card itself.
          const person = linked[0];

          const card = (
            <>
              <span className={styles.eventYear}>{event.year}</span>
              <p className={styles.eventTitle}>{event.title}</p>
              {linked.length > 1 && (
                <span className={styles.eventPeople}>
                  {linked.map((p) => givenName(p.fullName)).join(' · ')}
                </span>
              )}
            </>
          );

          return (
            <div key={event.id}>
              <span
                className={styles.dot}
                style={
                  {
                    left: event.dotX,
                    background: event.tone,
                    '--i': index,
                  } as React.CSSProperties
                }
                aria-hidden="true"
              />
              {person ? (
                <Link
                  to={`/person/${person.id}`}
                  className={styles.event}
                  style={
                    {
                      left: event.x,
                      top: event.top,
                      '--tone': event.tone,
                      '--rest-tilt': restTilt(event.id, 1.6),
                      '--i': index,
                    } as React.CSSProperties
                  }
                  data-no-pan
                >
                  {card}
                </Link>
              ) : (
                <div
                  className={styles.event}
                  style={
                    {
                      left: event.x,
                      top: event.top,
                      '--tone': event.tone,
                      '--rest-tilt': restTilt(event.id, 1.6),
                      '--i': index,
                    } as React.CSSProperties
                  }
                >
                  {card}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <span className={styles.fadeStart} aria-hidden="true" />
      <span className={styles.fadeEnd} aria-hidden="true" />

      <div className={styles.jump} data-no-pan>
        <button type="button" className={styles.jumpButton} onClick={() => jumpTo(span.minYear)}>
          → להתחלה ({span.minYear})
        </button>
        <button type="button" className={styles.jumpButton} onClick={() => jumpTo(span.maxYear)}>
          להיום ({span.maxYear}) ←
        </button>
      </div>
    </div>
  );
}
