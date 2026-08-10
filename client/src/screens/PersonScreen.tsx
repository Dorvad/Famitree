import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { mediaUrl } from '../api/client.ts';
import {
  useAddMilestone,
  useAddRelationship,
  useArchive,
  usePerson,
  useSession,
  useTree,
} from '../api/hooks.ts';
import { ScrollArea } from '../components/AppShell.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ErrorState, InlineError, LoadingScreen } from '../components/Feedback.tsx';
import { PersonPicker } from '../components/PersonPicker.tsx';
import { Years } from '../components/Years.tsx';
import { generationVars, givenName, kindColours, restTilt } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import styles from './PersonScreen.module.css';

/** Bar heights and timings for the decorative equaliser beside a recording. */
const EQ_BARS = [
  { height: 10, duration: 1, delay: 0 },
  { height: 16, duration: 0.9, delay: 0.12 },
  { height: 20, duration: 1.1, delay: 0.24 },
  { height: 13, duration: 0.8, delay: 0.36 },
  { height: 18, duration: 1, delay: 0.48 },
] as const;

export function PersonScreen(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: person, isPending, error, refetch } = usePerson(id);
  const { data: tree } = useTree();
  const { data: session } = useSession();
  const { data: pieces } = useArchive(undefined, id);
  const { openAddTreasure, openViewTreasure } = useUi();

  const addMilestone = useAddMilestone(id ?? '');
  const addRelationship = useAddRelationship();

  const [composing, setComposing] = useState(false);
  const [memoryYear, setMemoryYear] = useState('');
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryBody, setMemoryBody] = useState('');
  const [parentId, setParentId] = useState('');

  const generation = tree?.generations.find((g) => g.id === person?.generationId);
  const user = session?.user ?? null;

  // Prev/next follow the tree's own ordering, so paging walks the family in
  // roughly generational order rather than alphabetically.
  const { previous, next } = useMemo(() => {
    const people = tree?.people ?? [];
    const index = people.findIndex((p) => p.id === id);
    if (index === -1 || people.length < 2) return { previous: undefined, next: undefined };
    return {
      previous: people[(index - 1 + people.length) % people.length],
      next: people[(index + 1) % people.length],
    };
  }, [id, tree]);

  // Someone whose node is not yet joined to the tree can attach it themselves.
  const canLinkToFamily = Boolean(
    person?.isProvisional &&
      user &&
      (user.role === 'steward' || user.personId === person.id) &&
      !(tree?.relationships ?? []).some((r) => r.type === 'parent' && r.relatedPersonId === person.id),
  );

  if (isPending) return <LoadingScreen />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!person) return <ErrorState error={new Error('missing')} />;

  const firstName = givenName(person.fullName);
  const audioSrc = mediaUrl(person.audioMediaId);

  const submitMemory = (event: React.FormEvent) => {
    event.preventDefault();
    if (!memoryTitle.trim() || !memoryYear.trim()) return;
    addMilestone.mutate(
      { yearLabel: memoryYear.trim(), title: memoryTitle.trim(), body: memoryBody.trim() },
      {
        onSuccess: () => {
          setMemoryYear('');
          setMemoryTitle('');
          setMemoryBody('');
          setComposing(false);
        },
      },
    );
  };

  return (
    <ScrollArea>
      <div className={styles.wrap} style={generationVars(generation)}>
        <div className={styles.topRow}>
          <Link to={`/?focus=${encodeURIComponent(person.id)}`} className={styles.back}>
            → חזרה לאילן
          </Link>
          {user && (
            <Link to={`/edit/people/${person.id}`} className={styles.editLink}>
              עריכת הכרטיס ✎
            </Link>
          )}
        </div>

        <header className={styles.header}>
          <div className={styles.portrait}>
            <Avatar person={person} generation={generation} size={148} />
            <div className={styles.tags}>
              <Years className={styles.tagYears}>{person.lifeSpan || 'שנים לא ידועות'}</Years>
              {person.place && <span className={styles.tagPlace}>{person.place}</span>}
            </div>
          </div>

          <div className={styles.identity}>
            <p className={styles.cohort}>
              {[generation?.name, person.branch].filter(Boolean).join(' · ')}
            </p>
            <h1 className={styles.name}>{person.fullName}</h1>
            {person.story && <p className={styles.story}>{person.story}</p>}
          </div>
        </header>

        {canLinkToFamily && tree && (
          <section className={styles.linkBox}>
            <h2 className={styles.linkTitle}>חברו את הענף שלכם לאילן</h2>
            <p className={styles.linkNote}>
              בחרו מי ההורה, והקו יצויר מיד. אפשר גם לדלג ולחזור לזה בהמשך.
            </p>
            <div className={styles.linkRow}>
              <div className={styles.linkPicker}>
                <PersonPicker
                  people={tree.people.filter((candidate) => candidate.id !== person.id)}
                  generations={tree.generations}
                  value={parentId}
                  onChange={setParentId}
                  label="בחירת הורה"
                />
              </div>
              <button
                type="button"
                className={styles.primary}
                disabled={!parentId || addRelationship.isPending}
                onClick={() =>
                  addRelationship.mutate(
                    { personId: parentId, relatedPersonId: person.id, type: 'parent' },
                    { onSuccess: () => setParentId('') },
                  )
                }
              >
                {addRelationship.isPending ? 'מחברים…' : 'חברו לאילן'}
              </button>
            </div>
            {addRelationship.error && (
              <InlineError>{addRelationship.error.message}</InlineError>
            )}
          </section>
        )}

        <h2 className={styles.sectionTitle}>התחנות של {firstName}</h2>

        <div className={styles.milestones}>
          {person.milestones.map((milestone, index) => (
            <article
              key={milestone.id}
              className={styles.milestone}
              style={{ '--i': index } as React.CSSProperties}
            >
              <Years className={styles.milestoneYear}>{milestone.yearLabel}</Years>
              <h3 className={styles.milestoneTitle}>{milestone.title}</h3>
              {milestone.body && <p className={styles.milestoneBody}>{milestone.body}</p>}
            </article>
          ))}

          {composing ? (
            <form className={styles.memoryForm} onSubmit={submitMemory}>
              <input
                className={styles.input}
                value={memoryYear}
                onChange={(event) => setMemoryYear(event.target.value)}
                placeholder="שנה — בערך זה בסדר"
                aria-label="שנה"
                maxLength={40}
                required
              />
              <input
                className={styles.input}
                value={memoryTitle}
                onChange={(event) => setMemoryTitle(event.target.value)}
                placeholder="כותרת — למשל: הסדנה ברחוב הגפן"
                aria-label="כותרת"
                maxLength={120}
                required
              />
              <textarea
                className={styles.textarea}
                value={memoryBody}
                onChange={(event) => setMemoryBody(event.target.value)}
                placeholder="מה קרה שם…"
                aria-label="תיאור"
                maxLength={2000}
              />
              {addMilestone.error && <InlineError>{addMilestone.error.message}</InlineError>}
              <div className={styles.formRow}>
                <button type="button" className={styles.ghost} onClick={() => setComposing(false)}>
                  ביטול
                </button>
                <button type="submit" className={styles.primary} disabled={addMilestone.isPending}>
                  {addMilestone.isPending ? 'שומרים…' : 'הוסיפו תחנה'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className={styles.addCard}
              onClick={() => {
                if (user) setComposing(true);
                else openAddTreasure({ subject: firstName, personId: person.id });
              }}
            >
              <span className={styles.addPlus} aria-hidden="true">
                +
              </span>
              <span className={styles.addLabel}>הוסיפו זיכרון על {firstName}</span>
            </button>
          )}
        </div>

        {person.audioLabel && (
          <section className={styles.recording}>
            <span className={styles.equaliser} aria-hidden="true">
              {EQ_BARS.map((bar, index) => (
                <span
                  key={index}
                  style={{
                    height: bar.height,
                    animation: `eq ${bar.duration}s ease-in-out ${bar.delay}s infinite`,
                  }}
                />
              ))}
            </span>
            <div className={styles.recordingBody}>
              <p className={styles.recordingLabel}>{person.audioLabel}</p>
              {audioSrc ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio className={styles.player} src={audioSrc} controls preload="none" />
              ) : (
                <p className={styles.recordingNote}>
                  ההקלטה עצמה עדיין לא הועלתה. מי שיש לו את הקובץ — אפשר להוסיף אותו כאוצר מסוג
                  ״הקלטה״.
                </p>
              )}
            </div>
          </section>
        )}

        {pieces && pieces.length > 0 && (
          <>
            <h2 className={styles.sectionTitle}>אוצרות של {firstName}</h2>
            <div className={styles.pieces}>
              {pieces.map((piece, index) => {
                const tone = kindColours(piece.kind);
                const src = mediaUrl(piece.mediaId);
                return (
                  <button
                    key={piece.id}
                    type="button"
                    onClick={() => openViewTreasure(piece)}
                    className={styles.piece}
                    style={
                      {
                        '--tone-wash': tone.wash,
                        '--tone-text': tone.text,
                        '--rest-tilt': restTilt(piece.id),
                        '--i': index,
                      } as React.CSSProperties
                    }
                  >
                    <span className={styles.pieceThumb}>
                      {src && piece.kind !== 'קול' ? (
                        <img src={src} alt={piece.title} loading="lazy" decoding="async" />
                      ) : (
                        piece.kind.charAt(0)
                      )}
                    </span>
                    <span className={styles.pieceTitle}>{piece.title}</span>
                    <Years className={styles.pieceMeta}>{piece.yearLabel}</Years>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {previous && next && (
          <nav className={styles.pager} aria-label="מעבר בין בני המשפחה">
            <Link to={`/person/${previous.id}`} className={styles.pagerPrev}>
              → התחנה הקודמת: {givenName(previous.fullName)}
            </Link>
            <Link to={`/person/${next.id}`} className={styles.pagerNext}>
              התחנה הבאה: {givenName(next.fullName)} ←
            </Link>
          </nav>
        )}
      </div>
    </ScrollArea>
  );
}
