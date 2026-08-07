import { ApiError } from '../api/client.ts';
import styles from './Feedback.module.css';

/** The four-dot mark, used as a brand-consistent loading indicator. */
export function LoadingDots(): React.JSX.Element {
  return (
    <span className={styles.dots} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function LoadingScreen({ label = 'טוענים את הארכיון…' }: { label?: string }): React.JSX.Element {
  return (
    <div className={styles.centre} role="status" aria-live="polite">
      <LoadingDots />
      <p className={styles.message}>{label}</p>
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

/**
 * Shows the API's own Hebrew message when there is one. A thrown value that is
 * not an ApiError has no user-facing text worth trusting, so it gets a generic
 * line instead of leaking an internal string.
 */
export function ErrorState({ error, onRetry, title }: ErrorStateProps): React.JSX.Element {
  const message =
    error instanceof ApiError
      ? error.message
      : 'משהו השתבש בטעינה. בדקו את החיבור ונסו שוב.';

  return (
    <div className={styles.centre} role="alert">
      <h2 className={styles.title}>{title ?? 'לא הצלחנו לטעון'}</h2>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.action} onClick={onRetry}>
          נסו שוב
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className={styles.centre}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.message}>{message}</p>
      {actionLabel && onAction && (
        <button type="button" className={styles.action} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Compact error banner for inline use inside forms. */
export function InlineError({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className={styles.inline} role="alert">
      {children}
    </p>
  );
}
