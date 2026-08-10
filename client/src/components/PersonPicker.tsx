import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { Generation, Person } from '../../../shared/types.ts';

import { cohortLine } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';
import { Years } from './Years.tsx';
import styles from './PersonPicker.module.css';

/**
 * How many matches are rendered at once. A family archive can hold hundreds of
 * records; painting them all into the list buys nothing — nobody scrolls past
 * this many, they type another letter instead. The footer says how many more
 * there are so the cap never reads as "that's everyone".
 */
const MAX_VISIBLE = 30;

interface PersonPickerProps {
  /** Everyone that may be offered. Filtering out ineligible people is the caller's job. */
  people: Person[];
  generations: Generation[];
  /** Selected person id, or '' for none. */
  value: string;
  onChange: (personId: string) => void;
  /** Announced as the field's name. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Search-normalised: lowercase, and gershayim/geresh stripped so "ליבוביץ" finds "ליבוביץ׳". */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[׳״'"]/g, '');
}

/**
 * A searchable replacement for the family-member <select>.
 *
 * A dropdown of the whole family stops working once the family outgrows a
 * screenful — finding one person in two hundred options is scrolling, not
 * choosing. This is a combobox instead: type a few letters of a name, a place
 * or a branch, pick from the handful that match. Results carry the same
 * avatar and cohort colour as everywhere else, so the person you are about to
 * link looks like the person you mean.
 */
export function PersonPicker({
  people,
  generations,
  value,
  onChange,
  label,
  placeholder = 'חפשו לפי שם, מקום או ענף…',
  disabled = false,
}: PersonPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeOptionRef = useRef<HTMLLIElement | null>(null);

  const generationById = useMemo(
    () => new Map(generations.map((g) => [g.id, g])),
    [generations],
  );

  const selected = value ? people.find((p) => p.id === value) : undefined;

  const matches = useMemo(() => {
    const needle = normalise(query.trim());
    const pool = needle
      ? people.filter((person) => {
          const haystack = normalise(
            `${person.fullName} ${person.place} ${person.branch ?? ''}`,
          );
          return haystack.includes(needle);
        })
      : people;
    // Names that *start* with what was typed come first — that is almost
    // always the person being looked for.
    return [...pool].sort((a, b) => {
      if (needle) {
        const aStarts = normalise(a.fullName).startsWith(needle) ? 0 : 1;
        const bStarts = normalise(b.fullName).startsWith(needle) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
      }
      return a.fullName.localeCompare(b.fullName, 'he');
    });
  }, [people, query]);

  const visible = matches.slice(0, MAX_VISIBLE);
  const hidden = matches.length - visible.length;

  // Typing again narrows the list, so the highlight resets to the best match.
  useEffect(() => setActiveIndex(0), [query]);

  // Keep the highlighted row in view as arrow keys move it.
  useEffect(() => {
    if (open) activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // A click or focus landing anywhere outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(person: Person): void {
    onChange(person.id);
    setQuery('');
    setOpen(false);
  }

  function clear(): void {
    onChange('');
    setQuery('');
    setOpen(false);
    // Hand focus back to the input so the next search starts immediately.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      const person = visible[activeIndex];
      if (person) choose(person);
      return;
    }
    if (event.key === 'Escape' && open) {
      // Swallow it so a surrounding Sheet does not close as well.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  }

  if (selected) {
    const generation = generationById.get(selected.generationId);
    return (
      <div className={styles.root} ref={rootRef}>
        <div className={styles.selected}>
          <Avatar person={selected} generation={generation} size={36} />
          <span className={styles.selectedText}>
            <span className={styles.selectedName}>{selected.fullName}</span>
            <span className={styles.selectedMeta}>
              <Years>{selected.lifeSpan || cohortLine(selected, generation)}</Years>
            </span>
          </span>
          {!disabled && (
            <button
              type="button"
              className={styles.clear}
              onClick={clear}
              aria-label={`ניקוי הבחירה ב${selected.fullName}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="combobox"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && visible[activeIndex] ? `${listboxId}-${visible[activeIndex].id}` : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
        />
        <span className={styles.searchIcon} aria-hidden="true">
          ⌕
        </span>
      </div>

      {open && (
        <ul className={styles.list} role="listbox" id={listboxId} aria-label={label}>
          {visible.map((person, index) => {
            const generation = generationById.get(person.generationId);
            const active = index === activeIndex;
            return (
              <li
                key={person.id}
                id={`${listboxId}-${person.id}`}
                ref={active ? activeOptionRef : null}
                role="option"
                aria-selected={active}
                className={active ? `${styles.option} ${styles.optionActive}` : styles.option}
                style={{ '--option-tone': generation?.color ?? 'var(--border)' } as React.CSSProperties}
                // mousedown, not click: click fires after blur has already
                // closed the list, and the selection is lost.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(person);
                }}
                onMouseMove={() => setActiveIndex(index)}
              >
                <Avatar person={person} generation={generation} size={34} />
                <span className={styles.optionText}>
                  <span className={styles.optionName}>{person.fullName}</span>
                  <span className={styles.optionMeta}>
                    <Years>{person.lifeSpan || '—'}</Years>
                    {person.place && ` · ${person.place}`}
                  </span>
                </span>
                <span
                  className={styles.optionDot}
                  style={{ background: generation?.color ?? 'var(--border)' }}
                  aria-hidden="true"
                />
              </li>
            );
          })}

          {visible.length === 0 && (
            <li className={styles.empty}>לא מצאנו — נסו שם, מקום או ענף אחרים</li>
          )}

          {hidden > 0 && (
            <li className={styles.more} aria-live="polite">
              ועוד {hidden} — הקלידו כדי לצמצם
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
