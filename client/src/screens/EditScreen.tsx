import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { Person } from '../../../shared/types.ts';

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

  const { data: session, isPending: sessionPending } = useSession();
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

  /** People grouped by cohort, oldest cohort first, oldest person first. */
  const groups = useMemo(() => {
    if (!tree) return [];
    const byGeneration = new Map<string, Person[]>();
    for (const person of tree.people) {
      byGeneration.set(person.generationId, [
        ...(byGeneration.get(person.generationId) ?? []),
        person,
      ]);
    }
    return tree.generations
      .filter((generation) => byGeneration.has(generation.id))
      .map((generation) => ({
        generation,
        people: (byGeneration.get(generation.id) ?? []).sort(
          (a, b) =>
            (a.birthYear ?? Number.MAX_SAFE_INTEGER) -
              (b.birthYear ?? Number.MAX_SAFE_INTEGER) ||
            a.fullName.localeCompare(b.fullName, 'he'),
        ),
      }));
  }, [tree]);

  const archived = useMemo(
    () => (allPeople ?? []).filter((person) => person.archivedAt !== null),
    [allPeople],
  );

  if (sessionPending || isPending) return <LoadingScreen label="פותחים את הסדנה…" />;
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
          <Link to="/tree" className={styles.headerLink}>
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
                    <label className={styles.field}>
                      <span className={styles.label}>{anchorLabel}</span>
                      {/*
                        A <label> wrapping a <select> derives its accessible name
                        from the label's text content — which includes every
                        option. Without an explicit aria-label a screen reader
                        announces the whole family as the field's name.
                      */}
                      <select
                        className={styles.select}
                        value={anchorA}
                        onChange={(event) => setAnchorA(event.target.value)}
                        aria-label={anchorLabel}
                      >
                        <option value="">בחרו…</option>
                        {anchorOptions.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.fullName}
                          </option>
                        ))}
                      </select>
                    </label>

                    {relationKind === 'child' && (
                      <label className={styles.field}>
                        <span className={styles.label}>הורה שני (לא חובה)</span>
                        <select
                          className={styles.select}
                          value={anchorB}
                          onChange={(event) => setAnchorB(event.target.value)}
                          aria-label="הורה שני"
                        >
                          <option value="">—</option>
                          {anchorOptions
                            .filter((candidate) => candidate.id !== anchorA)
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.fullName}
                              </option>
                            ))}
                        </select>
                      </label>
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
                  <li key={person.id}>
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
                      onClick={() => navigate(open ? '/edit/people' : `/edit/people/${person.id}`)}
                    >
                      <Avatar person={person} generation={generation} size={48} />
                      <span className={styles.cardText}>
                        <span className={styles.cardName}>{person.fullName}</span>
                        <span className={styles.cardMeta}>
                          <Years>{person.lifeSpan || 'שנים לא ידועות'}</Years>
                          {person.place && ` · ${person.place}`}
                        </span>
                      </span>
                      {person.isProvisional && (
                        <span className={styles.cardFlag}>ענף חדש</span>
                      )}
                      <span className={styles.cardChevron} aria-hidden="true">
                        {open ? '×' : '⌄'}
                      </span>
                    </button>

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
          כל מה שנוסף כאן מופיע מיד ב<Link to="/tree">אילן</Link>, ב
          <Link to="/timeline">ציר הזמן</Link> וב<Link to="/archive">ארכיון</Link>.
        </p>
      </div>
    </ScrollArea>
  );
}
