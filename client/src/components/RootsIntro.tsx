import { useEffect, useRef, useState } from 'react';

import { useSession, useTree } from '../api/hooks.ts';
import styles from './RootsIntro.module.css';

/**
 * The שורשים mark, drawing itself while the archive loads.
 *
 * Ported from the supplied composition, which ran on its own timeline
 * framework. The motion is the same — the same cues, the same easings, the same
 * masks — driven here by one requestAnimationFrame loop instead.
 *
 * The mark builds in four movements: a seed of light at the base, the roots
 * spreading, the woven trunk rising with the branches, and the seven coloured
 * nodes popping in from the lowest to the crown. It then holds, breathing,
 * until the archive behind it is ready.
 */

/** Where each cue begins, in the composition's own seconds. */
const CUE = { roots: 0, rise: 1.1, bloom: 2.15, settle: 2.95 } as const;

/** The last node finishes here — the mark is whole from this moment on. */
const WHOLE_AT = CUE.bloom + 6 * 0.06 + 0.4;

/**
 * How much faster than the original the mark is drawn.
 *
 * At its own pace the build runs about three seconds, which is a long time to
 * hold somebody at a door. Compressed, the whole mark is standing by 1.2s and
 * still reads as a thing that grew rather than a thing that appeared.
 */
const SPEED = 2.4;

/**
 * The mark is on screen at least this long, however fast the archive answers.
 *
 * The whole mark is standing at 1.2s, so this leaves it a quarter-second to be
 * looked at before the hand-off starts — long enough to register as a held
 * image rather than a flash, and with the fade it comes to about 1.8s from the
 * curtain appearing to the archive being in front of you.
 */
const MIN_VISIBLE_MS = 1450;

/** The hand-off to the archive. */
const FADE_MS = 380;

/**
 * A door that will not stay shut. If the API never answers, the archive's own
 * error state is a better thing to look at than a logo that waits forever.
 */
const PATIENCE_MS = 6000;

interface Dot {
  src: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  colour: string;
  /** Bloom order: 0 pops first, 6 last, so the crown lands at the end. */
  order: number;
}

const DOTS: Dot[] = [
  { src: '/logo/dot-0.webp', cx: 0.5159, cy: 0.1603, w: 0.1029, h: 0.1045, colour: '#EE4433', order: 6 },
  { src: '/logo/dot-1.webp', cx: 0.2532, cy: 0.2241, w: 0.0925, h: 0.0933, colour: '#EE4433', order: 5 },
  { src: '/logo/dot-2.webp', cx: 0.7723, cy: 0.2261, w: 0.0957, h: 0.0973, colour: '#EE4433', order: 4 },
  { src: '/logo/dot-3.webp', cx: 0.6703, cy: 0.36, w: 0.0973, h: 0.0989, colour: '#7B4FE0', order: 3 },
  { src: '/logo/dot-4.webp', cx: 0.4322, cy: 0.3612, w: 0.0901, h: 0.0901, colour: '#17A19B', order: 2 },
  { src: '/logo/dot-5.webp', cx: 0.242, cy: 0.4075, w: 0.0734, h: 0.0726, colour: '#F2A11C', order: 1 },
  { src: '/logo/dot-6.webp', cx: 0.7863, cy: 0.4342, w: 0.0678, h: 0.0686, colour: '#17A19B', order: 0 },
];

const TREE = '/logo/tree.webp';

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** The composition's one animation primitive: eased travel between two cues. */
function at(
  T: number,
  from: number,
  to: number,
  start: number,
  end: number,
  ease: (t: number) => number,
): number {
  const progress = clamp((T - start) / (end - start), 0, 1);
  return from + (to - from) * ease(progress);
}

/**
 * A growing circular mask, written so it is always a gradient the browser will
 * honour.
 *
 * The obvious form — black at `r - feather`, transparent at `r` — goes negative
 * while the circle is still small, and a gradient whose stops run from a
 * negative percentage to zero is degenerate: Chrome discards it and paints the
 * layer unmasked, which showed the finished mark for the first half-second
 * instead of growing it. Clamping both stops and keeping them apart fixes it.
 */
function growingCircle(at50: string, radius: number, feather: number): string {
  const outer = Math.max(radius, 0.01);
  const inner = Math.max(outer - feather, 0);
  return `radial-gradient(circle at ${at50}, #000 ${inner}%, rgba(0,0,0,0) ${outer}%)`;
}

/** The mark itself at a moment in its own timeline. Pure: T in, picture out. */
function Mark({ T }: { T: number }): React.JSX.Element {
  // The two growth masks: roots opening downward, canopy opening upward.
  const r0 = at(T, 0, 46, CUE.roots + 0.02, CUE.rise + 0.1, easeInOutCubic);
  const r1 = at(T, 0, 82, CUE.rise - 0.04, CUE.bloom + 0.02, easeInOutCubic);
  const rootMask =
    `${growingCircle('50% 76%', r0, 13)}, ` +
    'linear-gradient(to bottom, rgba(0,0,0,0) 49%, #000 69%)';
  const canopyMask = growingCircle('50% 64%', r1, 16);

  const zoom = at(T, 1.085, 1, CUE.roots, CUE.bloom + 0.35, easeOutCubic);
  const breathe = T > CUE.bloom ? Math.sin((T - CUE.bloom) * 1.9) * 0.004 : 0;
  const driftY = at(T, 16, 0, CUE.roots, CUE.bloom, easeOutCubic);
  const seed = Math.max(0, at(T, 1, 0, CUE.roots, CUE.roots + 0.55, easeOutCubic));
  const wash = at(T, 0, 1, CUE.rise, CUE.bloom + 0.5, easeOutCubic);

  return (
    <div className={styles.stage}>
      <div className={styles.halo} style={{ opacity: wash * 0.9 }} />

      <div
        className={styles.square}
        style={{ transform: `translateY(${driftY * 0.06}%) scale(${zoom + breathe})` }}
      >
        <div className={styles.groundShadow} style={{ opacity: wash }} />

        <div
          className={styles.seed}
          style={{ transform: `scale(${0.35 + (1 - seed) * 1.4})`, opacity: seed * 0.85 }}
        />

        {/* The same artwork twice, each under its own growth mask: the lower
            half unfurls from the base, the crown opens from the bowl. */}
        <div
          className={styles.layer}
          style={{
            WebkitMaskImage: rootMask,
            maskImage: rootMask,
            WebkitMaskComposite: 'source-in',
            maskComposite: 'intersect',
          }}
        >
          <img src={TREE} alt="" className={styles.tree} draggable={false} />
        </div>
        <div
          className={styles.layer}
          style={{ WebkitMaskImage: canopyMask, maskImage: canopyMask }}
        >
          <img src={TREE} alt="" className={styles.tree} draggable={false} />
        </div>

        {DOTS.map((dot) => {
          const start = CUE.bloom + dot.order * 0.06;
          const scale = at(T, 0, 1, start, start + 0.4, easeOutBack);
          const alpha = clamp((T - start) / 0.14, 0, 1);
          const glow = clamp((T - start) / 0.62, 0, 1);
          return (
            <div
              key={dot.src}
              className={styles.node}
              style={{
                left: `${dot.cx * 100}%`,
                top: `${dot.cy * 100}%`,
                width: `${dot.w * 100}%`,
                height: `${dot.h * 100}%`,
                marginLeft: `${-dot.w * 50}%`,
                marginTop: `${-dot.h * 50}%`,
              }}
            >
              <div
                className={styles.nodeGlow}
                style={{
                  background: `radial-gradient(circle, ${dot.colour} 0%, rgba(0,0,0,0) 62%)`,
                  opacity: (1 - glow) * glow * 0.95,
                  transform: `scale(${0.55 + glow * 1.2})`,
                }}
              />
              <img
                src={dot.src}
                alt=""
                className={styles.nodeImage}
                draggable={false}
                style={{ transform: `scale(${Math.max(0, scale)})`, opacity: alpha }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Every file the mark is made of, so it never draws itself half-dressed. */
function preloadArtwork(): Promise<void> {
  const sources = [TREE, ...DOTS.map((d) => d.src)];
  return Promise.all(
    sources.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          // A missing file must not hold the door shut, so both outcomes resolve.
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  ).then(() => undefined);
}

/**
 * Holds the mark over the archive until the archive is worth showing.
 *
 * The children are mounted the whole time — the tree, the session and the
 * fonts are all loading underneath while the logo draws, which is the point of
 * a loading screen. Leaving needs three things to be true: the artwork has
 * finished drawing, the first queries have settled, and the mark has had its
 * moment. Whichever is last decides, and then the whole thing dissolves rather
 * than being cut away.
 */
export function RootsIntro({ children }: { children: React.ReactNode }): React.JSX.Element {
  const session = useSession();
  const tree = useTree();

  const [T, setT] = useState(0);
  const [phase, setPhase] = useState<'drawing' | 'leaving' | 'gone'>(
    // Someone returning within the same tab has seen it; a loading screen on
    // every navigation would be a toll rather than a welcome.
    () => (sessionStorage.getItem('shoresh:intro') ? 'gone' : 'drawing'),
  );

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The archive is ready once both opening queries have answered — including
  // when they answer with an error, which the app itself explains far better
  // than a logo can.
  const ready = !session.isPending && !tree.isPending;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (phase !== 'drawing') return;
    let frame = 0;
    let cancelled = false;
    let startedAt = 0;

    void preloadArtwork().then(() => {
      if (cancelled) return;
      startedAt = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startedAt;

        // Reduced motion gets the finished mark rather than the drawing of it.
        setT(reduced ? WHOLE_AT : (elapsed / 1000) * SPEED);

        const longEnough = elapsed >= (reduced ? 900 : MIN_VISIBLE_MS);
        const outOfPatience = elapsed >= PATIENCE_MS;
        if ((readyRef.current && longEnough) || outOfPatience) {
          setPhase('leaving');
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [phase, reduced]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem('shoresh:intro', '1');
      setPhase('gone');
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <>
      {children}
      {phase !== 'gone' && (
        <div
          className={phase === 'leaving' ? `${styles.veil} ${styles.leaving}` : styles.veil}
          // The archive underneath is the content; this is a curtain over it.
          aria-hidden="true"
        >
          <Mark T={T} />
        </div>
      )}
    </>
  );
}
