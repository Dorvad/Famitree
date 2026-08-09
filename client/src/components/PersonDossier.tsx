import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

import type { Generation, Person } from '../../../shared/types.ts';

import { mediaUrl } from '../api/client.ts';
import { useArchive, usePerson, useSession, useTree } from '../api/hooks.ts';
import { generationVars, givenName, kindColours, restTilt } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';
import { Years } from './Years.tsx';
import styles from './PersonDossier.module.css';

/**
 * Where a lens opens from, in viewport pixels.
 *
 * Measured from the DOM at the moment of the click rather than derived from the
 * pan/zoom transform: the transform is clamped, the page may have scrolled, and
 * a rect is simply the truth about where the thing the user touched actually
 * is.
 */
export interface LensOrigin {
  /** Centre of the node that was clicked. */
  x: number;
  y: number;
  /** The node's radius on screen — where the circle starts and ends. */
  r0: number;
  /** Distance to the furthest viewport corner — where the circle has to reach. */
  r1: number;
}

/** Reads a lens origin off any circular element on screen. */
export function originFromElement(element: Element): LensOrigin {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return {
    x,
    y,
    r0: Math.max(rect.width, rect.height) / 2,
    r1: Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ),
  };
}

interface KinGroup {
  key: 'parents' | 'partners' | 'children';
  label: string;
  members: Array<{ person: Person; generation: Generation | undefined }>;
}

interface PersonDossierProps {
  personId: string;
  origin: LensOrigin;
  /** True once the close animation should play; `onClosed` follows when it ends. */
  closing: boolean;
  /** Walking to a relative re-forms the lens from that satellite's own circle. */
  onWalkTo: (personId: string, origin: LensOrigin) => void;
  onClose: () => void;
  onClosed: () => void;
}

/**
 * The lens — a person opened out of the tree.
 *
 * A circle grows from the exact node that was clicked until it fills the
 * screen, the tree behind it pulls back and goes soft, and the person's file
 * assembles inside: the portrait flies out of the tree into place, then the
 * name, the story, the milestones and the family arrive in layers. Closing runs
 * it backwards, collapsing into the same node.
 *
 * Rendered into `document.body` on purpose. Being `position: fixed` inside a
 * screen that carries its own filters and transforms would make it a child of
 * the wrong containing block, and it has to sit above the app chrome.
 */
export function PersonDossier({
  personId,
  origin,
  closing,
  onWalkTo,
  onClose,
  onClosed,
}: PersonDossierProps): React.JSX.Element | null {
  const { data: tree } = useTree();
  const { data: detail } = usePerson(personId);
  const { data: pieces } = useArchive(undefined, personId);
  const { data: session } = useSession();

  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const portraitRef = useRef<HTMLDivElement | null>(null);

  // The portrait's diameter has to be a number, not a CSS clamp: the FLIP
  // measures it and the avatar sizes its own ring from it.
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 560px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 560px)');
    const sync = () => setCompact(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const portraitSize = compact ? 140 : 188;

  // The tree's copy renders immediately; the detail request only adds
  // milestones, so nothing has to wait on the network to open.
  const summary = tree?.people.find((p) => p.id === personId);
  const person = detail ?? summary;
  const generation = person
    ? tree?.generations.find((g) => g.id === person.generationId)
    : undefined;

  const user = session?.user ?? null;
  const isMe = user?.personId === personId;

  /* ------------------------------------------------------------------ kin */

  const kin = useMemo<KinGroup[]>(() => {
    if (!tree) return [];
    const byId = new Map(tree.people.map((p) => [p.id, p]));
    const parents: Person[] = [];
    const partners: Person[] = [];
    const children: Person[] = [];

    for (const rel of tree.relationships) {
      if (rel.type === 'parent') {
        if (rel.relatedPersonId === personId) {
          const parent = byId.get(rel.personId);
          if (parent) parents.push(parent);
        } else if (rel.personId === personId) {
          const child = byId.get(rel.relatedPersonId);
          if (child) children.push(child);
        }
      } else {
        const otherId =
          rel.personId === personId
            ? rel.relatedPersonId
            : rel.relatedPersonId === personId
              ? rel.personId
              : null;
        if (otherId) {
          const partner = byId.get(otherId);
          if (partner) partners.push(partner);
        }
      }
    }

    // Left-to-right on the canvas, so the satellites read in the same order as
    // the row they came from.
    const inTreeOrder = (a: Person, b: Person) => a.x - b.x;
    const withGeneration = (list: Person[]) =>
      [...list].sort(inTreeOrder).map((p) => ({
        person: p,
        generation: tree.generations.find((g) => g.id === p.generationId),
      }));

    return (
      [
        { key: 'parents', label: 'הורים', members: withGeneration(parents) },
        { key: 'partners', label: 'בני זוג', members: withGeneration(partners) },
        { key: 'children', label: 'ילדים', members: withGeneration(children) },
      ] as KinGroup[]
    ).filter((group) => group.members.length > 0);
  }, [personId, tree]);

  /* ----------------------------------------------------------------- FLIP */

  // Measure the portrait where it comes to rest, then play it back from the
  // node's position on the tree. Runs before paint, so the portrait is never
  // seen in its resting place first.
  const [flip, setFlip] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    const element = portraitRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;
    setFlip({
      '--dx': `${Math.round(origin.x - (rect.left + rect.width / 2))}px`,
      '--dy': `${Math.round(origin.y - (rect.top + rect.height / 2))}px`,
      '--ds': ((origin.r0 * 2) / rect.width).toFixed(4),
    } as React.CSSProperties);
  }, [origin, personId]);

  /* ------------------------------------------------------------- dismissal */

  useEffect(() => {
    closeRef.current?.focus();
  }, [personId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /*
   * The disc's flight gets the main thread to itself. Mounting the family,
   * the story and the milestone cards costs a couple of hundred milliseconds
   * on a mid-range phone, and doing it on the tap froze the animation's first
   * frames — so only the hero rides along, and the rest of the file mounts
   * the moment the disc lands. Their entrance delays already placed them
   * after that moment visually; now the work happens there too.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // Fallback in case the animationend event is ever lost.
    const timer = window.setTimeout(() => setSettled(true), 900);
    return () => window.clearTimeout(timer);
  }, [personId]);

  const handleAnimationEnd = useCallback(
    (event: React.AnimationEvent<HTMLElement>) => {
      // Content layers bubble their own animationend; only the disc — the
      // circle itself — decides when the overlay is finished.
      if (event.target !== event.currentTarget) return;
      if (closing) onClosed();
      else setSettled(true);
    },
    [closing, onClosed],
  );

  const walkTo = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, id: string) => {
      const circle = event.currentTarget.querySelector('[data-lens-anchor]');
      onWalkTo(id, originFromElement(circle ?? event.currentTarget));
    },
    [onWalkTo],
  );

  if (!person) return null;

  const milestones = detail?.milestones ?? [];
  const relics = pieces ?? [];
  const firstName = givenName(person.fullName);

  return createPortal(
    <div
      className={closing ? `${styles.lens} ${styles.lensClosing}` : styles.lens}
      style={
        {
          ...generationVars(generation),
          '--ox': `${Math.round(origin.x)}px`,
          '--oy': `${Math.round(origin.y)}px`,
          '--r0': `${Math.round(origin.r0)}px`,
          '--r1': `${Math.ceil(origin.r1)}px`,
          // The disc's starting scale: the touched circle over the covering
          // circle. Scaling a real element is the one reveal every engine
          // runs on the GPU.
          '--s0': Math.max(origin.r0 / origin.r1, 0.001).toFixed(5),
        } as React.CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <span
        className={styles.disc}
        aria-hidden="true"
        onAnimationEnd={handleAnimationEnd}
      />

      <span className={styles.monogramWrap} aria-hidden="true">
        <span className={styles.monogram}>{person.initial}</span>
      </span>

      <button type="button" className={styles.close} onClick={onClose} ref={closeRef}>
        <span aria-hidden="true">×</span>
        <span className="visually-hidden">סגירת התיק</span>
      </button>

      <div className={styles.sheet}>
        <div className={styles.stage} onClick={(event) => event.stopPropagation()}>
          <div className={styles.hero}>
            <div
              className={flip ? `${styles.portrait} ${styles.portraitLanding}` : styles.portrait}
              style={{ ...flip, width: portraitSize, height: portraitSize }}
              ref={portraitRef}
            >
              {/* The portrait is itself the way into the full story — touching
                  the person, not a labelled control. */}
              <Link
                to={`/person/${person.id}`}
                className={styles.portraitLink}
                aria-label={`לסיפור המלא של ${givenName(person.fullName)}`}
              >
                <Avatar
                  person={person}
                  generation={generation}
                  size={portraitSize}
                  filled={isMe}
                />
              </Link>
            </div>

            <p className={styles.cohort} style={{ '--l': 0 } as React.CSSProperties}>
              {[generation?.name, person.branch].filter(Boolean).join(' · ') || 'בן משפחה'}
            </p>

            <h2 className={styles.name} id={titleId} style={{ '--l': 1 } as React.CSSProperties}>
              {person.fullName}
            </h2>

            <div className={styles.tags} style={{ '--l': 2 } as React.CSSProperties}>
              <Years className={styles.tagYears}>{person.lifeSpan || 'שנים לא ידועות'}</Years>
              {person.place && <span className={styles.tagPlace}>{person.place}</span>}
              {isMe && <span className={styles.tagMe}>זה אתם</span>}
            </div>

            <div className={styles.actions} style={{ '--l': 3 } as React.CSSProperties}>
              <Link to={`/person/${person.id}`} className={styles.primaryAction}>
                לסיפור המלא ←
              </Link>
              {user && (
                <Link
                  to={`/edit/people/${person.id}`}
                  className={styles.iconAction}
                  aria-label={`עריכת הפרטים של ${givenName(person.fullName)}`}
                  title="עריכה"
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                    <path
                      d="M4 20l1.2-4.2L15.8 5.2a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              )}
            </div>

          </div>

          {/*
            A sibling of the hero rather than a child of it, so that on a phone —
            where the file becomes one column — the family lands after the story
            and the milestones instead of pushing them below the fold.
          */}
          {settled && kin.length > 0 && (
            <div className={styles.kin} style={{ '--l': 4 } as React.CSSProperties}>
              <p className={styles.kinHint}>המשיכו במשפחה</p>
              {kin.map((group, groupIndex) => (
                <div key={group.key} className={styles.kinGroup}>
                  <span className={styles.kinLabel}>{group.label}</span>
                  <div className={styles.kinRow}>
                    {group.members.map((member, index) => (
                      <button
                        key={member.person.id}
                        type="button"
                        className={styles.satellite}
                        style={
                          {
                            '--o': groupIndex * 3 + index,
                            ...generationVars(member.generation),
                          } as React.CSSProperties
                        }
                        onClick={(event) => walkTo(event, member.person.id)}
                      >
                        <span className={styles.satelliteDisc} data-lens-anchor>
                          <Avatar
                            person={member.person}
                            generation={member.generation}
                            size={52}
                          />
                        </span>
                        <span className={styles.satelliteName}>
                          {givenName(member.person.fullName)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.body}>
            {settled && person.story && (
              <p className={styles.story} style={{ '--l': 2 } as React.CSSProperties}>
                {person.story}
              </p>
            )}

            {settled && milestones.length > 0 && (
              <section className={styles.track} style={{ '--l': 3 } as React.CSSProperties}>
                <h3 className={styles.sectionTitle}>התחנות של {firstName}</h3>
                <div className={styles.trackRail}>
                  {milestones.map((milestone, index) => (
                    <article
                      key={milestone.id}
                      className={styles.milestone}
                      style={
                        {
                          '--i': index,
                          '--rest-tilt': restTilt(milestone.id, 1.2),
                        } as React.CSSProperties
                      }
                    >
                      <Years className={styles.milestoneYear}>{milestone.yearLabel}</Years>
                      <h4 className={styles.milestoneTitle}>{milestone.title}</h4>
                      {milestone.body && (
                        <p className={styles.milestoneBody}>{milestone.body}</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {settled && relics.length > 0 && (
              <section className={styles.relics} style={{ '--l': 4 } as React.CSSProperties}>
                <h3 className={styles.sectionTitle}>אוצרות של {firstName}</h3>
                <div className={styles.relicRow}>
                  {relics.map((piece, index) => {
                    const tone = kindColours(piece.kind);
                    const src = mediaUrl(piece.mediaId);
                    return (
                      <Link
                        key={piece.id}
                        to={`/archive?kind=${encodeURIComponent(piece.kind)}`}
                        className={styles.relic}
                        style={
                          {
                            '--tone-wash': tone.wash,
                            '--tone-text': tone.text,
                            '--rest-tilt': restTilt(piece.id),
                            '--i': index,
                          } as React.CSSProperties
                        }
                      >
                        <span className={styles.relicThumb}>
                          {src && piece.kind !== 'קול' ? (
                            <img src={src} alt={piece.title} loading="lazy" />
                          ) : (
                            piece.kind.charAt(0)
                          )}
                        </span>
                        <span className={styles.relicTitle}>{piece.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
