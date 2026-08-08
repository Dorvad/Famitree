import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useLogout, useSession, useTree } from '../api/hooks.ts';
import { cohortLine, generationVars, givenName } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { Avatar } from './Avatar.tsx';
import { Sheet } from './Sheet.tsx';
import { Years } from './Years.tsx';
import styles from './SearchSheet.module.css';

interface Tile {
  key: string;
  title: string;
  note: string;
  icon: string;
  bg: string;
  fg: string;
  onSelect: () => void;
}

/**
 * The sheet behind the header's dot-grid button: search the family, jump to a
 * section, and read the colour legend. On narrow screens it is also the app's
 * only navigation, so every destination has to be reachable from here.
 */
export function SearchSheet(): React.JSX.Element {
  const { searchOpen, closeSearch, openAddTreasure } = useUi();
  const { data: tree } = useTree();
  const { data: session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const user = session?.user ?? null;
  const trimmed = query.trim();

  const matches = useMemo(() => {
    if (!trimmed || !tree) return [];
    const needle = trimmed.toLowerCase();
    return tree.people.filter(
      (person) =>
        person.fullName.toLowerCase().includes(needle) ||
        person.place.toLowerCase().includes(needle) ||
        (person.branch ?? '').toLowerCase().includes(needle),
    );
  }, [tree, trimmed]);

  const go = (to: string) => {
    closeSearch();
    setQuery('');
    navigate(to);
  };

  const myPerson = user?.personId
    ? tree?.people.find((p) => p.id === user.personId)
    : undefined;

  const tiles: Tile[] = [
    {
      key: 'add',
      title: 'הוסיפו אוצר',
      note: 'תמונה, מכתב, סיפור',
      icon: '+',
      bg: 'var(--accent-wash)',
      fg: 'var(--accent-strong)',
      onSelect: () =>
        openAddTreasure(
          user ? { subject: givenName(user.displayName), personId: user.personId } : {},
        ),
    },
    {
      key: 'archive',
      title: 'הארכיון',
      note: 'כל האוצרות',
      icon: '▦',
      bg: 'var(--amber-wash)',
      fg: 'var(--amber-strong)',
      onSelect: () => go('/archive'),
    },
    user
      ? {
          key: 'edit',
          title: 'סדנת האילן',
          note: 'אנשים ומידע',
          icon: '✎',
          bg: 'var(--teal-wash)',
          fg: 'var(--teal-strong)',
          onSelect: () => go('/edit'),
        }
      : {
          key: 'timeline',
          title: 'ציר הזמן',
          note: 'לפי שנים',
          icon: '⇢',
          bg: 'var(--teal-wash)',
          fg: 'var(--teal-strong)',
          onSelect: () => go('/timeline'),
        },
    user && myPerson
      ? {
          key: 'me',
          title: givenName(user.displayName),
          note: 'הענף שלי',
          icon: myPerson.initial,
          bg: 'var(--violet-wash)',
          fg: 'var(--violet-strong)',
          onSelect: () => go(`/person/${myPerson.id}`),
        }
      : {
          key: 'login',
          title: user ? givenName(user.displayName) : 'מי אני?',
          note: user ? 'חברו את עצמכם לאילן' : 'כניסה בשם',
          icon: '✧',
          bg: 'var(--violet-wash)',
          fg: 'var(--violet-strong)',
          onSelect: () => go('/login'),
        },
  ];

  return (
    <Sheet open={searchOpen} onClose={closeSearch} title="חיפוש ותפריט" hideTitle>
      <div className={styles.searchRow}>
        <input
          className={styles.input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="חפשו בן משפחה…"
          aria-label="חיפוש בן משפחה"
        />
        <span className={styles.searchIcon} aria-hidden="true">
          ⌕
        </span>
      </div>

      {trimmed ? (
        <div className={styles.results}>
          {matches.map((person, index) => {
            const generation = tree?.generations.find((g) => g.id === person.generationId);
            return (
              <button
                key={person.id}
                type="button"
                className={styles.result}
                style={
                  {
                    '--i': Math.min(index, 10),
                    '--result-tone': generation?.color ?? 'var(--border)',
                  } as React.CSSProperties
                }
                onClick={() => go(`/tree?focus=${encodeURIComponent(person.id)}`)}
              >
                <Avatar person={person} generation={generation} size={40} />
                <span>
                  <span className={styles.resultName}>{person.fullName}</span>
                  <span className={styles.resultMeta}>{cohortLine(person, generation)}</span>
                </span>
              </button>
            );
          })}
          {matches.length === 0 && (
            <p className={styles.noResults}>לא מצאנו — נסו שם אחר</p>
          )}
        </div>
      ) : (
        <>
          <div className={styles.tiles}>
            {tiles.map((tile, index) => (
              <button
                key={tile.key}
                type="button"
                className={styles.tile}
                style={
                  {
                    '--tile-bg': tile.bg,
                    '--tile-fg': tile.fg,
                    '--delay': `${(index * 0.05).toFixed(2)}s`,
                  } as React.CSSProperties
                }
                onClick={tile.onSelect}
              >
                <span className={styles.tileIcon} aria-hidden="true">
                  {tile.icon}
                </span>
                <span className={styles.tileTitle}>{tile.title}</span>
                <span className={styles.tileNote}>{tile.note}</span>
              </button>
            ))}
          </div>

          <div className={styles.legend}>
            <p className={styles.legendTitle}>צבע = דור</p>
            <div className={styles.legendGrid}>
              {(tree?.generations ?? []).map((generation) => (
                <div
                  key={generation.id}
                  className={styles.legendRow}
                  style={generationVars(generation)}
                >
                  <span
                    className={styles.legendDot}
                    style={{ background: generation.color }}
                    aria-hidden="true"
                  />
                  <span className={styles.legendName}>{generation.name}</span>
                  <Years className={styles.legendRange}>{generation.rangeLabel}</Years>
                </div>
              ))}
            </div>
          </div>

          {user && (
            <button
              type="button"
              className={styles.signOut}
              onClick={() => {
                logout.mutate(undefined, { onSuccess: () => go('/') });
              }}
            >
              יציאה מהחשבון
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}
