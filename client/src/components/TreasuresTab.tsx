import { useMemo, useState } from 'react';

import { ARCHIVE_KINDS, type ArchiveKind, type SessionUser } from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import { useArchive } from '../api/hooks.ts';
import { kindColours, restTilt } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { ErrorState, LoadingScreen } from './Feedback.tsx';
import { Years } from './Years.tsx';
import styles from './TreasuresTab.module.css';

/** Glyph shown when an entry has no file attached yet. */
const KIND_GLYPHS: Record<ArchiveKind, string> = {
  תצלום: '❑',
  מכתב: '✉',
  קול: '♪',
  מסמך: '❐',
  חפץ: '◈',
  סיפור: '❞',
};

function isKind(value: string): value is ArchiveKind {
  return (ARCHIVE_KINDS as readonly string[]).includes(value);
}

/**
 * Every treasure in the archive, as an editable contact sheet.
 *
 * Clicking a print opens the same sheet the archive screen uses to add one, so
 * there is a single create-and-edit path however you arrive at it.
 */
export function TreasuresTab({ user }: { user: SessionUser }): React.JSX.Element {
  const { data: items, isPending, error, refetch } = useArchive();
  const { openAddTreasure, openEditTreasure } = useUi();
  const [kindFilter, setKindFilter] = useState<ArchiveKind | null>(null);

  const shown = useMemo(
    () => (items ?? []).filter((item) => !kindFilter || item.kind === kindFilter),
    [items, kindFilter],
  );

  if (isPending) return <LoadingScreen label="פותחים את הקופסה…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const canEdit = (createdBy: string | null) =>
    user.role === 'steward' || createdBy === user.id;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="סינון לפי סוג">
          <button
            type="button"
            className={!kindFilter ? `${styles.filter} ${styles.filterActive}` : styles.filter}
            aria-pressed={!kindFilter}
            onClick={() => setKindFilter(null)}
          >
            הכל ({items?.length ?? 0})
          </button>
          {ARCHIVE_KINDS.filter(isKind).map((kind) => {
            const count = (items ?? []).filter((item) => item.kind === kind).length;
            if (count === 0) return null;
            return (
              <button
                key={kind}
                type="button"
                className={
                  kindFilter === kind ? `${styles.filter} ${styles.filterActive}` : styles.filter
                }
                aria-pressed={kindFilter === kind}
                onClick={() => setKindFilter(kind)}
              >
                {kind} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className={styles.addSlot}
        onClick={() => openAddTreasure({ personId: user.personId })}
      >
        <span className={styles.addPlus} aria-hidden="true">
          +
        </span>
        <span>
          <span className={styles.addTitle}>הוסיפו אוצר</span>
          <span className={styles.addNote}>תצלום, מכתב, הקלטה, מסמך, חפץ או סיפור</span>
        </span>
      </button>

      {shown.length === 0 ? (
        <p className={styles.empty}>אין כאן פריטים עדיין.</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((item, index) => {
            const tone = kindColours(item.kind);
            const src = mediaUrl(item.mediaId);
            const editable = canEdit(item.createdBy);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.card}
                  disabled={!editable}
                  title={editable ? 'לעריכה' : 'אפשר לערוך רק אוצרות שאתם הוספתם'}
                  style={
                    {
                      '--tone-wash': tone.wash,
                      '--tone-text': tone.text,
                      '--rest-tilt': restTilt(item.id, 1.4),
                      '--i': Math.min(index, 14),
                    } as React.CSSProperties
                  }
                  onClick={() => openEditTreasure(item)}
                >
                  <span className={styles.thumb}>
                    {src && item.kind !== 'קול' ? (
                      <img src={src} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.glyph} aria-hidden="true">
                        {KIND_GLYPHS[item.kind] ?? '◇'}
                      </span>
                    )}
                    <span className={styles.kindBadge}>{item.kind}</span>
                    {!src && <span className={styles.noFile}>בלי קובץ</span>}
                  </span>
                  <span className={styles.cardTitle}>{item.title}</span>
                  <span className={styles.cardMeta}>
                    <Years>{item.yearLabel}</Years> · {item.subject}
                  </span>
                  {editable && (
                    <span className={styles.editHint} aria-hidden="true">
                      ✎ עריכה
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
