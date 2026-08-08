import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { TreasureSheet } from './components/TreasureSheet.tsx';
import { AppShell } from './components/AppShell.tsx';
import { LoadingScreen } from './components/Feedback.tsx';
import { SearchSheet } from './components/SearchSheet.tsx';
import { ArchiveScreen } from './screens/ArchiveScreen.tsx';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { NotFoundScreen } from './screens/NotFoundScreen.tsx';
import { PersonScreen } from './screens/PersonScreen.tsx';
import { UiProvider } from './state/ui.tsx';

// The two canvas screens carry the pan/zoom machinery and their own layout
// maths, and neither is the usual entry point — worth splitting out.
const TreeScreen = lazy(() =>
  import('./screens/TreeScreen.tsx').then((m) => ({ default: m.TreeScreen })),
);
const TimelineScreen = lazy(() =>
  import('./screens/TimelineScreen.tsx').then((m) => ({ default: m.TimelineScreen })),
);
// The workshop is only ever opened deliberately, and carries the whole editing
// surface with it — a natural split point.
const EditScreen = lazy(() =>
  import('./screens/EditScreen.tsx').then((m) => ({ default: m.EditScreen })),
);

export function App(): React.JSX.Element {
  return (
    <UiProvider>
      <AppShell>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/tree" element={<TreeScreen />} />
            <Route path="/timeline" element={<TimelineScreen />} />
            <Route path="/archive" element={<ArchiveScreen />} />
            <Route path="/person/:id" element={<PersonScreen />} />
            <Route path="/edit" element={<EditScreen />} />
            <Route path="/edit/:tab" element={<EditScreen />} />
            <Route path="/edit/:tab/:id" element={<EditScreen />} />
            {/* The design called this screen "the map"; keep the old path working. */}
            <Route path="/map" element={<Navigate to="/tree" replace />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
      </AppShell>

      {/* Mounted once at the root so any screen can open them. */}
      <SearchSheet />
      <TreasureSheet />
    </UiProvider>
  );
}
