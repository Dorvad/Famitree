import { Link, NavLink, useLocation } from 'react-router-dom';

import { useSession, useTree } from '../api/hooks.ts';
import { givenName } from '../lib/format.ts';
import { useUi } from '../state/ui.tsx';
import { Avatar } from './Avatar.tsx';
import styles from './AppShell.module.css';

const TABS = [
  { to: '/', label: 'האילן', end: true },
  { to: '/timeline', label: 'ציר זמן', end: false },
  { to: '/archive', label: 'הארכיון', end: false },
] as const;

/**
 * The workshop's tab, kept for invite-mode deployments where signing in is
 * what earns it.
 *
 * On an open archive it is deliberately absent: everyone can edit, so a tab
 * saying so would sit over the tree for every visitor who only came to look.
 * The way in is the menu, one button away — present, not advertised.
 */
const EDIT_TAB = { to: '/edit', label: 'עריכה' } as const;

export function AppShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { openSearch } = useUi();
  const { data: session } = useSession();
  const { data: tree } = useTree();
  const location = useLocation();

  const user = session?.user ?? null;
  const openArchive = session?.open ?? false;
  const person = user?.personId
    ? tree?.people.find((p) => p.id === user.personId)
    : undefined;
  const generation = person
    ? tree?.generations.find((g) => g.id === person.generationId)
    : undefined;

  // The join flow is a full-page moment in the design; the chrome would only
  // compete with it.
  const bare = location.pathname === '/login';

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        דלגו לתוכן
      </a>

      {!bare && (
        <header className={styles.header}>
          <Link to="/" className={styles.brand} aria-label="שורשים — לדף הבית">
            <span className={styles.mark} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className={styles.wordmark}>שורשים</span>
          </Link>

          <nav className={styles.tabs} aria-label="ניווט ראשי">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
                }
              >
                {tab.label}
              </NavLink>
            ))}
            {user && !openArchive && (
              <NavLink
                to={EDIT_TAB.to}
                className={({ isActive }) =>
                  isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
                }
              >
                {EDIT_TAB.label}
              </NavLink>
            )}
          </nav>

          <div className={styles.actions}>
            {/* An open archive has no accounts, so the header names nobody. */}
            {openArchive ? null : user ? (
              person ? (
                <Link to={`/person/${person.id}`} className={styles.identity}>
                  <Avatar person={person} generation={generation} size={30} />
                  {givenName(user.displayName)}
                </Link>
              ) : (
                <span className={styles.identity}>{givenName(user.displayName)}</span>
              )
            ) : (
              <Link to="/login" className={styles.joinLink}>
                מי אני?
              </Link>
            )}

            <button
              type="button"
              className={styles.menuButton}
              onClick={openSearch}
              aria-label="חיפוש ותפריט"
            >
              <span />
              <span />
              <span />
              <span />
            </button>
          </div>
        </header>
      )}

      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}

/** Wrapper for screens whose content scrolls inside the shell's main area. */
export function ScrollArea({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={styles.scrollArea}>{children}</div>;
}
