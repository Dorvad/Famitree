import { useEffect, useState } from 'react';

import type { Person } from '../../../shared/types.ts';

import { useArchive, useSession, useTree } from '../api/hooks.ts';
import { givenName } from '../lib/format.ts';
import styles from './TreeOverture.module.css';

/** How long the title holds before it lifts away, in milliseconds. */
const HOLD = 2000;
const HOLD_REDUCED = 700;

/** First place in a "ברלין → חיפה" style journey. */
function originOf(person: Person): string | null {
  const first = person.place.split('→')[0]?.trim();
  return first || null;
}

/**
 * The opening line, derived rather than written.
 *
 * The prototype hard-coded "מלודז׳ וברלין, עד אלינו". Building it from the
 * founding row's places means the sentence still tells the truth once the
 * family in the database is a different one.
 */
function buildHeadline(people: Person[]): { origins: string; hasOrigins: boolean } {
  const topRow = Math.min(...people.map((p) => p.y));
  const founders = people.filter((p) => p.y === topRow);
  const origins = [...new Set(founders.map(originOf).filter((o): o is string => Boolean(o)))];

  if (origins.length === 0) return { origins: '', hasOrigins: false };
  if (origins.length === 1) return { origins: `מ${origins[0]}`, hasOrigins: true };

  const last = origins[origins.length - 1] as string;
  const rest = origins.slice(0, -1).join(', ');
  return { origins: `מ${rest} ו${last}`, hasOrigins: true };
}

/**
 * The overture — a title card over the tree as it draws itself.
 *
 * This used to be a home screen of its own, which meant the app opened on a
 * page *about* the tree instead of on the tree. The copy was the only part
 * worth keeping, so it now plays over the real thing: the connectors ink
 * themselves in and the nodes drop into place behind the words, and once the
 * drawing is done the title lifts off and leaves you in the canvas.
 *
 * It never takes the pointer. Anyone who wants to start dragging immediately
 * can, and the title simply lifts away over them.
 */
export function TreeOverture({ onDone }: { onDone: () => void }): React.JSX.Element | null {
  const { data: tree } = useTree();
  const { data: archive } = useArchive();
  const { data: session } = useSession();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setLeaving(true), reduced ? HOLD_REDUCED : HOLD);
    return () => window.clearTimeout(timer);
  }, []);

  if (!tree || tree.people.length === 0) return null;

  const user = session?.user ?? null;
  const years = tree.people.map((p) => p.birthYear).filter((y): y is number => y != null);
  const span = years.length > 0 ? new Date().getFullYear() - Math.min(...years) : 0;
  const cohorts = new Set(tree.people.map((p) => p.generationId)).size;
  const { origins, hasOrigins } = buildHeadline(tree.people);

  return (
    <div
      className={leaving ? `${styles.overture} ${styles.leaving}` : styles.overture}
      // Decoration over the canvas, and gone in two seconds. The screen's own
      // heading is the page title; a card that announces itself and then
      // vanishes is just noise to read out.
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && leaving) onDone();
      }}
    >
      <div className={styles.plate}>
        <p className={styles.badge}>
          {user
            ? `שלום, ${givenName(user.displayName)} — טוב שחזרתם`
            : `ארכיון חי · ${cohorts} דורות`}
        </p>

        <p className={styles.headline}>
          {hasOrigins ? (
            <>
              <span className={styles.line} style={{ '--i': 0 } as React.CSSProperties}>
                {origins},
              </span>
              <span className={styles.line} style={{ '--i': 1 } as React.CSSProperties}>
                עד <em>אלינו</em>.
              </span>
            </>
          ) : (
            <>
              <span className={styles.line} style={{ '--i': 0 } as React.CSSProperties}>
                כל הסיפורים,
              </span>
              <span className={styles.line} style={{ '--i': 1 } as React.CSSProperties}>
                במקום <em>אחד</em>.
              </span>
            </>
          )}
        </p>

        <p className={styles.stats}>
          {span > 0 && `${span} שנות היסטוריה · `}
          {tree.people.length} בני משפחה
          {archive && ` · ${archive.length} אוצרות`}. געו בכל אחד כדי לפתוח את הסיפור שלו.
        </p>
      </div>
    </div>
  );
}
