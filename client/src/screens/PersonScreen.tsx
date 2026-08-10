import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ArchiveItem, Milestone } from '../../../shared/types.ts';

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

/**
 * First four-digit year in a free-text label — "סביב 1900", "1948–2009".
 *
 * Both stations and treasures date themselves in prose, because a family
 * archive rarely knows the day. A year is enough to put them in order.
 */
function firstYear(label: string): number | null {
  const match = /\d{4}/.exec(label);
  if (!match) return null;
  const year = Number(match[0]);
  return year >= 1000 && year <= 2999 ? year : null;
}

/** One entry in the life ribbon: a station the family wrote, or a thing it kept. */
type RibbonEntry =
  | { sort: 'station'; id: string; year: number | null; milestone: Milestone }
  | { sort: 'treasure'; id: string; year: number | null; item: ArchiveItem };

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

  /**
   * The life ribbon: the stations the family wrote, with the things it kept
   * slotted in among them.
   *
   * A page of nothing but paragraphs is a page nobody finishes, and this
   * person's photographs and letters were already sitting in a grid at the
   * bottom where they illustrated nothing. Dating both from their own labels
   * puts a picture between the paragraphs, where it belongs.
   *
   * The stations keep the order the archive gave them — a steward's sequence is
   * a judgement, not an accident — and each treasure slots in before the first
   * station it predates. A treasure whose label carries no year cannot be
   * placed by year, so it joins the end rather than being guessed at or hidden.
   */
  const ribbon = useMemo<RibbonEntry[]>(() => {
    const entries: RibbonEntry[] = (person?.milestones ?? []).map((milestone) => ({
      sort: 'station',
      id: milestone.id,
      year: firstYear(milestone.yearLabel),
      milestone,
    }));

    const undated: RibbonEntry[] = [];
    for (const item of pieces ?? []) {
      const year = firstYear(item.yearLabel);
      const entry: RibbonEntry = { sort: 'treasure', id: item.id, year, item };
      if (year == null) {
        undated.push(entry);
        continue;
      }
      const at = entries.findIndex((other) => other.year != null && other.year > year);
      entries.splice(at === -1 ? entries.length : at, 0, entry);
    }
    return [...entries, ...undated];
  }, [person, pieces]);

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
          {ribbon.map((entry, index) => {
            if (entry.sort === 'station') {
              const { milestone } = entry;
              return (
                <article
                  key={entry.id}
                  className={styles.milestone}
                  style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
                >
                  <Years className={styles.milestoneYear}>{milestone.yearLabel}</Years>
                  <h3 className={styles.milestoneTitle}>{milestone.title}</h3>
                  {milestone.body && <p className={styles.milestoneBody}>{milestone.body}</p>}
                </article>
              );
            }

            // A kept thing, sitting where it happened. Opens the same viewer the
            // archive uses, so the full image and story are one tap away.
            const { item } = entry;
            const tone = kindColours(item.kind);
            const src = mediaUrl(item.mediaId);
            const hasImage = Boolean(src) && item.kind !== 'קול';
            return (
              <button
                key={entry.id}
                type="button"
                className={styles.relic}
                onClick={() => openViewTreasure(item)}
                style={
                  {
                    '--tone-wash': tone.wash,
                    '--tone-text': tone.text,
                    '--rest-tilt': restTilt(item.id, 1.1),
                    '--i': Math.min(index, 12),
                  } as React.CSSProperties
                }
              >
                <span className={styles.relicFrame}>
                  {hasImage && src ? (
                    <img src={src} alt={item.title} loading="lazy" decoding="async" />
                  ) : (
                    <span className={styles.relicGlyph} aria-hidden="true">
                      {item.kind.charAt(0)}
                    </span>
                  )}
                  <span className={styles.relicKind}>{item.kind}</span>
                </span>
                <span className={styles.relicText}>
                  <Years className={styles.relicYear}>{item.yearLabel}</Years>
                  <span className={styles.relicTitle}>{item.title}</span>
                  {item.story && <span className={styles.relicStory}>{item.story}</span>}
                </span>
              </button>
            );
          })}

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

          {/* The treasures themselves now sit among the stations above, so the
              way to add one belongs here rather than under a heading of its own. */}
          <button
            type="button"
            className={styles.addCard}
            onClick={() => openAddTreasure({ subject: firstName, personId: person.id })}
          >
            <span className={styles.addPlus} aria-hidden="true">
              +
            </span>
            <span className={styles.addLabel}>
              תצלום, מכתב או הקלטה של {firstName}
            </span>
          </button>
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
