import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  Generation,
  Person,
  Relationship,
  RelationshipType,
  SessionUser,
  UpdatePersonRequest,
} from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import {
  useAddMilestone,
  useAddRelationship,
  useArchive,
  useArchivePerson,
  usePerson,
  useRemoveMilestone,
  useRemoveRelationship,
  useUpdateMilestone,
  useUpdatePerson,
} from '../api/hooks.ts';
import { generationVars, givenName, kindColours } from '../lib/format.ts';
import { NUDGE } from '../lib/placement.ts';
import { useUi } from '../state/ui.tsx';
import { InlineError, LoadingDots } from './Feedback.tsx';
import { PortraitPicker } from './PortraitPicker.tsx';
import styles from './PersonEditor.module.css';

const CURRENT_YEAR = new Date().getFullYear();

interface Draft {
  fullName: string;
  initial: string;
  lifeSpan: string;
  place: string;
  branch: string;
  story: string;
  birthYear: string;
  deathYear: string;
  audioLabel: string;
  portraitMediaId: string | null;
  audioMediaId: string | null;
}

function toDraft(person: Person): Draft {
  return {
    fullName: person.fullName,
    initial: person.initial,
    lifeSpan: person.lifeSpan,
    place: person.place,
    branch: person.branch ?? '',
    story: person.story,
    birthYear: person.birthYear == null ? '' : String(person.birthYear),
    deathYear: person.deathYear == null ? '' : String(person.deathYear),
    audioLabel: person.audioLabel ?? '',
    portraitMediaId: person.portraitMediaId,
    audioMediaId: person.audioMediaId,
  };
}

/** '' means "not recorded", which is a different statement from a wrong year. */
function parseYear(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const year = Number(trimmed);
  return Number.isInteger(year) && year >= 1500 && year <= CURRENT_YEAR + 1 ? year : null;
}

function yearError(value: string): string | null {
  if (!value.trim()) return null;
  return parseYear(value) === null ? `שנה בין 1500 ל־${CURRENT_YEAR + 1}` : null;
}

interface PersonEditorProps {
  personId: string;
  people: Person[];
  relationships: Relationship[];
  generations: Generation[];
  user: SessionUser;
  onClose: () => void;
}

export function PersonEditor({
  personId,
  people,
  relationships,
  generations,
  user,
  onClose,
}: PersonEditorProps): React.JSX.Element {
  const { data: person, isPending, error } = usePerson(personId);

  const update = useUpdatePerson(personId);
  const addMilestone = useAddMilestone(personId);
  const updateMilestone = useUpdateMilestone(personId);
  const removeMilestone = useRemoveMilestone(personId);
  const addRelationship = useAddRelationship();
  const removeRelationship = useRemoveRelationship();
  const archivePerson = useArchivePerson();
  const { data: treasures } = useArchive(undefined, personId);
  const { openAddTreasure, openEditTreasure } = useUi();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState({ yearLabel: '', title: '', body: '' });
  const [composingMilestone, setComposingMilestone] = useState(false);

  const [linkType, setLinkType] = useState<RelationshipType | 'child'>('spouse');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  /**
   * The record this draft was seeded from, so a refetch can tell "the same
   * person again" from "a different person".
   */
  const seed = useRef<{ id: string; snapshot: string } | null>(null);

  /**
   * Seed the draft from the record — but do *not* re-seed it on every refetch.
   *
   * Removing a memory invalidates this person's query, and the fields above the
   * memory list are a draft, not the saved record. Re-seeding on the response
   * therefore threw away everything typed and not yet saved: write two lines of
   * story, remove a station, and the story was back to what the server had.
   *
   * So the server's copy is adopted in the two cases where it is certainly
   * right — a different person, or nothing typed since the last seed — and the
   * draft is left alone whenever there is unsaved work in it.
   */
  useEffect(() => {
    if (!person) return;
    const fresh = toDraft(person);
    const previousSeed = seed.current;
    const samePerson = previousSeed?.id === person.id;
    seed.current = { id: person.id, snapshot: JSON.stringify(fresh) };

    setDraft((previous) => {
      if (!previous || !samePerson) return fresh;
      return JSON.stringify(previous) === previousSeed?.snapshot ? fresh : previous;
    });

    // These belong to the person on screen, not to the response, so they are
    // cleared when the editor changes hands and left alone otherwise. A refetch
    // used to close a half-written memory the same way it wiped the story.
    if (!samePerson) {
      setNotice(null);
      setSaved(false);
      setConfirmingArchive(false);
      setComposingMilestone(false);
      setEditingMilestoneId(null);
    }
  }, [person]);

  const generation = generations.find((g) => g.id === person?.generationId);
  const canEdit = user.role === 'steward' || user.personId === personId;
  const isSteward = user.role === 'steward';

  const family = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p]));
    const spouses: Array<{ rel: Relationship; person: Person }> = [];
    const parents: Array<{ rel: Relationship; person: Person }> = [];
    const children: Array<{ rel: Relationship; person: Person }> = [];

    for (const rel of relationships) {
      if (rel.type === 'spouse') {
        const otherId =
          rel.personId === personId
            ? rel.relatedPersonId
            : rel.relatedPersonId === personId
              ? rel.personId
              : null;
        const other = otherId ? byId.get(otherId) : undefined;
        if (other) spouses.push({ rel, person: other });
        continue;
      }
      if (rel.relatedPersonId === personId) {
        const parent = byId.get(rel.personId);
        if (parent) parents.push({ rel, person: parent });
      } else if (rel.personId === personId) {
        const child = byId.get(rel.relatedPersonId);
        if (child) children.push({ rel, person: child });
      }
    }
    return { spouses, parents, children };
  }, [people, personId, relationships]);

  if (isPending || !draft || !person) {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>
          <LoadingDots />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.panel}>
        <InlineError>לא הצלחנו לטעון את הכרטיס.</InlineError>
      </div>
    );
  }

  // Narrowed aliases: the callbacks below could run after a re-render, so
  // TypeScript will not carry the null checks above into their bodies.
  const current: Draft = draft;
  const record = person;

  const birthError = yearError(draft.birthYear);
  const deathError = yearError(draft.deathYear);
  const original = toDraft(person);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const canSave = canEdit && dirty && !birthError && !deathError && draft.fullName.trim().length > 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
    setSaved(false);
  };

  function save(): void {
    if (!canSave) return;
    const patch: UpdatePersonRequest = {
      fullName: current.fullName.trim(),
      initial: current.initial.trim() || undefined,
      lifeSpan: current.lifeSpan.trim(),
      place: current.place.trim(),
      branch: current.branch.trim() || null,
      story: current.story.trim(),
      birthYear: parseYear(current.birthYear),
      deathYear: parseYear(current.deathYear),
      audioLabel: current.audioLabel.trim() || null,
      portraitMediaId: current.portraitMediaId,
      audioMediaId: current.audioMediaId,
    };
    setNotice(null);
    update.mutate(patch, {
      onSuccess: () => setSaved(true),
      onError: (cause) => setNotice(cause.message),
    });
  }

  /** Everyone this person could still be linked to, minus existing links. */
  const linkCandidates = people.filter((candidate) => {
    if (candidate.id === personId) return false;
    if (linkType === 'spouse') return !family.spouses.some((s) => s.person.id === candidate.id);
    if (linkType === 'parent') return !family.parents.some((p) => p.person.id === candidate.id);
    return !family.children.some((c) => c.person.id === candidate.id);
  });

  function addLink(): void {
    if (!linkTargetId) return;
    // 'parent' in the API is directional: personId parents relatedPersonId.
    const body =
      linkType === 'spouse'
        ? { personId, relatedPersonId: linkTargetId, type: 'spouse' as const }
        : linkType === 'parent'
          ? { personId: linkTargetId, relatedPersonId: personId, type: 'parent' as const }
          : { personId, relatedPersonId: linkTargetId, type: 'parent' as const };

    setNotice(null);
    addRelationship.mutate(body, {
      onSuccess: () => setLinkTargetId(''),
      onError: (cause) => setNotice(cause.message),
    });
  }

  function nudge(dx: number, dy: number): void {
    update.mutate(
      { x: record.x + dx, y: record.y + dy },
      { onError: (cause) => setNotice(cause.message) },
    );
  }

  const linkRow = (
    entry: { rel: Relationship; person: Person },
    kind: string,
  ): React.JSX.Element => (
    <li key={entry.rel.id} className={styles.linkItem}>
      <span className={styles.linkKind}>{kind}</span>
      <span className={styles.linkName}>{entry.person.fullName}</span>
      {isSteward && (
        <button
          type="button"
          className={styles.linkRemove}
          onClick={() => removeRelationship.mutate(entry.rel.id)}
          aria-label={`הסרת הקשר עם ${givenName(entry.person.fullName)}`}
        >
          ×
        </button>
      )}
    </li>
  );

  return (
    <div className={styles.panel} style={generationVars(generation)}>
      {!canEdit && (
        <p className={styles.readOnly}>
          הכרטיס הזה בקריאה בלבד — אפשר לערוך רק את הכרטיס שלכם. לשאר הרשומות צריך הרשאת
          מנהל ארכיון.
        </p>
      )}

      {/* ---------------------------------------------------------- identity */}

      <div className={styles.identityRow}>
        <PortraitPicker
          mediaId={draft.portraitMediaId}
          onChange={(mediaId) => set('portraitMediaId', mediaId)}
          label="תצלום דיוקן"
          onError={setNotice}
        />

        <div className={styles.identityFields}>
          <label className={styles.field}>
            <span className={styles.label}>שם מלא</span>
            <input
              className={styles.input}
              value={draft.fullName}
              onChange={(event) => set('fullName', event.target.value)}
              disabled={!canEdit}
              maxLength={120}
            />
          </label>

          <div className={styles.pair}>
            <label className={styles.field}>
              <span className={styles.label}>שנת לידה</span>
              <input
                className={birthError ? `${styles.input} ${styles.inputBad}` : styles.input}
                value={draft.birthYear}
                onChange={(event) =>
                  set('birthYear', event.target.value.replace(/\D/g, '').slice(0, 4))
                }
                inputMode="numeric"
                placeholder="לא ידוע"
                disabled={!canEdit}
              />
              {birthError && <span className={styles.fieldError}>{birthError}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>שנת פטירה</span>
              <input
                className={deathError ? `${styles.input} ${styles.inputBad}` : styles.input}
                value={draft.deathYear}
                onChange={(event) =>
                  set('deathYear', event.target.value.replace(/\D/g, '').slice(0, 4))
                }
                inputMode="numeric"
                placeholder="—"
                disabled={!canEdit}
              />
              {deathError && <span className={styles.fieldError}>{deathError}</span>}
            </label>
          </div>

          <div className={styles.pair}>
            <label className={styles.field}>
              <span className={styles.label}>מקום</span>
              <input
                className={styles.input}
                value={draft.place}
                onChange={(event) => set('place', event.target.value)}
                placeholder="למשל: ברלין → חיפה"
                disabled={!canEdit}
                maxLength={120}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>ענף</span>
              <input
                className={styles.input}
                value={draft.branch}
                onChange={(event) => set('branch', event.target.value)}
                placeholder="למשל: ענף הירש"
                disabled={!canEdit}
                maxLength={120}
              />
            </label>
          </div>

          <div className={styles.pair}>
            <label className={styles.field}>
              <span className={styles.label}>שנים כפי שיוצג</span>
              <input
                className={styles.input}
                value={draft.lifeSpan}
                dir="auto"
                onChange={(event) => set('lifeSpan', event.target.value)}
                placeholder="למשל: 1928–2015"
                disabled={!canEdit}
                maxLength={60}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>אות בעיגול</span>
              <input
                className={styles.input}
                value={draft.initial}
                onChange={(event) => set('initial', event.target.value.slice(0, 2))}
                disabled={!canEdit}
                maxLength={2}
              />
            </label>
          </div>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>הסיפור</span>
        <textarea
          className={styles.textarea}
          value={draft.story}
          onChange={(event) => set('story', event.target.value)}
          placeholder="כמה שורות על מי שהם היו…"
          disabled={!canEdit}
          maxLength={4000}
        />
      </label>

      {notice && <InlineError>{notice}</InlineError>}

      <div className={styles.saveRow}>
        <span className={styles.saveState}>
          {update.isPending
            ? 'שומרים…'
            : saved && !dirty
              ? 'נשמר ✓'
              : dirty
                ? 'יש שינויים שלא נשמרו'
                : ''}
        </span>
        <button type="button" className={styles.ghost} onClick={onClose}>
          סגירה
        </button>
        <button type="button" className={styles.primary} onClick={save} disabled={!canSave}>
          שמרו שינויים
        </button>
      </div>

      {/* -------------------------------------------------------- milestones */}

      <h4 className={styles.sectionTitle}>תחנות בחיים</h4>

      <ul className={styles.milestoneList}>
        {person.milestones.map((milestone, index) =>
          editingMilestoneId === milestone.id ? (
            <li key={milestone.id} className={styles.milestoneEdit}>
              <div className={styles.pair}>
                <input
                  className={styles.input}
                  value={milestoneDraft.yearLabel}
                  dir="auto"
                  onChange={(event) =>
                    setMilestoneDraft((d) => ({ ...d, yearLabel: event.target.value }))
                  }
                  aria-label="שנה"
                  maxLength={40}
                />
                <input
                  className={styles.input}
                  value={milestoneDraft.title}
                  onChange={(event) =>
                    setMilestoneDraft((d) => ({ ...d, title: event.target.value }))
                  }
                  aria-label="כותרת"
                  maxLength={120}
                />
              </div>
              <textarea
                className={styles.textarea}
                value={milestoneDraft.body}
                onChange={(event) =>
                  setMilestoneDraft((d) => ({ ...d, body: event.target.value }))
                }
                aria-label="תיאור"
                maxLength={2000}
              />
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setEditingMilestoneId(null)}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={
                    !milestoneDraft.title.trim() ||
                    !milestoneDraft.yearLabel.trim() ||
                    updateMilestone.isPending
                  }
                  onClick={() =>
                    updateMilestone.mutate(
                      {
                        id: milestone.id,
                        patch: {
                          yearLabel: milestoneDraft.yearLabel.trim(),
                          title: milestoneDraft.title.trim(),
                          body: milestoneDraft.body.trim(),
                        },
                      },
                      {
                        onSuccess: () => setEditingMilestoneId(null),
                        onError: (cause) => setNotice(cause.message),
                      },
                    )
                  }
                >
                  עדכנו
                </button>
              </div>
            </li>
          ) : (
            <li
              key={milestone.id}
              className={styles.milestoneItem}
              style={{ '--i': index } as React.CSSProperties}
            >
              <span className={styles.milestoneYear} dir="auto">
                {milestone.yearLabel}
              </span>
              <span className={styles.milestoneText}>
                <span className={styles.milestoneTitle}>{milestone.title}</span>
                {milestone.body && (
                  <span className={styles.milestoneBody}>{milestone.body}</span>
                )}
              </span>
              <span className={styles.milestoneTools}>
                <button
                  type="button"
                  className={styles.tool}
                  onClick={() => {
                    setEditingMilestoneId(milestone.id);
                    setMilestoneDraft({
                      yearLabel: milestone.yearLabel,
                      title: milestone.title,
                      body: milestone.body,
                    });
                  }}
                >
                  עריכה
                </button>
                <button
                  type="button"
                  className={styles.toolDanger}
                  onClick={() =>
                    removeMilestone.mutate(milestone.id, {
                      onError: (cause) => setNotice(cause.message),
                    })
                  }
                >
                  הסרה
                </button>
              </span>
            </li>
          ),
        )}
      </ul>

      {composingMilestone ? (
        <div className={styles.milestoneEdit}>
          <div className={styles.pair}>
            <input
              className={styles.input}
              value={milestoneDraft.yearLabel}
              dir="auto"
              onChange={(event) =>
                setMilestoneDraft((d) => ({ ...d, yearLabel: event.target.value }))
              }
              placeholder="שנה — בערך זה בסדר"
              aria-label="שנה"
              maxLength={40}
            />
            <input
              className={styles.input}
              value={milestoneDraft.title}
              onChange={(event) =>
                setMilestoneDraft((d) => ({ ...d, title: event.target.value }))
              }
              placeholder="כותרת"
              aria-label="כותרת"
              maxLength={120}
            />
          </div>
          <textarea
            className={styles.textarea}
            value={milestoneDraft.body}
            onChange={(event) => setMilestoneDraft((d) => ({ ...d, body: event.target.value }))}
            placeholder="מה קרה שם…"
            aria-label="תיאור"
            maxLength={2000}
          />
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setComposingMilestone(false)}
            >
              ביטול
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={
                !milestoneDraft.title.trim() ||
                !milestoneDraft.yearLabel.trim() ||
                addMilestone.isPending
              }
              onClick={() =>
                addMilestone.mutate(
                  {
                    yearLabel: milestoneDraft.yearLabel.trim(),
                    title: milestoneDraft.title.trim(),
                    body: milestoneDraft.body.trim(),
                  },
                  {
                    onSuccess: () => {
                      setComposingMilestone(false);
                      setMilestoneDraft({ yearLabel: '', title: '', body: '' });
                    },
                    onError: (cause) => setNotice(cause.message),
                  },
                )
              }
            >
              הוסיפו תחנה
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.addSlot}
          onClick={() => {
            setMilestoneDraft({ yearLabel: '', title: '', body: '' });
            setComposingMilestone(true);
          }}
        >
          <span className={styles.addPlus} aria-hidden="true">
            +
          </span>
          תחנה חדשה
        </button>
      )}

      {/* --------------------------------------------------------- treasures */}

      <h4 className={styles.sectionTitle}>אוצרות של {givenName(record.fullName)}</h4>

      <ul className={styles.treasureList}>
        {(treasures ?? []).map((item, index) => {
          const tone = kindColours(item.kind);
          const src = mediaUrl(item.mediaId);
          return (
            <li key={item.id} style={{ '--i': index } as React.CSSProperties}>
              <button
                type="button"
                className={styles.treasure}
                style={
                  { '--tone-wash': tone.wash, '--tone-text': tone.text } as React.CSSProperties
                }
                onClick={() => openEditTreasure(item)}
              >
                <span className={styles.treasureThumb}>
                  {src && item.kind !== 'קול' ? (
                    <img src={src} alt="" loading="lazy" />
                  ) : (
                    item.kind.charAt(0)
                  )}
                </span>
                <span className={styles.treasureText}>
                  <span className={styles.treasureTitle}>{item.title}</span>
                  <span className={styles.treasureMeta}>
                    {item.kind} · {item.yearLabel}
                  </span>
                </span>
                <span className={styles.treasureEdit} aria-hidden="true">
                  ✎
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className={styles.addSlot}
        onClick={() =>
          openAddTreasure({ subject: givenName(record.fullName), personId: record.id })
        }
      >
        <span className={styles.addPlus} aria-hidden="true">
          +
        </span>
        תצלום, מכתב או הקלטה של {givenName(record.fullName)}
      </button>

      {/* ------------------------------------------------------------ family */}

      <h4 className={styles.sectionTitle}>קשרי משפחה</h4>

      <ul className={styles.linkList}>
        {family.spouses.map((entry) => linkRow(entry, 'בן/בת זוג'))}
        {family.parents.map((entry) => linkRow(entry, 'הורה'))}
        {family.children.map((entry) => linkRow(entry, 'ילד/ה'))}
        {family.spouses.length + family.parents.length + family.children.length === 0 && (
          <li className={styles.linkEmpty}>עוד לא נקשרו קשרים — הוסיפו אחד למטה.</li>
        )}
      </ul>

      {canEdit && (
        <div className={styles.linkForm}>
          <div className={styles.chips} role="group" aria-label="סוג הקשר">
            {(
              [
                ['spouse', 'בן/בת זוג'],
                ['parent', 'הורה שלהם'],
                ['child', 'ילד/ה שלהם'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={linkType === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                aria-pressed={linkType === value}
                onClick={() => {
                  setLinkType(value);
                  setLinkTargetId('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.linkRow}>
            <select
              className={styles.select}
              value={linkTargetId}
              onChange={(event) => setLinkTargetId(event.target.value)}
              aria-label="בחירת בן משפחה"
            >
              <option value="">בחרו בן משפחה…</option>
              {linkCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.primary}
              disabled={!linkTargetId || addRelationship.isPending}
              onClick={addLink}
            >
              {addRelationship.isPending ? 'מקשרים…' : 'קשרו'}
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- position */}

      {canEdit && (
        <>
          <h4 className={styles.sectionTitle}>מקום באילן</h4>
          <div className={styles.positionRow}>
            <div className={styles.pad}>
              <button type="button" className={styles.padUp} onClick={() => nudge(0, -NUDGE.y)} aria-label="הזיזו למעלה">↑</button>
              <button type="button" className={styles.padStart} onClick={() => nudge(NUDGE.x, 0)} aria-label="הזיזו ימינה">→</button>
              <button type="button" className={styles.padEnd} onClick={() => nudge(-NUDGE.x, 0)} aria-label="הזיזו שמאלה">←</button>
              <button type="button" className={styles.padDown} onClick={() => nudge(0, NUDGE.y)} aria-label="הזיזו למטה">↓</button>
            </div>
            <p className={styles.positionNote}>
              הקווים בין האנשים נגזרים מהקשרים, לא מהמקום — ההזזה משפיעה רק על הסידור על
              הלוח. הכי נוח לגרור ישירות:{' '}
              <Link to={`/?edit=1&focus=${encodeURIComponent(personId)}`}>
                גררו אותם באילן ←
              </Link>
            </p>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------- archive */}

      {isSteward && (
        <div className={styles.dangerZone}>
          {confirmingArchive ? (
            <>
              <p className={styles.dangerNote}>
                הרשומה תוסר מהאילן אבל לא תימחק — תמיד אפשר להחזיר אותה מהמגירה למטה.
              </p>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => setConfirmingArchive(false)}
                >
                  לא, בטלו
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={archivePerson.isPending}
                  onClick={() =>
                    archivePerson.mutate(personId, {
                      onSuccess: onClose,
                      onError: (cause) => setNotice(cause.message),
                    })
                  }
                >
                  כן, הסירו מהאילן
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={styles.dangerQuiet}
              onClick={() => setConfirmingArchive(true)}
            >
              הסירו את {givenName(person.fullName)} מהאילן
            </button>
          )}
        </div>
      )}
    </div>
  );
}
