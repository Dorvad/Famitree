/**
 * Isolates a year value from the surrounding right-to-left text.
 *
 * A range like "1924–2009" contains no strong directional character, so the
 * bidi algorithm resolves the neutral dash against the RTL paragraph and the
 * two numbers swap — the page shows "2009–1924". `dir="auto"` fixes it without
 * breaking the mixed values the archive also stores: it picks the direction
 * from the first strong character, so "1924–2009" resolves LTR while
 * "נ׳ 1985" and "סביב 1900" stay RTL and read correctly.
 */
export function Years({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span dir="auto" className={className} style={{ unicodeBidi: 'isolate' }}>
      {children}
    </span>
  );
}
