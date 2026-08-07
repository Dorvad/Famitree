import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The search sheet and the add-treasure flow are opened from several places —
 * the header, the archive toolbar, a person page. Holding their state here
 * keeps a single instance of each mounted at the app root instead of one per
 * screen.
 */

export interface AddTreasurePrefill {
  /** Given name shown pre-selected in the "whose moment is this?" chips. */
  subject?: string;
  personId?: string | null;
}

interface UiState {
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;

  addOpen: boolean;
  addPrefill: AddTreasurePrefill;
  openAddTreasure: (prefill?: AddTreasurePrefill) => void;
  closeAddTreasure: () => void;
}

const UiContext = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState<AddTreasurePrefill>({});

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const openAddTreasure = useCallback((prefill: AddTreasurePrefill = {}) => {
    setAddPrefill(prefill);
    setSearchOpen(false);
    setAddOpen(true);
  }, []);
  const closeAddTreasure = useCallback(() => setAddOpen(false), []);

  const value = useMemo<UiState>(
    () => ({
      searchOpen,
      openSearch,
      closeSearch,
      addOpen,
      addPrefill,
      openAddTreasure,
      closeAddTreasure,
    }),
    [addOpen, addPrefill, closeAddTreasure, closeSearch, openAddTreasure, openSearch, searchOpen],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used inside <UiProvider>');
  return context;
}
