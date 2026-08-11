import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { ArchiveItem } from '../../../shared/types.ts';

/**
 * The search sheet and the treasure editor are opened from several places —
 * the header, the archive toolbar, a person's card in the workshop. Holding
 * their state here keeps a single instance of each mounted at the app root
 * instead of one per screen, and means creating and editing a treasure go
 * through exactly the same component wherever they are started from.
 */

export interface TreasurePrefill {
  /** Given name shown pre-selected in the "whose moment is this?" chips. */
  subject?: string;
  personId?: string | null;
}

interface UiState {
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;

  treasureOpen: boolean;
  /** The item being edited, or null when adding a new one. */
  treasureItem: ArchiveItem | null;
  treasurePrefill: TreasurePrefill;
  /** Opens the sheet in "add" mode. */
  openAddTreasure: (prefill?: TreasurePrefill) => void;
  /** Opens the same sheet in "edit" mode, pre-filled from an existing item. */
  openEditTreasure: (item: ArchiveItem) => void;
  closeTreasure: () => void;

  /** The item being read in the full-size viewer, or null when closed. */
  viewerItem: ArchiveItem | null;
  /** Opens the read-only viewer: the image large, the story in full. */
  openViewTreasure: (item: ArchiveItem) => void;
  closeViewer: () => void;

  /** The "how are these two related?" tool. */
  kinshipOpen: boolean;
  openKinship: () => void;
  closeKinship: () => void;
}

const UiContext = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false);
  const [treasureOpen, setTreasureOpen] = useState(false);
  const [treasureItem, setTreasureItem] = useState<ArchiveItem | null>(null);
  const [treasurePrefill, setTreasurePrefill] = useState<TreasurePrefill>({});

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const [viewerItem, setViewerItem] = useState<ArchiveItem | null>(null);

  const openAddTreasure = useCallback((prefill: TreasurePrefill = {}) => {
    setTreasurePrefill(prefill);
    setTreasureItem(null);
    setSearchOpen(false);
    setViewerItem(null);
    setTreasureOpen(true);
  }, []);

  const openEditTreasure = useCallback((item: ArchiveItem) => {
    setTreasurePrefill({});
    setTreasureItem(item);
    setSearchOpen(false);
    setViewerItem(null);
    setTreasureOpen(true);
  }, []);

  const closeTreasure = useCallback(() => setTreasureOpen(false), []);

  const openViewTreasure = useCallback((item: ArchiveItem) => {
    setSearchOpen(false);
    setTreasureOpen(false);
    setViewerItem(item);
  }, []);

  const closeViewer = useCallback(() => setViewerItem(null), []);

  const [kinshipOpen, setKinshipOpen] = useState(false);
  const openKinship = useCallback(() => {
    setSearchOpen(false);
    setKinshipOpen(true);
  }, []);
  const closeKinship = useCallback(() => setKinshipOpen(false), []);

  const value = useMemo<UiState>(
    () => ({
      searchOpen,
      openSearch,
      closeSearch,
      treasureOpen,
      treasureItem,
      treasurePrefill,
      openAddTreasure,
      openEditTreasure,
      closeTreasure,
      viewerItem,
      openViewTreasure,
      closeViewer,
      kinshipOpen,
      openKinship,
      closeKinship,
    }),
    [
      closeKinship,
      closeSearch,
      closeTreasure,
      closeViewer,
      kinshipOpen,
      openAddTreasure,
      openEditTreasure,
      openKinship,
      openSearch,
      openViewTreasure,
      searchOpen,
      treasureItem,
      treasureOpen,
      treasurePrefill,
      viewerItem,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used inside <UiProvider>');
  return context;
}
