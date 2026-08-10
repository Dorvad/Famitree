import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import type { Person } from '../../../shared/types.ts';

import { useTimeline, useTree } from '../api/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import { givenName, restTilt } from '../lib/format.ts';
import { usePanZoom } from '../lib/usePanZoom.ts';
import { useUi } from '../state/ui.tsx';
import styles from './TimelineScreen.module.css';

/** Horizontal pixels per year for a sparse timeline. */
const PX_PER_YEAR = 26;

/**
 * Ceiling for the density-aware scale below.
 *
 * Stretching the years apart is what keeps a busy archive's cards near the year
 * they belong to, but it is paid for in dragging: past this, the quiet stretches
 * between events become long enough to feel like a fault.
 */
const MAX_PX_PER_YEAR = 88;

/**
 * Lanes the scale assumes when it sizes the canvas.
 *
 * The true count is known only once the viewport has been measured, which
 * happens after the canvas width is needed — so the scale plans for the
 * common case, a laptop or a phone. A taller display opens more lanes and
 * simply has room to spare.
 */
const ASSUMED_LANES = 2;

/** Clearance at each end so the outermost card is never clipped. */
const EDGE = 200;

const CARD_WIDTH = 176;
/** Card width on a phone. Kept here because the packer spaces cards by it. */
const CARD_WIDTH_COMPACT = 158;
const CARD_GAP = 14;
/**
 * Worst-case card height the lane geometry budgets for.
 *
 * Measured rather than guessed: with the title clamped to two lines and the
 * names to one, a card with its portrait row tops out at 138px, so this carries
 * a little slack for font fallback. Lanes are spaced by this figure, and a card
 * taller than its budget is how two lanes end up touching.
 */
const CARD_ESTIMATE = 146;

/**
 * Longest entrance stagger, in cards.
 *
 * The delay is the card's index times a beat, so an uncapped stagger turns a
 * fuller archive into a slower one — fifty events would keep the last card off
 * screen for over three seconds. Past this many, the rest arrive together.
 */
const MAX_STAGGER = 14;

/**
 * How many faces fit on a card beside the year badge.
 *
 * The head row has a fixed budget — card width less its padding, less the year
 * badge — so the count is a geometry constraint, not a taste one. Three faces
 * fill it exactly; the moment a "+N" chip is also needed, that chip takes the
 * third slot rather than pushing the year off the card.
 */
const MAX_PORTRAITS = 3;

/** Faces to draw, and how many are folded into the "+N" chip. */
function splitPortraits<T>(people: T[]): { shown: T[]; folded: number } {
  if (people.length <= MAX_PORTRAITS) return { shown: people, folded: 0 };
  const shown = people.slice(0, MAX_PORTRAITS - 1);
  return { shown, folded: people.length - shown.length };
}

/**
 * The person's age in the event's year — "בגיל 24" on the card. Only shown
 * when it can be said with a straight face: one linked person, a recorded
 * birth year, and an age a human being can actually reach.
 *
 * Age zero is left out on purpose. It is arithmetically right and tells the
 * reader nothing — the event on a person's birth year is their birth, and
 * "נולד … בגיל 0" is the card explaining itself twice.
 */
function ageAt(person: Person, year: number): number | null {
  if (person.birthYear == null) return null;
  const age = year - person.birthYear;
  return age >= 1 && age <= 110 ? age : null;
}

/** Vertical gap between one lane and the next. */
const LANE_GAP = 14;

/** Clearance a card must leave the axis: above it, and below it past the decade badges. */
const AXIS_GAP_ABOVE = 40;
const AXIS_GAP_BELOW = 58;

/**
 * Room the screen's own furniture needs. Cards are laid out to stay clear of
 * the title and drag hint at the top and the jump buttons at the bottom —
 * without this the outermost lane slid under them and the hint was printed
 * across a card.
 */
const TOP_CLEARANCE = 84;
const BOTTOM_CLEARANCE = 62;

/**
 * Lane preference for one event, so consecutive events straddle the axis
 * instead of queueing up on one side.
 *
 * Lanes are ordered nearest-the-axis outward and alternate sides, so plain
 * ascending order already zig-zags; odd-numbered events swap each neighbouring
 * pair, which starts them on the other side.
 */
function lanePreference(laneCount: number, eventIndex: number): number[] {
  const order = Array.from({ length: laneCount }, (_, lane) => lane);
  if (eventIndex % 2 === 1) {
    for (let i = 0; i + 1 < order.length; i += 2) {
      [order[i], order[i + 1]] = [order[i + 1] as number, order[i] as number];
    }
  }
  return order;
}

const TONES = ['var(--accent)', 'var(--amber)', 'var(--teal)', 'var(--violet)'] as const;

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
    const yearSpan = Math.max(1, maxYear - minYear);

    /*
     * The scale answers to how much there is to show, not only to how many
     * years it covers. At a fixed 26px a year, a family that records a lot of
     * moments runs out of room and its cards slide away from the years they
     * belong to; widening the canvas so every card has a place to stand keeps
     * them where they mean something. Time stays strictly linear either way —
     * only the number of pixels a year is worth changes.
     */
    const roomNeeded = (events.length / ASSUMED_LANES) * (CARD_WIDTH + CARD_GAP);
    const pxPerYear = Math.min(
      MAX_PX_PER_YEAR,
      Math.max(PX_PER_YEAR, roomNeeded / yearSpan),
    );

    const width = yearSpan * pxPerYear + EDGE * 2;
    const xOf = (year: number) => Math.round(width - EDGE - (year - minYear) * pxPerYear);

    const decades: Array<{ year: number; x: number }> = [];
    for (let year = Math.ceil(minYear / 10) * 10; year <= maxYear; year += 10) {
      decades.push({ year, x: xOf(year) });
    }

    return { minYear, maxYear, width, pxPerYear, decades, xOf };
  }, [events]);

  const panZoom = usePanZoom({
    axis: 'x',
    zoomable: false,
    content: { width: span?.width ?? 1, height: 1 },
  });
  const { setTransform, transform, viewport } = panZoom;

  /**
   * Phone-sized dimensions, chosen from the measured viewport rather than a CSS
   * media query. Both the card width and the portrait diameters are needed in
   * JavaScript — the width because the packer spaces cards by it and the card
   * is centred on its year in JS, the diameters because the Avatar writes its
   * size inline and a stylesheet could only win that back with `!important`.
   * One source of truth beats CSS and JS each holding their own copy.
   */
  const compact = viewport.width > 0 && viewport.width <= 520;
  const cardWidth = compact ? CARD_WIDTH_COMPACT : CARD_WIDTH;
  const leadPortrait = compact ? 34 : 40;
  const restPortrait = compact ? 28 : 32;

  /**
   * The vertical arrangement, cut to the screen it is on.
   *
   * The band *is* the screen and the axis sits at its middle, so a card's
   * position on the canvas is also where the eye finds it — which is what lets
   * the lanes be laid out against the real furniture above and below them.
   * Lanes are opened outward from the axis for as long as a full card still
   * fits inside those clearances, alternating sides; a laptop window therefore
   * gets one lane each way and a tall display gets two, rather than four
   * cramped ones with the top row hidden under the title.
   *
   * Cards pack into the freest lane, and when a cluster of same-year events
   * exhausts every lane, the card slides sideways instead of on top of its
   * neighbour — its dot stays on the true year, and the card's own year badge
   * keeps the record straight. Overlap is impossible by construction: a lane
   * only ever accepts a card a full card-width clear of the one before.
   */
  const layout = useMemo(() => {
    if (!events || events.length === 0 || !span) return null;

    const bandHeight = Math.max(viewport.height > 0 ? viewport.height : 640, 420);
    const axisY = Math.round(bandHeight / 2);

    const topLimit = TOP_CLEARANCE;
    const bottomLimit = bandHeight - BOTTOM_CLEARANCE;

    const above: number[] = [];
    for (
      let top = axisY - AXIS_GAP_ABOVE - CARD_ESTIMATE;
      top >= topLimit;
      top -= CARD_ESTIMATE + LANE_GAP
    ) {
      above.push(top);
    }
    const below: number[] = [];
    for (
      let top = axisY + AXIS_GAP_BELOW;
      top + CARD_ESTIMATE <= bottomLimit;
      top += CARD_ESTIMATE + LANE_GAP
    ) {
      below.push(top);
    }
    // On a screen too short for even one clear lane, take the lane anyway: a
    // card grazing the chrome beats a timeline with nowhere to put its events.
    if (above.length === 0) above.push(axisY - AXIS_GAP_ABOVE - CARD_ESTIMATE);
    if (below.length === 0) below.push(axisY + AXIS_GAP_BELOW);

    // Interleaved nearest-first, so lane 0 hugs the axis above, lane 1 below it.
    const laneTops: number[] = [];
    for (let pair = 0; pair < Math.max(above.length, below.length); pair += 1) {
      if (above[pair] !== undefined) laneTops.push(above[pair] as number);
      if (below[pair] !== undefined) laneTops.push(below[pair] as number);
    }

    // x decreases as the year rises, so a lane is free when the last card put
    // there sits at least a card-width further right.
    const lastXInLane: number[] = laneTops.map(() => Number.POSITIVE_INFINITY);

    const placed = [...events]
      .sort((a, b) => a.year - b.year)
      .map((event, index) => {
        const trueX = span.xOf(event.year);
        const order = lanePreference(laneTops.length, index);
        const lane =
          order.find(
            (candidate) =>
              (lastXInLane[candidate] as number) - trueX >= cardWidth + CARD_GAP,
          ) ??
          (order.reduce((best, candidate) =>
            (lastXInLane[candidate] as number) > (lastXInLane[best] as number)
              ? candidate
              : best,
          ) as number);

        const x = Math.min(trueX, (lastXInLane[lane] as number) - cardWidth - CARD_GAP);
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
  }, [cardWidth, events, span, viewport.height]);

  // Lookups by id, built once — a .find() per event per person is quadratic
  // and the whole point of this screen is to stay light as the family grows.
  const peopleById = useMemo(
    () => new Map((tree?.people ?? []).map((p) => [p.id, p])),
    [tree],
  );
  const generationById = useMemo(
    () => new Map((tree?.generations ?? []).map((g) => [g.id, g])),
    [tree],
  );

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
        {/* Alternate decades carry the faintest wash, so dragging through the
            years has a rhythm to it — like ruled pages turning. */}
        {span.decades
          .filter((decade) => (decade.year / 10) % 2 === 0)
          .map((decade) => (
            <span
              key={`stripe-${decade.year}`}
              className={styles.decadeStripe}
              style={{ left: decade.x - 10 * span.pxPerYear, width: 10 * span.pxPerYear }}
              aria-hidden="true"
            />
          ))}

        <span
          className={styles.axis}
          style={{ '--axis': axisGradient } as React.CSSProperties}
          aria-hidden="true"
        />

        {/* Each note hangs from the thread on its own string. Drawn behind the
            cards, so the string can aim at the card's middle and simply
            disappear under it — the year dot stays the anchor of truth. */}
        <svg
          className={styles.stems}
          width={span.width}
          height={layout.bandHeight}
          aria-hidden="true"
        >
          {layout.placed.map((event, index) => {
            /*
             * A string is only worth drawing while it still reads as one. When
             * a crowded stretch pushes a card well away from its year, the
             * curve flattens into a long horizontal streak, and a screenful of
             * those is a tangle rather than a thread — so it fades with the
             * distance and is dropped once the card has travelled more than
             * its own width. The dot keeps the year, and so does the card's
             * own badge.
             */
            const drift = Math.abs(event.x - event.dotX);
            if (drift > cardWidth) return null;

            const startY = layout.axisY + 7;
            const endY = event.top + 64;
            const midY = (startY + endY) / 2;
            return (
              <path
                key={event.id}
                className={styles.stem}
                d={`M ${event.dotX} ${startY} C ${event.dotX} ${midY}, ${event.x} ${midY}, ${event.x} ${endY}`}
                pathLength={1}
                style={
                  {
                    stroke: event.tone,
                    '--stem-opacity': (0.45 - 0.3 * (drift / cardWidth)).toFixed(2),
                    '--i': Math.min(index, MAX_STAGGER),
                  } as React.CSSProperties
                }
              />
            );
          })}
        </svg>

        {span.decades.map((decade) => (
          <span key={decade.year} className={styles.decade} style={{ left: decade.x }}>
            {decade.year}
          </span>
        ))}

        {layout.placed.map((event, index) => {
          const linked = event.personIds
            .map((id) => peopleById.get(id))
            .filter((p): p is Person => Boolean(p));
          // The card still opens one page — the first person carries the tap;
          // everyone involved is pictured and named on the card itself.
          const person = linked[0];
          const age = linked.length === 1 && person ? ageAt(person, event.year) : null;
          const { shown, folded } = splitPortraits(linked);

          const card = (
            <>
              <span className={styles.eventHead}>
                {shown.length > 0 && (
                  <span className={styles.portraits}>
                    {shown.map((p, place) => (
                      <Avatar
                        key={p.id}
                        person={p}
                        generation={generationById.get(p.generationId)}
                        size={place === 0 ? leadPortrait : restPortrait}
                        className={styles.portrait}
                      />
                    ))}
                    {folded > 0 && <span className={styles.portraitMore}>+{folded}</span>}
                  </span>
                )}
                <span className={styles.eventYear}>{event.year}</span>
              </span>
              <p className={styles.eventTitle}>{event.title}</p>
              {linked.length > 0 && (
                <span className={styles.eventPeople}>
                  {linked.map((p) => givenName(p.fullName)).join(' · ')}
                  {age !== null && ` · בגיל ${age}`}
                </span>
              )}
            </>
          );

          /**
           * Centred by `left`, never by `transform`.
           *
           * The entrance keyframe sets `transform` outright, so a
           * `translateX(-50%)` in the base rule is dropped for the length of
           * the animation and reinstated when it ends — which slid every card
           * half its own width the instant it landed. Position and animation
           * now own different properties and cannot fight.
           */
          const cardStyle = {
            left: event.x - cardWidth / 2,
            width: cardWidth,
            top: event.top,
            '--tone': event.tone,
            '--rest-tilt': restTilt(event.id, 1.6),
            '--i': Math.min(index, MAX_STAGGER),
          } as React.CSSProperties;

          return (
            <div key={event.id}>
              <span
                className={styles.dot}
                style={
                  {
                    left: event.dotX,
                    background: event.tone,
                    '--i': Math.min(index, MAX_STAGGER),
                  } as React.CSSProperties
                }
                aria-hidden="true"
              />
              {person ? (
                <Link
                  to={`/person/${person.id}`}
                  className={styles.event}
                  style={cardStyle}
                  data-no-pan
                >
                  {card}
                </Link>
              ) : (
                <div className={styles.event} style={cardStyle}>
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
