import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { mediaUrl } from '../api/client.ts';
import { useSession, useTree } from '../api/hooks.ts';
import { givenName, kindColours } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { Avatar } from './Avatar.tsx';
import { Sheet } from './Sheet.tsx';
import { Years } from './Years.tsx';
import styles from './TreasureViewer.module.css';

/** Glyph shown when the entry has no file attached. Mirrors the archive feed. */
const KIND_GLYPHS: Record<string, string> = {
  תצלום: '❑',
  מכתב: '✉',
  קול: '♪',
  מסמך: '❐',
  חפץ: '◈',
  סיפור: '❞',
};

/** "12 במרץ 2024" from an ISO timestamp; empty for anything unparseable. */
function longDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'long' }).format(time);
}

/**
 * The read side of a treasure — the archive card, opened.
 *
 * The feed shows a thumbnail and the first lines of the story; this shows the
 * photograph at full size and the story in full, with the people it belongs to
 * a tap away. Editing stays in the treasure sheet: this viewer hands over to
 * it rather than growing form fields of its own.
 */
export function TreasureViewer(): React.JSX.Element | null {
  const { viewerItem: item, closeViewer, openEditTreasure } = useUi();
  const { data: tree } = useTree();
  const { data: session } = useSession();

  const linked = useMemo(() => {
    if (!item || !tree) return [];
    const byId = new Map(tree.people.map((p) => [p.id, p]));
    return item.personIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [item, tree]);

  if (!item) return null;

  const user = session?.user ?? null;
  const canEdit = user !== null && (user.role === 'steward' || item.createdBy === user.id);

  const tone = kindColours(item.kind);
  const src = mediaUrl(item.mediaId);
  const isImage = Boolean(src) && item.kind !== 'קול';
  const isAudio = Boolean(src) && item.kind === 'קול';
  const added = longDate(item.createdAt);

  return (
    <Sheet open onClose={closeViewer} title={item.title} hideTitle>
      <article
        className={styles.viewer}
        style={{ '--tone-wash': tone.wash, '--tone-text': tone.text } as React.CSSProperties}
      >
        <div className={styles.stage}>
          {isImage && src ? (
            <img className={styles.image} src={src} alt={item.title} decoding="async" />
          ) : (
            <span className={styles.glyph} aria-hidden="true">
              {KIND_GLYPHS[item.kind] ?? '◇'}
            </span>
          )}
          <span className={styles.kindBadge}>{item.kind}</span>
        </div>

        {isAudio && src && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio className={styles.audio} src={src} controls preload="metadata" />
        )}

        <header className={styles.head}>
          <h3 className={styles.title}>{item.title}</h3>
          <p className={styles.meta}>
            <Years>{item.yearLabel}</Years> · {item.subject}
          </p>
        </header>

        {item.story && <p className={styles.story}>{item.story}</p>}

        {linked.length > 0 && tree && (
          <div className={styles.people}>
            <p className={styles.peopleLabel}>מופיעים כאן</p>
            <div className={styles.peopleRow}>
              {linked.map((person) => (
                <Link
                  key={person.id}
                  to={`/person/${person.id}`}
                  className={styles.personChip}
                  onClick={closeViewer}
                >
                  <Avatar
                    person={person}
                    generation={tree.generations.find((g) => g.id === person.generationId)}
                    size={30}
                  />
                  {givenName(person.fullName)}
                </Link>
              ))}
            </div>
          </div>
        )}

        <footer className={styles.foot}>
          {src && !isImage && !isAudio && (
            <a className={styles.download} href={src} download>
              הורדת הקובץ ↓
            </a>
          )}
          {added && <span className={styles.added}>נוסף לארכיון ב־{added}</span>}
          {canEdit && (
            <button
              type="button"
              className={styles.edit}
              onClick={() => openEditTreasure(item)}
            >
              עריכה ✎
            </button>
          )}
        </footer>
      </article>
    </Sheet>
  );
}
