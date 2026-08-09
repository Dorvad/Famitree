import type { Generation, Person } from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import { generationVars } from '../lib/format.ts';
import styles from './Avatar.module.css';

interface AvatarProps {
  person: Pick<Person, 'fullName' | 'initial' | 'isProvisional' | 'portraitMediaId'>;
  generation: Generation | undefined;
  /** Diameter in px. Ring thickness scales with it. */
  size?: number;
  /** Solid fill instead of an outline — marks the viewer's own node. */
  filled?: boolean;
  className?: string;
}

/**
 * The circular family-tree node: a portrait when one has been uploaded, the
 * person's initial otherwise, ringed in their cohort colour.
 */
export function Avatar({
  person,
  generation,
  size = 84,
  filled = false,
  className,
}: AvatarProps): React.JSX.Element {
  const portrait = mediaUrl(person.portraitMediaId);

  return (
    <span
      className={[
        styles.avatar,
        person.isProvisional && styles.dashed,
        filled && styles.filled,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...generationVars(generation),
        '--size': `${size}px`,
        // Keep the ring visually proportional across the sizes in use (38–148px).
        '--ring': `${Math.max(3, Math.round(size * 0.083))}px`,
      } as React.CSSProperties}
      aria-hidden={portrait ? undefined : true}
    >
      {portrait ? (
        <img
          className={styles.portrait}
          src={portrait}
          alt={person.fullName}
          loading="lazy"
          decoding="async"
        />
      ) : (
        person.initial
      )}
    </span>
  );
}
