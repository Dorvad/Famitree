import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { ArchiveItem, ArchiveKind } from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import {
  useCreateArchiveItem,
  useRemoveArchiveItem,
  useSession,
  useTree,
  useUpdateArchiveItem,
  useUploadMedia,
} from '../api/hooks.ts';
import { formatBytes, givenName, kindColours } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { Confetti } from './Confetti.tsx';
import { InlineError } from './Feedback.tsx';
import { Sheet } from './Sheet.tsx';
import { Years } from './Years.tsx';
import styles from './TreasureSheet.module.css';

/**
 * The one place a treasure is created *or* edited.
 *
 * The type picker's labels are not all archive kinds: "הקלטה" is what people
 * call the act, "קול" is how it is filed. The glyph geometry comes from the
 * design — a tilted rectangle for a photo, a rotated square for an object.
 */
interface TreasureType {
  /** What people call it. Not always the kind: one *records* a "הקלטה", filed as "קול". */
  label: string;
  kind: ArchiveKind;
  bg: string;
  fg: string;
  glyph: { width: number; height: number; radius: string; rotate: number };
}

/**
 * One entry per archive kind — all six.
 *
 * The prototype's picker listed only five, omitting "מסמך" even though the
 * archive filters by it and the sample family contains two documents. That was
 * survivable while this sheet only created things; once it also edits, a
 * missing entry means opening a document would fall back to the first type and
 * silently re-file it as a photograph on save. The list is now exhaustive, and
 * `typeForKind` is checked against ARCHIVE_KINDS below so it stays that way.
 *
 * Colours come from `kindColours`, the same map the archive and the tree use,
 * rather than being restated here — they had already drifted for "חפץ".
 */
const TYPE_SHAPES = [
  { label: 'תצלום', kind: 'תצלום', glyph: { width: 44, height: 34, radius: '8px', rotate: -4 } },
  { label: 'מכתב', kind: 'מכתב', glyph: { width: 48, height: 30, radius: '6px', rotate: 3 } },
  { label: 'הקלטה', kind: 'קול', glyph: { width: 36, height: 36, radius: '50%', rotate: 0 } },
  { label: 'מסמך', kind: 'מסמך', glyph: { width: 32, height: 42, radius: '4px', rotate: -3 } },
  { label: 'חפץ', kind: 'חפץ', glyph: { width: 34, height: 34, radius: '12px', rotate: 45 } },
  {
    label: 'סיפור',
    kind: 'סיפור',
    glyph: { width: 46, height: 32, radius: '16px 16px 16px 4px', rotate: 0 },
  },
] as const satisfies ReadonlyArray<{
  label: string;
  kind: ArchiveKind;
  glyph: TreasureType['glyph'];
}>;

/**
 * Compile-time guarantee that the picker covers every archive kind.
 *
 * `Exclude` is `never` only when nothing is missing; anything left over fails
 * the `extends never` constraint and the build stops. This is what catches the
 * next kind added to the shared list without an entry here.
 */
type AssertNever<T extends never> = T;
export type EveryKindHasAPickerEntry = AssertNever<
  Exclude<ArchiveKind, (typeof TYPE_SHAPES)[number]['kind']>
>;

const TYPES: readonly TreasureType[] = TYPE_SHAPES.map((shape) => ({
  ...shape,
  bg: kindColours(shape.kind).wash,
  fg: kindColours(shape.kind).text,
}));

const EVERYONE = 'כל המשפחה';

/**
 * Every kind has an entry, so this always resolves. The fallback exists only so
 * a future kind added to the shared list cannot crash the sheet — it keeps the
 * item's own kind rather than quietly rewriting it.
 */
function typeForKind(kind: ArchiveKind): TreasureType {
  const found = TYPES.find((t) => t.kind === kind);
  if (found) return found;
  return { label: kind, kind, ...kindColoursAsType(kind) };
}

function kindColoursAsType(kind: ArchiveKind): Omit<TreasureType, 'label' | 'kind'> {
  const tone = kindColours(kind);
  return {
    bg: tone.wash,
    fg: tone.text,
    glyph: { width: 40, height: 34, radius: '6px', rotate: 0 },
  };
}

export function TreasureSheet(): React.JSX.Element {
  const { treasureOpen, treasureItem, treasurePrefill, closeTreasure } = useUi();
  const { data: session } = useSession();
  const { data: tree } = useTree();
  const navigate = useNavigate();

  const upload = useUploadMedia();
  const create = useCreateArchiveItem();
  const update = useUpdateArchiveItem();
  const remove = useRemoveArchiveItem();

  const editing = treasureItem !== null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [type, setType] = useState<TreasureType | null>(null);
  const [title, setTitle] = useState('');
  const [yearLabel, setYearLabel] = useState('');
  const [subject, setSubject] = useState(EVERYONE);
  const [story, setStory] = useState('');
  const [file, setFile] = useState<File | null>(null);
  /** Media already attached to the item being edited, kept unless replaced. */
  const [existingMediaId, setExistingMediaId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [created, setCreated] = useState<ArchiveItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const objectUrl = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const user = session?.user ?? null;

  // Seed the form each time the sheet opens: from the item when editing, or
  // from a clean slate plus any prefill when adding.
  useEffect(() => {
    if (!treasureOpen) return;
    setError(null);
    setFile(null);
    setCreated(null);
    setConfirmingRemove(false);

    if (treasureItem) {
      setStep(2);
      setType(typeForKind(treasureItem.kind));
      setTitle(treasureItem.title);
      setYearLabel(treasureItem.yearLabel === 'לא ידוע' ? '' : treasureItem.yearLabel);
      setSubject(treasureItem.subject || EVERYONE);
      setStory(treasureItem.story);
      setExistingMediaId(treasureItem.mediaId);
      return;
    }

    setStep(1);
    setType(null);
    setTitle('');
    setYearLabel('');
    setSubject(treasurePrefill.subject ?? EVERYONE);
    setStory('');
    setExistingMediaId(null);
  }, [treasureOpen, treasureItem, treasurePrefill.subject]);

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

  const busy = upload.isPending || create.isPending || update.isPending;
  const canSave = title.trim().length > 0 && !busy;

  const canRemove =
    editing && user && (user.role === 'steward' || treasureItem?.createdBy === user.id);

  const personIdForSubject = (name: string): string | null => {
    if (name === EVERYONE) return treasurePrefill.personId ?? treasureItem?.personId ?? null;
    return tree?.people.find((p) => givenName(p.fullName) === name)?.id ?? null;
  };

  async function save(): Promise<void> {
    if (!type || !canSave) return;
    setError(null);

    try {
      // Upload first: an entry pointing at a file that failed to arrive is
      // worse than no entry at all.
      const media = file ? await upload.mutateAsync(file) : null;
      const mediaId = media?.id ?? existingMediaId;

      const body = {
        kind: type.kind,
        title: title.trim(),
        yearLabel: yearLabel.trim(),
        subject,
        story: story.trim(),
        personId: personIdForSubject(subject),
        mediaId,
      };

      if (editing && treasureItem) {
        await update.mutateAsync({ id: treasureItem.id, patch: body });
        // An edit needs no ceremony — the updated card behind the sheet is the
        // confirmation. The celebration belongs to a first arrival.
        closeTreasure();
        return;
      }

      setCreated(await create.mutateAsync(body));
      setStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור. נסו שוב בעוד רגע.');
    }
  }

  const heading = editing
    ? `עריכת ה${type?.label ?? 'אוצר'}`
    : step === 1
      ? 'מה מוסיפים למסע?'
      : `ספרו על ה${type?.label ?? 'אוצר'}`;

  const attachedUrl = previewUrl ?? (file ? null : mediaUrl(existingMediaId));

  return (
    <Sheet
      open={treasureOpen}
      onClose={closeTreasure}
      title={step === 3 ? 'האוצר נוסף' : heading}
      hideTitle
    >
      {!editing && (
        <div className={styles.progress} aria-hidden="true">
          <span data-done="true" />
          <span data-done={step >= 2} />
          <span data-done={step >= 3} />
        </div>
      )}

      {!user ? (
        <div className={styles.gate}>
          <h3 className={styles.heading}>רק בני המשפחה מוסיפים לארכיון</h3>
          <p className={styles.subheading}>
            הצטרפו לאילן בשם שלכם, וכל מה שתוסיפו יישא את החתימה שלכם.
          </p>
          <Link to="/login" className={styles.gateAction} onClick={() => closeTreasure()}>
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

          {/* When editing, the type is changeable in place rather than by
              stepping back through a wizard the user did not start. */}
          {editing && (
            <div className={styles.typeRow} role="group" aria-label="סוג האוצר">
              {TYPES.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={
                    type?.kind === option.kind
                      ? `${styles.typeChip} ${styles.typeChipActive}`
                      : styles.typeChip
                  }
                  aria-pressed={type?.kind === option.kind}
                  style={
                    { '--chip-bg': option.bg, '--chip-fg': option.fg } as React.CSSProperties
                  }
                  onClick={() => setType(option)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

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
              className={
                dragActive ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone
              }
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
              {file || existingMediaId ? (
                <div className={styles.preview}>
                  {attachedUrl ? (
                    <img className={styles.previewImage} src={attachedUrl} alt="" />
                  ) : (
                    <span className={styles.previewGlyph} aria-hidden="true">
                      ♪
                    </span>
                  )}
                  <span>
                    <span className={styles.previewName}>
                      {file ? file.name : 'הקובץ המצורף'}
                    </span>
                    <span className={styles.previewMeta}>
                      {file ? formatBytes(file.size) : 'גררו קובץ חדש כדי להחליף'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.previewClear}
                    onClick={() => {
                      setFile(null);
                      setExistingMediaId(null);
                    }}
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
              {editing ? (
                <button type="button" className={styles.back} onClick={closeTreasure}>
                  ביטול
                </button>
              ) : (
                <button type="button" className={styles.back} onClick={() => setStep(1)}>
                  → חזרה
                </button>
              )}
              <button type="submit" className={styles.save} disabled={!canSave}>
                {upload.isPending
                  ? 'מעלים את הקובץ…'
                  : busy
                    ? 'שומרים…'
                    : editing
                      ? 'שמרו שינויים'
                      : 'הוסיפו למסע ←'}
              </button>
            </div>
          </form>

          {canRemove && (
            <div className={styles.dangerZone}>
              {confirmingRemove ? (
                <>
                  <p className={styles.dangerNote}>
                    האוצר יוסר מהארכיון אבל לא יימחק — הקובץ עצמו נשמר.
                  </p>
                  <div className={styles.dangerActions}>
                    <button
                      type="button"
                      className={styles.back}
                      onClick={() => setConfirmingRemove(false)}
                    >
                      לא, בטלו
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(treasureItem!.id, {
                          onSuccess: closeTreasure,
                          onError: (cause) => setError(cause.message),
                        })
                      }
                    >
                      כן, הסירו
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.dangerQuiet}
                  onClick={() => setConfirmingRemove(true)}
                >
                  הסירו את האוצר מהארכיון
                </button>
              )}
            </div>
          )}
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
                <span className={styles.doneNew}>חדש</span>
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
                  setExistingMediaId(null);
                  setCreated(null);
                }}
              >
                הוסיפו עוד אחד
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={() => {
                  closeTreasure();
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
