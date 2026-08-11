import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useTree } from '../api/hooks.ts';
import { describeKinship, type Kinship } from '../lib/kinship.ts';
import { givenName } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { Avatar } from './Avatar.tsx';
import { PersonPicker } from './PersonPicker.tsx';
import { Sheet } from './Sheet.tsx';
import styles from './KinshipSheet.module.css';

/**
 * "How are these two related?"
 *
 * Two people in, one sentence out. The answer is laid out as a chain rather
 * than a paragraph — name, relation, name — because that reads at a glance on a
 * phone and needs no pronoun, which matters when the records carry no gender.
 *
 * The route between them is shown underneath. A kinship term is only as good as
 * the tree it came from, and a family correcting its own records should be able
 * to see the line the answer was read off and spot the link that is wrong.
 */
export function KinshipSheet(): React.JSX.Element {
  const { kinshipOpen, closeKinship } = useUi();
  const { data: tree } = useTree();

  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [result, setResult] = useState<Kinship | null | 'none'>(null);

  // Each opening starts fresh; a stale pair of names is more confusing than an
  // empty form.
  useEffect(() => {
    if (!kinshipOpen) return;
    setAId('');
    setBId('');
    setResult(null);
  }, [kinshipOpen]);

  const people = useMemo(() => tree?.people ?? [], [tree]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const generationById = useMemo(
    () => new Map((tree?.generations ?? []).map((g) => [g.id, g])),
    [tree],
  );

  const a = aId ? personById.get(aId) : undefined;
  const b = bId ? personById.get(bId) : undefined;
  const ready = Boolean(a && b && aId !== bId);

  function compute(): void {
    if (!ready || !tree) return;
    setResult(describeKinship(tree.people, tree.relationships, aId, bId) ?? 'none');
  }

  function swap(): void {
    setAId(bId);
    setBId(aId);
    setResult(null);
  }

  return (
    <Sheet open={kinshipOpen} onClose={closeKinship} title="מה הקשר?">
      <div className={styles.body}>
        <p className={styles.intro}>
          בחרו שני בני משפחה, ונחשב איך הם קשורים זה לזה.
        </p>

        <div className={styles.pickers}>
          <div className={styles.field}>
            <span className={styles.label}>מי</span>
            <PersonPicker
              people={people.filter((p) => p.id !== bId)}
              generations={tree?.generations ?? []}
              value={aId}
              onChange={(id) => {
                setAId(id);
                setResult(null);
              }}
              label="בן משפחה ראשון"
            />
          </div>

          <button
            type="button"
            className={styles.swap}
            onClick={swap}
            disabled={!aId && !bId}
            aria-label="החלפת הסדר בין השניים"
          >
            ⇅
          </button>

          <div className={styles.field}>
            <span className={styles.label}>ומי</span>
            <PersonPicker
              people={people.filter((p) => p.id !== aId)}
              generations={tree?.generations ?? []}
              value={bId}
              onChange={(id) => {
                setBId(id);
                setResult(null);
              }}
              label="בן משפחה שני"
            />
          </div>
        </div>

        <button type="button" className={styles.ask} onClick={compute} disabled={!ready}>
          מה הקשר ביניהם?
        </button>

        {result === 'none' && a && b && (
          <p className={styles.noLink}>
            לא מצאנו קשר בין {givenName(a.fullName)} ל{givenName(b.fullName)} באילן. אם הם
            בני משפחה, כנראה חסר קישור — אפשר להוסיף אותו בכרטיס של אחד מהם.
          </p>
        )}

        {result && result !== 'none' && a && b && (
          <div className={styles.answer}>
            <Link to={`/person/${a.id}`} className={styles.who} onClick={closeKinship}>
              <Avatar person={a} generation={generationById.get(a.generationId)} size={44} />
              <span className={styles.whoName}>{a.fullName}</span>
            </Link>

            <p className={styles.relation}>
              <span className={styles.relationArrow} aria-hidden="true">
                ↓
              </span>
              {result.label}
            </p>

            <Link to={`/person/${b.id}`} className={styles.who} onClick={closeKinship}>
              <Avatar person={b} generation={generationById.get(b.generationId)} size={44} />
              <span className={styles.whoName}>{b.fullName}</span>
            </Link>

            {result.detail && <p className={styles.detail}>{result.detail}</p>}

            {result.path.length > 0 && (
              <div className={styles.route}>
                <p className={styles.routeLabel}>הדרך באילן</p>
                <ol className={styles.routeList}>
                  <li className={styles.routeStep}>
                    <span className={styles.routeName}>{givenName(a.fullName)}</span>
                  </li>
                  {result.path.map((step, index) => {
                    const stepPerson = personById.get(step.personId);
                    return (
                      <li key={`${step.personId}-${index}`} className={styles.routeStep}>
                        <span className={styles.routeVia}>{step.via}</span>
                        <span className={styles.routeName}>
                          {stepPerson ? givenName(stepPerson.fullName) : '—'}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
