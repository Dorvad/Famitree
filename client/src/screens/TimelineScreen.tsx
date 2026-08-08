import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import { useTimeline, useTree } from '../api/hooks.ts';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import { restTilt } from '../lib/format.ts';
import { usePanZoom } from '../lib/usePanZoom.ts';
import { useUi } from '../state/ui.tsx';
import styles from './TimelineScreen.module.css';

/** Horizontal pixels per year — the density the design was drawn at. */
const PX_PER_YEAR = 17.5;
/** Clearance at each end so the outermost card is never clipped. */
const EDGE = 150;
/** Band height and the axis's offset within it. */
const BAND_HEIGHT = 640;
const AXIS_Y = 300;

const CARD_WIDTH = 164;
const CARD_GAP = 12;

/**
 * Rows a card can sit in, as offsets from the band's top.
 *
 * The design alternated strictly above/below the axis, which collides as soon
 * as two events fall within ~9 years of each other — and the sample family has
 * six events between 1933 and 1952. Cards are packed into the first row with
 * room instead, preferring the inner rows so the timeline stays compact.
 */
const LANES = [130, 380, 0, 510] as const;
/** Preference order per event, so consecutive events still straddle the axis. */
const LANE_ORDER = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
] as const;

const TONES = ['var(--accent)', 'var(--amber)', 'var(--teal)', 'var(--violet)'] as const;

/**
 * Time runs right to left, matching the reading direction: the earliest year
 * sits at the right edge and the present is away to the left.
 */
export function TimelineScreen(): React.JSX.Element {
  const { data: events, isPending, error, refetch } = useTimeline();
  const { data: tree } = useTree();
  const { openSearch } = useUi();

  const model = useMemo(() => {
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

    // x decreases as the year rises, so a row is free when the last card put
    // there sits at least a card-width further right.
    const lastXInLane: number[] = LANES.map(() => Number.POSITIVE_INFINITY);

    const placed = [...events]
      .sort((a, b) => a.year - b.year)
      .map((event, index) => {
        const x = xOf(event.year);
        const order = LANE_ORDER[index % 2] as readonly number[];
        const lane =
          order.find(
            (candidate) =>
              (lastXInLane[candidate] as number) - x >= CARD_WIDTH + CARD_GAP,
          ) ??
          // Every row is crowded at this point in time; the least-recently used
          // one still gives the most clearance available.
          (order.reduce((best, candidate) =>
            (lastXInLane[candidate] as number) > (lastXInLane[best] as number)
              ? candidate
              : best,
          ) as number);

        lastXInLane[lane] = x;
        return {
          ...event,
          x,
          top: LANES[lane] as number,
          tone: TONES[index % TONES.length] as string,
        };
      });

    return { minYear, maxYear, width, decades, placed, xOf };
  }, [events]);

  const panZoom = usePanZoom({
    axis: 'x',
    zoomable: false,
    content: { width: model?.width ?? 1, height: BAND_HEIGHT },
  });
  const { setTransform, transform, viewport } = panZoom;

  // Open on the earliest years, which sit at the right-hand end.
  const hasPositioned = useRef(false);
  useEffect(() => {
    if (hasPositioned.current || !model || viewport.width === 0) return;
    hasPositioned.current = true;
    setTransform({ x: viewport.width - model.width, y: 0, k: 1 });
  }, [model, setTransform, viewport]);

  const jumpTo = useCallback(
    (year: number) => {
      if (!model) return;
      setTransform({ x: viewport.width / 2 - model.xOf(year), y: 0, k: 1 });
    },
    [model, setTransform, viewport.width],
  );

  if (isPending) return <LoadingScreen label="מסדרים את ציר הזמן…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!model) {
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
        {model.minYear} מימין → {model.maxYear} משמאל · גררו
      </p>

      <div
        className={styles.canvas}
        style={{
          width: model.width,
          height: BAND_HEIGHT,
          // Centre the axis in the viewport, not the band, so the rows above
          // and below it stay balanced on screen whatever their heights.
          marginTop: -AXIS_Y,
          transform: `translateX(${transform.x}px)`,
          cursor: panZoom.isDragging ? 'grabbing' : 'grab',
        }}
      >
        <span
          className={styles.axis}
          style={{ '--axis': axisGradient } as React.CSSProperties}
          aria-hidden="true"
        />

        {model.decades.map((decade) => (
          <span key={decade.year} className={styles.decade} style={{ left: decade.x }}>
            {decade.year}
          </span>
        ))}

        {model.placed.map((event, index) => {
          const person = event.personId
            ? tree?.people.find((p) => p.id === event.personId)
            : undefined;

          const card = (
            <>
              <span className={styles.eventYear}>{event.year}</span>
              <p className={styles.eventTitle}>{event.title}</p>
            </>
          );

          return (
            <div key={event.id}>
              <span
                className={styles.dot}
                style={
                  { left: event.x, background: event.tone, '--i': index } as React.CSSProperties
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
        <button type="button" className={styles.jumpButton} onClick={() => jumpTo(model.minYear)}>
          → להתחלה ({model.minYear})
        </button>
        <button type="button" className={styles.jumpButton} onClick={() => jumpTo(model.maxYear)}>
          להיום ({model.maxYear}) ←
        </button>
      </div>
    </div>
  );
}
