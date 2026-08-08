import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { ArchiveItem, ArchiveKind } from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import { useCreateArchiveItem, useSession, useTree, useUploadMedia } from '../api/hooks.ts';
import { formatBytes, givenName, kindColours } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { Confetti } from './Confetti.tsx';
import { InlineError } from './Feedback.tsx';
import { Sheet } from './Sheet.tsx';
import { Years } from './Years.tsx';
import styles from './AddTreasureSheet.module.css';

/**
 * The type picker's labels are not all archive kinds: "הקלטה" is what people
 * call the act, "קול" is how it is filed. The glyph geometry comes from the
 * design — a tilted rectangle for a photo, a rotated square for an object.
 */
interface TreasureType {
  label: string;
  kind: ArchiveKind;
  bg: string;
  fg: string;
  glyph: { width: number; height: number; radius: string; rotate: number };
}

const TYPES: readonly TreasureType[] = [
  {
    label: 'תצלום',
    kind: 'תצלום',
    bg: 'var(--accent-wash)',
    fg: 'var(--accent-strong)',
    glyph: { width: 44, height: 34, radius: '8px', rotate: -4 },
  },
  {
    label: 'מכתב',
    kind: 'מכתב',
    bg: 'var(--violet-wash)',
    fg: 'var(--violet-strong)',
    glyph: { width: 48, height: 30, radius: '6px', rotate: 3 },
  },
  {
    label: 'הקלטה',
    kind: 'קול',
    bg: 'var(--teal-wash)',
    fg: 'var(--teal-strong)',
    glyph: { width: 36, height: 36, radius: '50%', rotate: 0 },
  },
  {
    label: 'חפץ',
    kind: 'חפץ',
    bg: 'var(--amber-wash)',
    fg: 'var(--amber-strong)',
    glyph: { width: 34, height: 34, radius: '12px', rotate: 45 },
  },
  {
    label: 'סיפור',
    kind: 'סיפור',
    bg: 'var(--rose-wash)',
    fg: 'var(--rose)',
    glyph: { width: 46, height: 32, radius: '16px 16px 16px 4px', rotate: 0 },
  },
];

const EVERYONE = 'כל המשפחה';

export function AddTreasureSheet(): React.JSX.Element {
  const { addOpen, addPrefill, closeAddTreasure } = useUi();
  const { data: session } = useSession();
  const { data: tree } = useTree();
  const navigate = useNavigate();

  const upload = useUploadMedia();
  const create = useCreateArchiveItem();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [type, setType] = useState<TreasureType | null>(null);
  const [title, setTitle] = useState('');
  const [yearLabel, setYearLabel] = useState('');
  const [subject, setSubject] = useState(EVERYONE);
  const [story, setStory] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [created, setCreated] = useState<ArchiveItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const objectUrl = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const user = session?.user ?? null;

  // Reset to a clean first step whenever the sheet is opened afresh.
  useEffect(() => {
    if (!addOpen) return;
    setStep(1);
    setType(null);
    setTitle('');
    setYearLabel('');
    setSubject(addPrefill.subject ?? EVERYONE);
    setStory('');
    setFile(null);
    setCreated(null);
    setError(null);
  }, [addOpen, addPrefill.subject]);

  // Object URLs for the local preview must be revoked or they leak the file.
  useEffect(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      objectUrl.current = url;
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
    return () => {
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    };
  }, [file]);

  const subjectChips = useMemo(
    () => [EVERYONE, ...(tree?.people ?? []).map((p) => givenName(p.fullName))],
    [tree],
  );

  const busy = upload.isPending || create.isPending;
  const canSave = title.trim().length > 0 && !busy;

  const personIdForSubject = (name: string): string | null => {
    if (name === EVERYONE) return addPrefill.personId ?? null;
    return tree?.people.find((p) => givenName(p.fullName) === name)?.id ?? null;
  };

  async function save(): Promise<void> {
    if (!type || !canSave) return;
    setError(null);

    try {
      // Upload first: an archive entry that points at a file which failed to
      // arrive is worse than no entry at all.
      const media = file ? await upload.mutateAsync(file) : null;
      const item = await create.mutateAsync({
        kind: type.kind,
        title: title.trim(),
        yearLabel: yearLabel.trim(),
        subject,
        story: story.trim(),
        personId: personIdForSubject(subject),
        mediaId: media?.id ?? null,
      });
      setCreated(item);
      setStep(3);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'לא הצלחנו לשמור. נסו שוב בעוד רגע.',
      );
    }
  }

  const heading = step === 1 ? 'מה מוסיפים למסע?' : `ספרו על ה${type?.label ?? 'אוצר'}`;

  return (
    <Sheet
      open={addOpen}
      onClose={closeAddTreasure}
      title={step === 3 ? 'האוצר נוסף' : heading}
      hideTitle
    >
      <div className={styles.progress} aria-hidden="true">
        <span data-done="true" />
        <span data-done={step >= 2} />
        <span data-done={step >= 3} />
      </div>

      {!user ? (
        <div className={styles.gate}>
          <h3 className={styles.heading}>רק בני המשפחה מוסיפים לארכיון</h3>
          <p className={styles.subheading}>
            הצטרפו לאילן בשם שלכם, וכל מה שתוסיפו יישא את החתימה שלכם.
          </p>
          <Link
            to="/login"
            className={styles.gateAction}
            onClick={() => closeAddTreasure()}
          >
            להצטרפות ←
          </Link>
        </div>
      ) : step === 1 ? (
        <>
          <h3 className={styles.heading}>{heading}</h3>
          <p className={styles.subheading}>
            בחרו סוג — הכול מצטרף לארכיון ולתחנות של האנשים.
          </p>
          <div className={styles.typeGrid}>
            {TYPES.map((option, index) => (
              <button
                key={option.label}
                type="button"
                className={styles.typeCard}
                style={
                  {
                    '--card-bg': option.bg,
                    '--card-fg': option.fg,
                    '--delay': `${(index * 0.06).toFixed(2)}s`,
                  } as React.CSSProperties
                }
                onClick={() => {
                  setType(option);
                  setStep(2);
                }}
              >
                <span
                  className={styles.typeGlyph}
                  aria-hidden="true"
                  style={
                    {
                      width: option.glyph.width,
                      height: option.glyph.height,
                      borderRadius: option.glyph.radius,
                      // Held in a custom property so the :hover transform can
                      // build on it — an inline transform would win outright.
                      '--glyph-rot': `${option.glyph.rotate}deg`,
                    } as React.CSSProperties
                  }
                />
                <span className={styles.typeLabel}>{option.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : step === 2 ? (
        <>
          <h3 className={styles.heading}>{heading}</h3>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <input
              className={styles.field}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="כותרת — למשל: התצלום מהחתונה על הגג"
              aria-label="כותרת"
              maxLength={160}
              required
            />
            <input
              className={styles.field}
              value={yearLabel}
              onChange={(event) => setYearLabel(event.target.value)}
              placeholder="שנה — בערך זה בסדר"
              aria-label="שנה"
              maxLength={40}
            />

            <div>
              <p className={styles.fieldLabel} id="subject-label">
                של מי הרגע הזה?
              </p>
              <div className={styles.chips} role="group" aria-labelledby="subject-label">
                {subjectChips.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={
                      subject === name ? `${styles.chip} ${styles.chipActive}` : styles.chip
                    }
                    aria-pressed={subject === name}
                    onClick={() => setSubject(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className={styles.textarea}
              value={story}
              onChange={(event) => setStory(event.target.value)}
              placeholder="כמה מילים על הרגע הזה…"
              aria-label="הסיפור"
              maxLength={4000}
            />

            <div
              className={dragActive ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const dropped = event.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
            >
              {file ? (
                <div className={styles.preview}>
                  {previewUrl ? (
                    <img className={styles.previewImage} src={previewUrl} alt="" />
                  ) : (
                    <span className={styles.previewGlyph} aria-hidden="true">
                      ♪
                    </span>
                  )}
                  <span>
                    <span className={styles.previewName}>{file.name}</span>
                    <span className={styles.previewMeta}>{formatBytes(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.previewClear}
                    onClick={() => setFile(null)}
                  >
                    הסירו
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={styles.dropzoneInput}
                    type="file"
                    accept="image/*,audio/*,application/pdf"
                    aria-label="בחירת קובץ"
                    onChange={(event) => {
                      const picked = event.target.files?.[0];
                      if (picked) setFile(picked);
                    }}
                  />
                  <span className={styles.dropIcon} aria-hidden="true">
                    ↑
                  </span>
                  <p className={styles.dropTitle}>גררו לכאן תצלום, סריקה או הקלטה</p>
                  <p className={styles.dropNote}>או לחצו לבחירה · אפשר גם בלי קובץ</p>
                </>
              )}
            </div>

            {error && <InlineError>{error}</InlineError>}

            <div className={styles.actions}>
              <button type="button" className={styles.back} onClick={() => setStep(1)}>
                → חזרה
              </button>
              <button type="submit" className={styles.save} disabled={!canSave}>
                {upload.isPending
                  ? 'מעלים את הקובץ…'
                  : create.isPending
                    ? 'שומרים…'
                    : 'הוסיפו למסע ←'}
              </button>
            </div>
          </form>
        </>
      ) : (
        created && (
          <div className={styles.done}>
            <Confetti />
            <div className={styles.tick}>
              <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                <path
                  d="M10 21 L17 28 L30 13"
                  stroke="#fff"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
            <p className={styles.doneTitle}>האוצר נוסף למסע!</p>
            <p className={styles.doneNote}>עכשיו כולם יראו אותו בארכיון ובתחנות</p>

            <div className={styles.doneCard}>
              <div
                className={styles.doneThumb}
                style={{ background: kindColours(created.kind).wash }}
              >
                {mediaUrl(created.mediaId) ? (
                  <img src={mediaUrl(created.mediaId) as string} alt="" />
                ) : null}
                <span
                  className={styles.doneBadge}
                  style={{ color: kindColours(created.kind).text }}
                >
                  {created.kind}
                </span>
                <span className={styles.doneNew}>חדש ✦</span>
              </div>
              <p className={styles.doneCardTitle}>{created.title}</p>
              <p className={styles.doneCardMeta}>
                <Years>{created.yearLabel}</Years> · {created.subject}
              </p>
            </div>

            <div className={styles.doneActions}>
              <button
                type="button"
                className={styles.back}
                onClick={() => {
                  setStep(1);
                  setType(null);
                  setTitle('');
                  setYearLabel('');
                  setStory('');
                  setFile(null);
                  setCreated(null);
                }}
              >
                הוסיפו עוד אחד
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={() => {
                  closeAddTreasure();
                  navigate('/archive');
                }}
              >
                לארכיון ←
              </button>
            </div>
          </div>
        )
      )}
    </Sheet>
  );
}
