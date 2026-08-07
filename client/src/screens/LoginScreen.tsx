import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Generation } from '../../../shared/types.ts';

import { useJoin, useSession, useTree } from '../api/hooks.ts';
import { Avatar } from '../components/Avatar.tsx';
import { InlineError, LoadingScreen } from '../components/Feedback.tsx';
import { Years } from '../components/Years.tsx';
import { cohortLine, generationVars, givenName } from '../lib/format.ts';
import styles from './LoginScreen.module.css';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Two-step join, as designed: type a name, and either claim a node that is
 * already on the tree or continue as a new branch by giving a birth year. The
 * year is what assigns the cohort colour, which is why it is asked for at all.
 */
export function LoginScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: tree, isPending } = useTree();
  const { data: session } = useSession();
  const join = useJoin();

  const [step, setStep] = useState<'name' | 'year'>('name');
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [invite, setInvite] = useState('');

  const query = name.trim();
  const inviteRequired = session?.inviteRequired ?? false;

  const matches = useMemo(() => {
    if (!query || !tree) return [];
    return tree.people.filter((person) => person.fullName.includes(query));
  }, [query, tree]);

  const yearValue = Number(year);
  const yearValid = /^\d{4}$/.test(year) && yearValue >= 1900 && yearValue <= CURRENT_YEAR;

  const cohort: Generation | undefined = yearValid
    ? tree?.generations.find((g) => yearValue >= g.yearFrom && yearValue <= g.yearTo)
    : undefined;

  if (isPending) return <LoadingScreen />;

  const submit = (personId: string | null) => {
    join.mutate(
      {
        displayName: query,
        birthYear: personId ? null : yearValue,
        personId,
        ...(inviteRequired && { inviteCode: invite }),
      },
      {
        onSuccess: (result) => {
          const target = result.user?.personId;
          navigate(target ? `/tree?focus=${encodeURIComponent(target)}` : '/');
        },
      },
    );
  };

  return (
    <div className={styles.screen}>
      <div className={styles.inner}>
        <span className={styles.mark} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>

        {step === 'name' ? (
          <>
            <h1 className={styles.question}>מה השם שלכם?</h1>

            <input
              className={styles.nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const first = matches[0];
                if (first) submit(first.id);
                else if (query) setStep('year');
              }}
              placeholder="כתבו שם…"
              aria-label="השם שלכם"
              autoFocus
              maxLength={60}
            />

            <div className={styles.suggestions}>
              {matches.map((person, index) => {
                const generation = tree?.generations.find((g) => g.id === person.generationId);
                return (
                  <button
                    key={person.id}
                    type="button"
                    className={styles.suggestion}
                    style={{ '--delay': `${(index * 0.05).toFixed(2)}s` } as React.CSSProperties}
                    onClick={() => submit(person.id)}
                    disabled={join.isPending}
                  >
                    <Avatar person={person} generation={generation} size={38} />
                    <span>
                      <span className={styles.suggestionName}>{givenName(person.fullName)}</span>
                      <span className={styles.suggestionMeta}>
                        {cohortLine(person, generation)}
                      </span>
                    </span>
                  </button>
                );
              })}

              {query && matches.length === 0 && (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => setStep('year')}
                >
                  נעים להכיר, {query} — המשיכו ←
                </button>
              )}
            </div>

            {join.error && (
              <div className={styles.error}>
                <InlineError>{join.error.message}</InlineError>
              </div>
            )}

            <div>
              <button
                type="button"
                className={styles.quiet}
                onClick={() => navigate('/')}
              >
                רק מסתכלים? המשיכו כאורחים
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className={styles.question}>נעים להכיר, {query}!</h1>
            <p className={styles.lead}>
              באיזו שנה נולדתם? לפי זה תקבלו את צבע הדור שלכם באילן.
            </p>

            <input
              className={styles.yearInput}
              value={year}
              // Digits only, so the cohort lookup never sees junk.
              onChange={(event) => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && yearValid && (!inviteRequired || invite)) {
                  event.preventDefault();
                  submit(null);
                }
              }}
              placeholder={`למשל ${CURRENT_YEAR - 32}`}
              inputMode="numeric"
              aria-label="שנת לידה"
              autoFocus
            />

            {inviteRequired && (
              <div className={styles.inviteRow}>
                <input
                  className={styles.nameInput}
                  value={invite}
                  onChange={(event) => setInvite(event.target.value)}
                  placeholder="קוד ההזמנה המשפחתי"
                  aria-label="קוד הזמנה"
                  type="password"
                  autoComplete="off"
                />
              </div>
            )}

            <div className={styles.yearBlock}>
              {cohort && (
                <>
                  <span className={styles.cohort} style={generationVars(cohort)}>
                    <span className={styles.cohortDot} aria-hidden="true" />
                    <span className={styles.cohortText}>
                      {cohort.name} · <Years>{cohort.rangeLabel}</Years>
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.joinButton}
                    style={generationVars(cohort)}
                    onClick={() => submit(null)}
                    disabled={join.isPending || (inviteRequired && !invite)}
                  >
                    {join.isPending ? 'מצרפים אתכם…' : 'הצטרפו לאילן ←'}
                  </button>
                </>
              )}
            </div>

            {join.error && (
              <div className={styles.error}>
                <InlineError>{join.error.message}</InlineError>
              </div>
            )}

            <div>
              <button type="button" className={styles.plain} onClick={() => setStep('name')}>
                → חזרה לשם
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
