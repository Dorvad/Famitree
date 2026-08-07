import { useSearchParams } from 'react-router-dom';

import { ARCHIVE_KINDS, type ArchiveKind } from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import { useArchive, useSession } from '../api/hooks.ts';
import { ScrollArea } from '../components/AppShell.tsx';
import { EmptyState, ErrorState, LoadingScreen } from '../components/Feedback.tsx';
import { Years } from '../components/Years.tsx';
import { kindColours } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import styles from './ArchiveScreen.module.css';

/** Glyph shown when an entry has no file attached yet. */
const KIND_GLYPHS: Record<ArchiveKind, string> = {
  תצלום: '❑',
  מכתב: '✉',
  קול: '♪',
  מסמך: '❐',
  חפץ: '◈',
  סיפור: '❞',
};

/** Anything added in the last day gets the "new" flag from the design. */
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

function isKind(value: string | null): value is ArchiveKind {
  return value != null && (ARCHIVE_KINDS as readonly string[]).includes(value);
}

export function ArchiveScreen(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openAddTreasure } = useUi();
  const { data: session } = useSession();

  const kindParam = searchParams.get('kind');
  const activeKind = isKind(kindParam) ? kindParam : undefined;

  const { data: items, isPending, error, refetch } = useArchive(activeKind);

  const setKind = (kind: ArchiveKind | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (kind) next.set('kind', kind);
    else next.delete('kind');
    setSearchParams(next, { replace: true });
  };

  return (
    <ScrollArea>
      <div className={styles.wrap}>
        <div className={styles.toolbar}>
          <h1 className={styles.title}>אוצרות המשפחה</h1>

          <div className={styles.filters} role="group" aria-label="סינון לפי סוג">
            <button
              type="button"
              className={!activeKind ? `${styles.filter} ${styles.filterActive}` : styles.filter}
              aria-pressed={!activeKind}
              onClick={() => setKind(undefined)}
            >
              הכל
            </button>
            {ARCHIVE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={
                  activeKind === kind ? `${styles.filter} ${styles.filterActive}` : styles.filter
                }
                aria-pressed={activeKind === kind}
                onClick={() => setKind(kind)}
              >
                {kind}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={styles.add}
            onClick={() =>
              openAddTreasure({ personId: session?.user?.personId ?? null })
            }
          >
            + הוסיפו אוצר
          </button>
        </div>

        {isPending ? (
          <LoadingScreen label="פותחים את הקופסה…" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !items || items.length === 0 ? (
          <EmptyState
            title={activeKind ? `אין עדיין ${activeKind}` : 'הארכיון עדיין ריק'}
            message="כל תצלום, מכתב או הקלטה שתוסיפו יופיע כאן — ובתחנות של האנשים."
            actionLabel="הוסיפו אוצר ראשון"
            onAction={() => openAddTreasure()}
          />
        ) : (
          <div className={styles.feed}>
            {items.map((item) => {
              const tone = kindColours(item.kind);
              const src = mediaUrl(item.mediaId);
              const isImage = Boolean(src) && item.kind !== 'קול';
              const isAudio = Boolean(src) && item.kind === 'קול';
              const isNew = Date.now() - Date.parse(item.createdAt) < NEW_WINDOW_MS;

              return (
                <article
                  key={item.id}
                  className={styles.card}
                  style={
                    { '--tone-wash': tone.wash, '--tone-text': tone.text } as React.CSSProperties
                  }
                >
                  <div className={styles.thumb} style={{ height: item.tileHeight }}>
                    {isImage && src ? (
                      <img src={src} alt={item.title} loading="lazy" />
                    ) : (
                      <span className={styles.placeholderGlyph} aria-hidden="true">
                        {KIND_GLYPHS[item.kind] ?? '◇'}
                      </span>
                    )}
                    <span className={styles.kindBadge}>{item.kind}</span>
                    {isNew && <span className={styles.newBadge}>חדש ✦</span>}
                  </div>

                  {isAudio && src && (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio className={styles.audio} src={src} controls preload="none" />
                  )}

                  <h2 className={styles.cardTitle}>{item.title}</h2>
                  <p className={styles.cardMeta}>
                    <Years>{item.yearLabel}</Years> · {item.subject}
                  </p>
                  {item.story && <p className={styles.cardStory}>{item.story}</p>}

                  {src && !isImage && !isAudio && (
                    <a className={styles.download} href={src} download>
                      הורדת הקובץ ↓
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
