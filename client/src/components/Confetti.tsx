import { driftFor } from '../lib/format.ts';
import styles from './Confetti.module.css';

/**
 * The burst for the "treasure added" moment.
 *
 * Pieces tumble on two axes with a seeded sideways drift rather than spinning
 * flat on the spot, so the fall reads as physical. Three shapes — a bar, a
 * disc, and a thin curl of trimmed paper — keep it from looking machine-made.
 */
const PIECES = [
  { left: '5%', color: 'var(--accent)', shape: 'bar', duration: 1.6, delay: 0.05 },
  { left: '14%', color: 'var(--amber)', shape: 'dot', duration: 1.85, delay: 0.22 },
  { left: '23%', color: 'var(--teal)', shape: 'strip', duration: 1.45, delay: 0.38 },
  { left: '33%', color: 'var(--violet)', shape: 'dot', duration: 1.95, delay: 0.11 },
  { left: '42%', color: 'var(--amber)', shape: 'bar', duration: 1.55, delay: 0.48 },
  { left: '51%', color: 'var(--accent)', shape: 'strip', duration: 1.7, delay: 0.27 },
  { left: '60%', color: 'var(--violet)', shape: 'bar', duration: 1.4, delay: 0.53 },
  { left: '69%', color: 'var(--teal)', shape: 'dot', duration: 1.8, delay: 0.16 },
  { left: '78%', color: 'var(--accent)', shape: 'strip', duration: 1.6, delay: 0.42 },
  { left: '87%', color: 'var(--amber)', shape: 'dot', duration: 1.72, delay: 0.31 },
  { left: '94%', color: 'var(--teal)', shape: 'bar', duration: 1.5, delay: 0.19 },
] as const;

const SHAPE_CLASS = {
  bar: styles.bar,
  dot: styles.dot,
  strip: styles.strip,
} as const;

export function Confetti(): React.JSX.Element {
  return (
    <div className={styles.field} aria-hidden="true">
      {PIECES.map((piece, index) => (
        <span
          key={index}
          className={SHAPE_CLASS[piece.shape]}
          style={
            {
              left: piece.left,
              background: piece.color,
              animationDuration: `${piece.duration}s`,
              animationDelay: `${piece.delay}s`,
              '--drift': driftFor(index),
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
