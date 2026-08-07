import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import type { Person } from '../../../shared/types.ts';

import { useArchive, useSession, useTree } from '../api/hooks.ts';
import { ScrollArea } from '../components/AppShell.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import { givenName } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import styles from './HomeScreen.module.css';

/** First place in a "ברלין → חיפה" style journey. */
function originOf(person: Person): string | null {
  const first = person.place.split('→')[0]?.trim();
  return first || null;
}

/**
 * Hero copy the prototype hard-coded ("מלודז׳ וברלין, עד אלינו"). Deriving it
 * means the line still tells the truth once the family in the database is a
 * different one.
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

export function HomeScreen(): React.JSX.Element {
  const { data: tree, isPending, error, refetch } = useTree();
  const { data: archive } = useArchive();
  const { data: session } = useSession();
  const { openSearch } = useUi();

  const user = session?.user ?? null;

  const rail = useMemo(() => {
    if (!tree) return [];
    // Oldest first so the thread reads as a passage of time, left to right.
    return [...tree.people].sort((a, b) => {
      const ay = a.birthYear ?? Number.MAX_SAFE_INTEGER;
      const by = b.birthYear ?? Number.MAX_SAFE_INTEGER;
      return ay - by || a.fullName.localeCompare(b.fullName, 'he');
    });
  }, [tree]);

  if (isPending) return <LoadingScreen />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!tree || tree.people.length === 0) {
    return (
      <EmptyState
        title="האילן עדיין ריק"
        message="הוסיפו את בן המשפחה הראשון כדי להתחיל את המסע."
        actionLabel="פתחו את התפריט"
        onAction={openSearch}
      />
    );
  }

  const years = tree.people.map((p) => p.birthYear).filter((y): y is number => y != null);
  const span = years.length > 0 ? new Date().getFullYear() - Math.min(...years) : 0;
  const cohorts = new Set(tree.people.map((p) => p.generationId)).size;
  const { origins, hasOrigins } = buildHeadline(tree.people);

  // Thread colours follow the rail order, so the gradient walks the cohorts.
  const thread = `linear-gradient(90deg, ${rail
    .map((person, index) => {
      const colour =
        tree.generations.find((g) => g.id === person.generationId)?.color ?? '#e6d2ba';
      return `${colour} ${Math.round((index / Math.max(rail.length - 1, 1)) * 100)}%`;
    })
    .join(', ')})`;

  return (
    <ScrollArea>
      <div className={styles.screen}>
        <div className={styles.hero}>
          <p className={styles.badge}>
            {user
              ? `שלום, ${givenName(user.displayName)} — טוב שחזרתם`
              : `ארכיון חי · ${cohorts} דורות`}
          </p>

          <h1 className={styles.headline}>
            {hasOrigins ? (
              <>
                {origins},<br />
                עד <em>אלינו</em>.
              </>
            ) : (
              <>
                כל הסיפורים,
                <br />
                במקום <em>אחד</em>.
              </>
            )}
          </h1>

          <p className={styles.stats}>
            {span > 0 && `${span} שנות היסטוריה · `}
            {tree.people.length} בני משפחה
            {archive && ` · ${archive.length} אוצרות`}. געו בכל אחד כדי לפתוח את הסיפור שלו.
          </p>

          <Link to="/tree" className={styles.cta}>
            {user ? 'חזרו לאילן ←' : 'היכנסו לאילן ←'}
          </Link>
        </div>

        <div className={styles.railWrap}>
          <div className={styles.rail}>
            <span
              className={styles.thread}
              style={{ '--thread': thread } as React.CSSProperties}
              aria-hidden="true"
            />
            {rail.map((person, index) => {
              const generation = tree.generations.find((g) => g.id === person.generationId);
              const isMe = user?.personId === person.id;
              return (
                <Link
                  key={person.id}
                  to={`/tree?focus=${encodeURIComponent(person.id)}`}
                  className={styles.stop}
                  style={{ '--delay': `${(index * 0.3).toFixed(1)}s` } as React.CSSProperties}
                >
                  <Avatar person={person} generation={generation} size={56} filled={isMe} />
                  <span className={isMe ? styles.stopNameMe : styles.stopName}>
                    {givenName(person.fullName)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
