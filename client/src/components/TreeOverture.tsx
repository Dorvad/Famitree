import { useMemo, useState } from 'react';

import { useSession, useTree } from '../api/hooks.ts';
import { familyName } from '../lib/family-cells.ts';
import { givenName } from '../lib/format.ts';
import styles from './TreeOverture.module.css';

/**
 * The overture — the system's front door.
 *
 * It used to be a passing title card on a two-second timer, which read as a
 * flicker: by the time the words registered they were already lifting away.
 * Now it holds. The system's name sits over the canvas, the family names of
 * everyone inside drift gently beneath it, and one button carries you in —
 * the tree replants itself as the card lifts, so pressing התחלה is what pulls
 * you through the door rather than watching it close on a timer.
 *
 * The canvas behind stays live the whole time: the card owns only its own
 * button, so anyone who starts dragging simply pans under the title.
 */
export function TreeOverture({
  onBegin,
  onDone,
}: {
  /** The button was pressed; the camera may start its move under the card. */
  onBegin: () => void;
  /** The lift-away finished; the card can be unmounted. */
  onDone: () => void;
}): React.JSX.Element | null {
  const { data: tree } = useTree();
  const { data: session } = useSession();
  const [leaving, setLeaving] = useState(false);

  /**
   * Every family name in the archive, each shown once. Capped so a very
   * intermarried board stays a subtitle rather than becoming a word cloud.
   */
  const names = useMemo(() => {
    if (!tree) return [];
    const unique = [...new Set(tree.people.map((p) => familyName(p.fullName)))];
    return unique.slice(0, 12);
  }, [tree]);

  if (!tree || tree.people.length === 0) return null;

  const user = session?.user ?? null;

  const begin = (): void => {
    if (leaving) return;
    setLeaving(true);
    onBegin();
  };

  return (
    <div
      className={leaving ? `${styles.overture} ${styles.leaving}` : styles.overture}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && leaving) onDone();
      }}
    >
      {/* data-no-pan: without it the canvas's pan gesture captures the
          pointer on the way down and the button never receives its click. */}
      <div className={styles.plate} data-no-pan>
        {/* No greeting by name on an open archive: there is no account behind
            the visitor, and "שלום, אורח" greets nobody. */}
        <p className={styles.badge}>
          {user && !(session?.open ?? false)
            ? `שלום, ${givenName(user.displayName)} — טוב שחזרתם`
            : 'ארכיון משפחתי חי'}
        </p>

        <p className={styles.title}>
          מערכת <em>שורשים</em>
        </p>

        {names.length > 0 && (
          <p className={styles.names} aria-label="המשפחות באילן">
            {names.map((name, index) => (
              <span
                key={name}
                className={styles.name}
                style={
                  {
                    '--i': index,
                    // Deterministic per position: a different tilt and a
                    // different phase for each name, so the cloud breathes
                    // instead of bobbing in unison.
                    '--tilt': `${((index % 5) - 2) * 1.6}deg`,
                    '--phase': `${-(index * 733) % 4200}ms`,
                  } as React.CSSProperties
                }
              >
                {name}
              </span>
            ))}
          </p>
        )}

        <button type="button" className={styles.begin} onClick={begin} autoFocus>
          היכנסו לאילן ←
        </button>
      </div>
    </div>
  );
}
