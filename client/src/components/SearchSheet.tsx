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
  const { searchOpen, closeSearch, openAddTreasure, openKinship } = useUi();
  const { data: tree } = useTree();
  const { data: session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const user = session?.user ?? null;
  /**
   * On an open archive there are no accounts, so the menu says nothing about
   * them: no name to show, nothing to sign out of, and no door to knock on.
   */
  const openArchive = session?.open ?? false;
  const trimmed = query.trim();

  /**
   * Rendered results are capped: past a screenful nobody scrolls, they type
   * another letter. The count under the list says how many more there are.
   */
  const MAX_RESULTS = 30;

  const { matches, hiddenMatches } = useMemo(() => {
    if (!trimmed || !tree) return { matches: [], hiddenMatches: 0 };
    const needle = trimmed.toLowerCase();
    const all = tree.people.filter(
      (person) =>
        person.fullName.toLowerCase().includes(needle) ||
        person.place.toLowerCase().includes(needle) ||
        (person.branch ?? '').toLowerCase().includes(needle),
    );
    // Names that start with the query first — that is usually the person meant.
    all.sort((a, b) => {
      const aStarts = a.fullName.toLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = b.fullName.toLowerCase().startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.fullName.localeCompare(b.fullName, 'he');
    });
    return { matches: all.slice(0, MAX_RESULTS), hiddenMatches: all.length - Math.min(all.length, MAX_RESULTS) };
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
    {
      key: 'kinship',
      title: 'מה הקשר?',
      note: 'בין שני בני משפחה',
      icon: '⁂',
      bg: 'var(--teal-wash)',
      fg: 'var(--teal-strong)',
      onSelect: openKinship,
    },
    /*
     * The way into editing.
     *
     * It lives here rather than in the header, which is the whole of "somewhat
     * hidden": a visitor reading the tree is never shown a workshop, and a
     * relative who came to correct something finds it behind the one button
     * that is always on screen. Muted colours on purpose — it is a door, not an
     * invitation.
     */
    openArchive
      ? {
          key: 'edit',
          title: 'סדנת האילן',
          note: 'לתקן ולהוסיף',
          icon: '✎',
          bg: 'var(--surface)',
          fg: 'var(--muted)',
          onSelect: () => go('/edit'),
        }
      : user && myPerson
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
                onClick={() => go(`/?focus=${encodeURIComponent(person.id)}`)}
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
          {hiddenMatches > 0 && (
            <p className={styles.noResults}>ועוד {hiddenMatches} — הקלידו כדי לצמצם</p>
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

          {/* Nothing to sign out of on an open archive. */}
          {user && !openArchive && (
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
