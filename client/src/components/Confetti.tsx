import styles from './Confetti.module.css';

const PIECES = [
  { left: '6%', color: 'var(--accent)', shape: 'bar', duration: 1.5, delay: 0.05 },
  { left: '16%', color: 'var(--amber)', shape: 'dot', duration: 1.7, delay: 0.2 },
  { left: '26%', color: 'var(--teal)', shape: 'bar', duration: 1.4, delay: 0.35 },
  { left: '36%', color: 'var(--violet)', shape: 'dot', duration: 1.8, delay: 0.1 },
  { left: '46%', color: 'var(--amber)', shape: 'bar', duration: 1.5, delay: 0.45 },
  { left: '56%', color: 'var(--accent)', shape: 'dot', duration: 1.6, delay: 0.25 },
  { left: '66%', color: 'var(--violet)', shape: 'bar', duration: 1.4, delay: 0.5 },
  { left: '76%', color: 'var(--teal)', shape: 'dot', duration: 1.7, delay: 0.15 },
  { left: '86%', color: 'var(--accent)', shape: 'bar', duration: 1.5, delay: 0.4 },
  { left: '94%', color: 'var(--amber)', shape: 'dot', duration: 1.6, delay: 0.3 },
] as const;

/** Purely decorative burst for the "treasure added" moment. */
export function Confetti(): React.JSX.Element {
  return (
    <div className={styles.field} aria-hidden="true">
      {PIECES.map((piece, index) => (
        <span
          key={index}
          className={piece.shape === 'bar' ? styles.bar : styles.dot}
          style={{
            left: piece.left,
            background: piece.color,
            animationDuration: `${piece.duration}s`,
            animationDelay: `${piece.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
