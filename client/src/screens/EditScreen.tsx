import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { Generation, Person } from '../../../shared/types.ts';

import {
  useArchivedPeople,
  useAddRelationship,
  useCreatePerson,
  useRestorePerson,
  useSession,
  useTree,
} from '../api/hooks.ts';
import { ScrollArea } from '../components/AppShell.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ErrorState, InlineError, LoadingScreen } from '../components/Feedback.tsx';
import { PersonEditor } from '../components/PersonEditor.tsx';
import { PersonPicker } from '../components/PersonPicker.tsx';
import { PortraitPicker } from '../components/PortraitPicker.tsx';
import { TimelineTab } from '../components/TimelineTab.tsx';
import { TreasuresTab } from '../components/TreasuresTab.tsx';
import { Years } from '../components/Years.tsx';
import { generationVars, restTilt } from '../lib/format.ts';
import { placeNewPerson, type NewPersonRelation } from '../lib/placement.ts';
import styles from './EditScreen.module.css';

const CURRENT_YEAR = new Date().getFullYear();

type WorkshopTab = 'people' | 'treasures' | 'timeline';

const TABS: ReadonlyArray<[WorkshopTab, string]> = [
  ['people', 'אנשים'],
  ['treasures', 'אוצרות'],
  ['timeline', 'ציר הזמן'],
];

/**
 * One row in the card file.
 *
 * Split out and memoised because the drawer holds every person in the archive:
 * without this, one keystroke in the filter re-rendered all of them — a
 * hundred and fifty avatars and their names — and a phone spent about a
 * quarter of a second per character before the letter appeared.
 */
const PersonCard = memo(function PersonCard({
  person,
  generation,
  index,
  open,
  onToggle,
}: {
  person: Person;
  generation: Generation;
  index: number;
  open: boolean;
  onToggle: (personId: string, open: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={open ? `${styles.card} ${styles.cardOpen}` : styles.card}
      style={
        {
          '--rest-tilt': open ? '0deg' : restTilt(person.id, 0.9),
          '--i': Math.min(index, 10),
        } as React.CSSProperties
      }
      aria-expanded={open}
      onClick={() => onToggle(person.id, open)}
    >
      <Avatar person={person} generation={generation} size={48} />
      <span className={styles.cardText}>
        <span className={styles.cardName}>{person.fullName}</span>
        <span className={styles.cardMeta}>
          <Years>{person.lifeSpan || 'שנים לא ידועות'}</Years>
          {person.place && ` · ${person.place}`}
        </span>
      </span>
      {person.isProvisional && <span className={styles.cardFlag}>ענף חדש</span>}
      <span className={styles.cardChevron} aria-hidden="true">
        {open ? '×' : '⌄'}
      </span>
    </button>
  );
});

type RelationKind = 'spouse' | 'child' | 'parent' | 'none';

const RELATION_LABELS: ReadonlyArray<[RelationKind, string]> = [
  ['child', 'ילד/ה של…'],
  ['spouse', 'בן/בת זוג של…'],
  ['parent', 'הורה של…'],
  ['none', 'בלי קשר בינתיים'],
];

/**
 * The editing workshop.
 *
 * Presented as the card file the rest of the app borrows from: a drawer of
 * records, each of which unfolds into its own editor. Adding a relative asks
 * how they are related *before* creating them, which is both how people
 * actually think about it and what lets the new node be placed beside their
 * partner or under their parents instead of at the next free slot.
 */
export function EditScreen(): React.JSX.Element {
  const { tab: tabParam, id: openId } = useParams<{ tab?: string; id?: string }>();
  const navigate = useNavigate();

  // Everything is edited from here, so the screen is split by what you are
  // editing rather than by where the data happens to live.
  const tab: WorkshopTab =
    tabParam === 'treasures' || tabParam === 'timeline' ? tabParam : 'people';

  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
    refetch: refetchSession,
  } = useSession();
  const { data: tree, isPending, error, refetch } = useTree();

  const user = session?.user ?? null;
  const isSteward = user?.role === 'steward';

  const { data: allPeople } = useArchivedPeople(Boolean(isSteward));
  const restorePerson = useRestorePerson();
  const createPerson = useCreatePerson();
  const addRelationship = useAddRelationship();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBirth, setNewBirth] = useState('');
  const [newDeath, setNewDeath] = useState('');
  const [newPlace, setNewPlace] = useState('');
  const [newPortrait, setNewPortrait] = useState<string | null>(null);
  const [relationKind, setRelationKind] = useState<RelationKind>('child');
  const [anchorA, setAnchorA] = useState('');
  const [anchorB, setAnchorB] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState('');

  /** Stable, so a memoised card is not invalidated by a new closure each render. */
  const openCard = useCallback(
    (personId: string, open: boolean) =>
      navigate(open ? '/edit/people' : `/edit/people/${personId}`),
    [navigate],
  );
  /**
   * The field is driven by `filter`, the list by this.
   *
   * Re-filtering a large card file is the expensive half of a keystroke, and
   * doing it in the same commit as the character means the character waits for
   * it. Deferred, the letter lands immediately and the list catches up a beat
   * later — which is the right order of priority when someone is typing a name.
   */
  const deferredFilter = useDeferredValue(filter);

  /**
   * Landing on /edit/people/:id — from the lens's עריכה link, or any deep
   * link — must put the opened card on screen, not the top of the drawer.
   * Keyed on the tree as well because on a cold arrival the cards do not
   * exist yet when the id does; the guard stops the tree's refetches (every
   * save invalidates it) from yanking the scroll back afterwards.
   */
  const openCardRef = useRef<HTMLLIElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!openId) {
      scrolledTo.current = null;
      return;
    }
    if (!tree || scrolledTo.current === openId) return;
    scrolledTo.current = openId;

    // A beat after render, so the editor panel has unfolded and has a height.
    const timer = window.setTimeout(() => {
      openCardRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [openId, tree]);

  /**
   * People grouped by cohort, oldest cohort first, oldest person first —
   * narrowed to the filter, if one is typed.
   *
   * The card file is the only way into an editor, so on a family of any size
   * "open Miriam's card" meant scrolling past everyone born before her. The
   * filter searches the same three fields as the rest of the app, and always
   * keeps the card that is currently open: typing must not pull the record you
   * are editing out from under you.
   */
  const matchedPeople = useMemo(() => {
    if (!tree) return [];
    const needle = deferredFilter.trim().toLowerCase().replace(/[׳״'"]/g, '');
    const matches = (person: Person) => {
      if (!needle) return true;
      if (person.id === openId) return true;
      const haystack = `${person.fullName} ${person.place} ${person.branch ?? ''}`
        .toLowerCase()
        .replace(/[׳״'"]/g, '');
      return haystack.includes(needle);
    };

    const byGeneration = new Map<string, Person[]>();
    for (const person of tree.people) {
      if (!matches(person)) continue;
      byGeneration.set(person.generationId, [
        ...(byGeneration.get(person.generationId) ?? []),
        person,
      ]);
    }
    // Flat and in reading order first, so the drawer can be cut to a page
    // without a cohort losing its place in the sequence.
    return tree.generations
      .filter((generation) => byGeneration.has(generation.id))
      .flatMap((generation) =>
        (byGeneration.get(generation.id) ?? [])
          .sort(
            (a, b) =>
              (a.birthYear ?? Number.MAX_SAFE_INTEGER) -
                (b.birthYear ?? Number.MAX_SAFE_INTEGER) ||
              a.fullName.localeCompare(b.fullName, 'he'),
          )
          .map((person) => ({ person, generation })),
      );
  }, [deferredFilter, openId, tree]);

  /** How many people the filter is currently showing, for the empty state. */
  const shownCount = matchedPeople.length;

  /** The page currently on screen, back in cohort sections for the headings. */
  const groups = useMemo(() => {
    const sections: Array<{ generation: Generation; people: Person[] }> = [];
    for (const { person, generation } of matchedPeople) {
      const last = sections[sections.length - 1];
      if (last && last.generation.id === generation.id) last.people.push(person);
      else sections.push({ generation, people: [person] });
    }
    return sections;
  }, [matchedPeople]);

  const archived = useMemo(
    () => (allPeople ?? []).filter((person) => person.archivedAt !== null),
    [allPeople],
  );

  if (sessionPending || isPending) return <LoadingScreen label="פותחים את הסדנה…" />;

  // A session that could not be *fetched* is not the same as no session. Both
  // leave `user` empty, but showing the join gate to someone the server never
  // answered about points them at a door that will not open either — and hides
  // the fault. Say what failed instead; the trace line names the request.
  if (sessionError) {
    return <ErrorState error={sessionError} onRetry={() => void refetchSession()} />;
  }
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  if (!user) {
    return (
      <ScrollArea>
        <div className={styles.gate}>
          <h1 className={styles.gateTitle}>הסדנה פתוחה לבני המשפחה</h1>
          <p className={styles.gateNote}>
            הצטרפו בשם שלכם, וכל מה שתוסיפו יישא את החתימה שלכם.
          </p>
          <Link to="/login" className={styles.gateAction}>
            להצטרפות ←
          </Link>
        </div>
      </ScrollArea>
    );
  }

  if (!tree) return <ErrorState error={new Error('missing tree')} />;

  const anchorNeeded = relationKind !== 'none';
  const canCreate =
    newName.trim().length > 0 &&
    (!anchorNeeded || anchorA !== '') &&
    !createPerson.isPending;

  function resetAddForm(): void {
    setNewName('');
    setNewBirth('');
    setNewDeath('');
    setNewPlace('');
    setNewPortrait(null);
    setRelationKind('child');
    setAnchorA('');
    setAnchorB('');
  }

  function relationFor(): NewPersonRelation {
    if (relationKind === 'spouse' && anchorA) return { kind: 'spouse', personId: anchorA };
    if (relationKind === 'parent' && anchorA) return { kind: 'parent', childId: anchorA };
    if (relationKind === 'child' && anchorA) {
      return { kind: 'child', parentIds: anchorB ? [anchorA, anchorB] : [anchorA] };
    }
    return { kind: 'none' };
  }

  async function submitNewPerson(): Promise<void> {
    if (!canCreate || !tree) return;
    setNotice(null);

    const relation = relationFor();
    const placement = placeNewPerson(relation, tree.people, tree.relationships);
    const birthYear = newBirth.trim() ? Number(newBirth) : null;
    const deathYear = newDeath.trim() ? Number(newDeath) : null;

    try {
      const created = await createPerson.mutateAsync({
        fullName: newName.trim(),
        birthYear,
        deathYear,
        place: newPlace.trim(),
        portraitMediaId: newPortrait,
        ...(placement && { x: placement.x, y: placement.y }),
      });

      // Links are created after the person exists. A failure here leaves a real
      // record that is simply not yet connected, which the editor can fix — far
      // better than losing the person because one link went wrong.
      const links: Array<{ personId: string; relatedPersonId: string; type: 'spouse' | 'parent' }> =
        relation.kind === 'spouse'
          ? [{ personId: created.id, relatedPersonId: relation.personId, type: 'spouse' }]
          : relation.kind === 'parent'
            ? [{ personId: created.id, relatedPersonId: relation.childId, type: 'parent' }]
            : relation.kind === 'child'
              ? relation.parentIds.map((parentId) => ({
                  personId: parentId,
                  relatedPersonId: created.id,
                  type: 'parent' as const,
                }))
              : [];

      for (const link of links) {
        await addRelationship.mutateAsync(link);
      }

      resetAddForm();
      setAdding(false);
      navigate(`/edit/people/${created.id}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'לא הצלחנו להוסיף. נסו שוב.');
    }
  }

  const anchorOptions = tree.people;
  const anchorLabel =
    relationKind === 'child' ? 'הורה' : relationKind === 'spouse' ? 'בן/בת הזוג' : 'הילד/ה';

  return (
    <ScrollArea>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>סדנת האילן</h1>
          <p className={styles.subtitle}>הכול נערך מכאן — אנשים, אוצרות וציר הזמן</p>
          <Link to="/" className={styles.headerLink}>
            לצפייה באילן ←
          </Link>
        </header>

        <nav className={styles.tabs} aria-label="מה עורכים">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              aria-current={tab === value ? 'page' : undefined}
              onClick={() => navigate(`/edit/${value}`)}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'treasures' && <TreasuresTab user={user} />}
        {tab === 'timeline' && <TimelineTab user={user} people={tree.people} />}

        {tab === 'people' && (
          <>
        {/* ------------------------------------------------------ add person */}

        {adding ? (
          <section className={styles.addPanel}>
            <h2 className={styles.addTitle}>כרטיס חדש</h2>

            <div className={styles.addBody}>
              <PortraitPicker
                mediaId={newPortrait}
                onChange={setNewPortrait}
                label="תצלום (אפשר גם אחר כך)"
                onError={setNotice}
              />

              <div className={styles.addFields}>
                <label className={styles.field}>
                  <span className={styles.label}>שם מלא</span>
                  <input
                    className={styles.input}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="למשל: מרים אלוני (ליבוביץ׳)"
                    autoFocus
                    maxLength={120}
                  />
                </label>

                <div className={styles.pair}>
                  <label className={styles.field}>
                    <span className={styles.label}>שנת לידה</span>
                    <input
                      className={styles.input}
                      value={newBirth}
                      onChange={(event) =>
                        setNewBirth(event.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      inputMode="numeric"
                      placeholder={`למשל ${CURRENT_YEAR - 40}`}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>שנת פטירה</span>
                    <input
                      className={styles.input}
                      value={newDeath}
                      onChange={(event) =>
                        setNewDeath(event.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      inputMode="numeric"
                      placeholder="—"
                    />
                  </label>
                </div>

                <label className={styles.field}>
                  <span className={styles.label}>מקום</span>
                  <input
                    className={styles.input}
                    value={newPlace}
                    onChange={(event) => setNewPlace(event.target.value)}
                    placeholder="למשל: חיפה"
                    maxLength={120}
                  />
                </label>

                <div className={styles.field}>
                  <span className={styles.label}>איך הם מתחברים לאילן?</span>
                  <div className={styles.chips} role="group" aria-label="סוג הקשר">
                    {RELATION_LABELS.map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className={
                          relationKind === kind ? `${styles.chip} ${styles.chipActive}` : styles.chip
                        }
                        aria-pressed={relationKind === kind}
                        onClick={() => {
                          setRelationKind(kind);
                          setAnchorA('');
                          setAnchorB('');
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {anchorNeeded && (
                  <div className={styles.pair}>
                    <div className={styles.field}>
                      <span className={styles.label}>{anchorLabel}</span>
                      <PersonPicker
                        people={anchorOptions}
                        generations={tree.generations}
                        value={anchorA}
                        onChange={(id) => {
                          setAnchorA(id);
                          if (id && id === anchorB) setAnchorB('');
                        }}
                        label={anchorLabel}
                      />
                    </div>

                    {relationKind === 'child' && (
                      <div className={styles.field}>
                        <span className={styles.label}>הורה שני (לא חובה)</span>
                        <PersonPicker
                          people={anchorOptions.filter((candidate) => candidate.id !== anchorA)}
                          generations={tree.generations}
                          value={anchorB}
                          onChange={setAnchorB}
                          label="הורה שני"
                        />
                      </div>
                    )}
                  </div>
                )}

                {notice && <InlineError>{notice}</InlineError>}

                <div className={styles.addActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => {
                      resetAddForm();
                      setAdding(false);
                      setNotice(null);
                    }}
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!canCreate}
                    onClick={() => void submitNewPerson()}
                  >
                    {createPerson.isPending ? 'מוסיפים…' : 'הוסיפו לאילן ←'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <button type="button" className={styles.addSlot} onClick={() => setAdding(true)}>
            <span className={styles.addPlus} aria-hidden="true">
              +
            </span>
            <span>
              <span className={styles.addSlotTitle}>הוסיפו בן משפחה</span>
              <span className={styles.addSlotNote}>שם, תצלום, ואיך הם מתחברים לאילן</span>
            </span>
          </button>
        )}

        {/* ------------------------------------------------------- card file */}

        {tree.people.length > 8 && (
          <div className={styles.filterRow}>
            <span className={styles.filterField}>
              <input
                className={styles.filterInput}
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="חפשו בכרטיסייה — שם, מקום או ענף…"
                aria-label="חיפוש בכרטיסייה"
              />
              {/* One control, two states: the glass while the field is empty,
                  a way out of the filter once something is typed. The browser's
                  own clear button is hidden in CSS so the two do not collide. */}
              {filter ? (
                <button
                  type="button"
                  className={styles.filterClear}
                  onClick={() => setFilter('')}
                  aria-label="ניקוי החיפוש"
                >
                  ×
                </button>
              ) : (
                <span className={styles.filterIcon} aria-hidden="true">
                  ⌕
                </span>
              )}
            </span>
            {filter.trim() && (
              <span className={styles.filterCount}>
                {shownCount} מתוך {tree.people.length}
              </span>
            )}
          </div>
        )}

        {filter.trim() && shownCount === 0 && (
          <p className={styles.filterEmpty}>
            לא מצאנו אף אחד בשם הזה. נסו שם אחר, מקום או ענף.
          </p>
        )}

        {groups.map(({ generation, people }) => (
          <section key={generation.id} className={styles.group} style={generationVars(generation)}>
            <h2 className={styles.groupTitle}>
              <span className={styles.groupDot} aria-hidden="true" />
              {generation.name}
              <Years className={styles.groupRange}>{generation.rangeLabel}</Years>
            </h2>

            <ul className={styles.cards}>
              {people.map((person, index) => {
                const open = openId === person.id;
                return (
                  <li key={person.id} ref={open ? openCardRef : null}>
                    <PersonCard
                      person={person}
                      generation={generation}
                      index={index}
                      open={open}
                      onToggle={openCard}
                    />

                    {open && (
                      <PersonEditor
                        personId={person.id}
                        people={tree.people}
                        relationships={tree.relationships}
                        generations={tree.generations}
                        user={user}
                        onClose={() => navigate('/edit/people')}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* -------------------------------------------------- removed drawer */}

        {isSteward && archived.length > 0 && (
          <section className={styles.drawer}>
            <button
              type="button"
              className={styles.drawerToggle}
              aria-expanded={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              רשומות שהוסרו ({archived.length}){showArchived ? ' ⌃' : ' ⌄'}
            </button>

            {showArchived && (
              <ul className={styles.drawerList}>
                {archived.map((person) => {
                  const generation = tree.generations.find((g) => g.id === person.generationId);
                  return (
                    <li key={person.id} className={styles.drawerItem}>
                      <Avatar person={person} generation={generation} size={36} />
                      <span className={styles.drawerName}>{person.fullName}</span>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={restorePerson.isPending}
                        onClick={() => restorePerson.mutate(person.id)}
                      >
                        החזירו לאילן
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

          </>
        )}

        <p className={styles.footNote}>
          כל מה שנוסף כאן מופיע מיד ב<Link to="/">אילן</Link>, ב
          <Link to="/timeline">ציר הזמן</Link> וב<Link to="/archive">ארכיון</Link>.
        </p>
      </div>
    </ScrollArea>
  );
}
