import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import styles from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Announced as the dialog's name. Rendered visually unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  showCloseButton?: boolean;
  children: React.ReactNode;
}

/**
 * Modal bottom sheet — the design's primary overlay pattern.
 *
 * Handles the things a hand-rolled overlay usually misses: Escape to dismiss,
 * a locked background, focus moved in on open and restored on close, and focus
 * kept inside while it is open.
 */
export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  showCloseButton = true,
  children,
}: SheetProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    // Freeze the page behind the sheet without the content jumping as the
    // scrollbar disappears.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingInlineEnd;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`;

    const panel = panelRef.current;
    // Prefer the first real control; fall back to the panel so screen readers
    // land somewhere sensible.
    const focusable = panel?.querySelector<HTMLElement>(
      'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const targets = [
        ...panel.querySelectorAll<HTMLElement>(
          'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingInlineEnd = previousPadding;
      restoreFocusTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.scrim}
      onPointerDown={(event) => {
        // Only a press that starts on the scrim itself dismisses; a drag that
        // ends there after starting inside must not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <h2 id={titleId} className={hideTitle ? 'visually-hidden' : undefined}>
          {title}
        </h2>
        {showCloseButton && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="סגירה">
            ×
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
