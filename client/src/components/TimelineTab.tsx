import { useState } from 'react';

import type { Person, SessionUser, TimelineEvent } from '../../../shared/types.ts';

import {
  useCreateTimelineEvent,
  useRemoveTimelineEvent,
  useTimeline,
  useUpdateTimelineEvent,
} from '../api/hooks.ts';
import { givenName } from '../lib/format.ts';
import { ErrorState, InlineError, LoadingScreen } from './Feedback.tsx';
import styles from './TimelineTab.module.css';

const CURRENT_YEAR = new Date().getFullYear();

interface Draft {
  year: string;
  title: string;
  /** Everyone the event involves; empty means the whole family. */
  personIds: string[];
}

const EMPTY: Draft = { year: '', title: '', personIds: [] };

function draftFrom(event: TimelineEvent): Draft {
  return {
    year: String(event.year),
    title: event.title,
    personIds: event.personIds ?? (event.personId ? [event.personId] : []),
  };
}

function yearError(value: string): string | null {
  const year = Number(value);
  if (!/^\d{3,4}$/.test(value)) return 'צריך שנה';
  if (year < 1500 || year > CURRENT_YEAR + 1) return `בין 1500 ל־${CURRENT_YEAR + 1}`;
  return null;
}

/**
 * The family's timeline, editable in place.
 *
 * These are events about the family rather than one person's milestones, and
 * the table carries no author, so amending or removing one is steward-only.
 * Anyone may add.
 */
export function TimelineTab({
  user,
  people,
}: {
  user: SessionUser;
  people: Person[];
}): React.JSX.Element {
  const { data: events, isPending, error, refetch } = useTimeline();
  const create = useCreateTimelineEvent();
  const update = useUpdateTimelineEvent();
  const remove = useRemoveTimelineEvent();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isSteward = user.role === 'steward';

  if (isPending) return <LoadingScreen label="מסדרים את ציר הזמן…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const invalid = yearError(draft.year) ?? (draft.title.trim() ? null : 'צריך תיאור');

  const fields = (
    <>
      <div className={styles.row}>
        <input
          className={styles.yearInput}
          value={draft.year}
          onChange={(event) =>
            setDraft((d) => ({ ...d, year: event.target.value.replace(/\D/g, '').slice(0, 4) }))
          }
          placeholder="שנה"
          aria-label="שנה"
          inputMode="numeric"
        />
        <input
          className={styles.titleInput}
          value={draft.title}
          onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
          placeholder="מה קרה — למשל: החתונה על גג בהדר"
          aria-label="תיאור האירוע"
          maxLength={160}
        />
      </div>
      <div className={styles.chips} role="group" aria-label="קישור לבני משפחה">
        <button
          type="button"
          className={
            draft.personIds.length === 0 ? `${styles.chip} ${styles.chipActive}` : styles.chip
          }
          aria-pressed={draft.personIds.length === 0}
          onClick={() => setDraft((d) => ({ ...d, personIds: [] }))}
        >
          כל המשפחה
        </button>
        {people.map((person) => {
          const active = draft.personIds.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={active ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              aria-pressed={active}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  personIds: active
                    ? d.personIds.filter((id) => id !== person.id)
                    : [...d.personIds, person.id],
                }))
              }
            >
              {active && '✓ '}
              {givenName(person.fullName)}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        אירועים של המשפחה כולה — לידות, מסעות, חתונות. הם מופיעים על ציר הזמן לפי שנה.
        {!isSteward && ' אפשר להוסיף; לעריכה והסרה צריך הרשאת מנהל ארכיון.'}
      </p>

      {notice && <InlineError>{notice}</InlineError>}

      {composing ? (
        <div className={styles.editor}>
          {fields}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                setComposing(false);
                setDraft(EMPTY);
              }}
            >
              ביטול
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={Boolean(invalid) || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    year: Number(draft.year),
                    title: draft.title.trim(),
                    personIds: draft.personIds,
                  },
                  {
                    onSuccess: () => {
                      setComposing(false);
                      setDraft(EMPTY);
                    },
                    onError: (cause) => setNotice(cause.message),
                  },
                )
              }
            >
              {invalid ?? (create.isPending ? 'מוסיפים…' : 'הוסיפו אירוע')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.addSlot}
          onClick={() => {
            setDraft(EMPTY);
            setEditingId(null);
            setComposing(true);
          }}
        >
          <span className={styles.addPlus} aria-hidden="true">
            +
          </span>
          אירוע חדש בציר הזמן
        </button>
      )}

      <ol className={styles.list}>
        {(events ?? []).map((event, index) =>
          editingId === event.id ? (
            <li key={event.id} className={styles.editor}>
              {fields}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setEditingId(null);
                    setDraft(EMPTY);
                  }}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={Boolean(invalid) || update.isPending}
                  onClick={() =>
                    update.mutate(
                      {
                        id: event.id,
                        patch: {
                          year: Number(draft.year),
                          title: draft.title.trim(),
                          personIds: draft.personIds,
                        },
                      },
                      {
                        onSuccess: () => {
                          setEditingId(null);
                          setDraft(EMPTY);
                        },
                        onError: (cause) => setNotice(cause.message),
                      },
                    )
                  }
                >
                  {invalid ?? 'עדכנו'}
                </button>
              </div>
            </li>
          ) : (
            <li
              key={event.id}
              className={styles.item}
              style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
            >
              <span className={styles.year}>{event.year}</span>
              <span className={styles.text}>
                <span className={styles.title}>{event.title}</span>
                {event.personIds.length > 0 && (
                  <span className={styles.person}>
                    {event.personIds
                      .map((id) => people.find((p) => p.id === id)?.fullName ?? '—')
                      .join(', ')}
                  </span>
                )}
              </span>
              {isSteward && (
                <span className={styles.tools}>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => {
                      setComposing(false);
                      setEditingId(event.id);
                      setDraft(draftFrom(event));
                    }}
                  >
                    עריכה
                  </button>
                  <button
                    type="button"
                    className={styles.toolDanger}
                    onClick={() =>
                      remove.mutate(event.id, {
                        onError: (cause) => setNotice(cause.message),
                      })
                    }
                  >
                    הסרה
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
