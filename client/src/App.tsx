import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { KinshipSheet } from './components/KinshipSheet.tsx';
import { RootsIntro } from './components/RootsIntro.tsx';
import { TreasureSheet } from './components/TreasureSheet.tsx';
import { TreasureViewer } from './components/TreasureViewer.tsx';
import { AppShell } from './components/AppShell.tsx';
import { LoadingScreen } from './components/Feedback.tsx';
import { SearchSheet } from './components/SearchSheet.tsx';
import { ArchiveScreen } from './screens/ArchiveScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { NotFoundScreen } from './screens/NotFoundScreen.tsx';
import { PersonScreen } from './screens/PersonScreen.tsx';
import { TreeScreen } from './screens/TreeScreen.tsx';
import { UiProvider } from './state/ui.tsx';

// The timeline carries its own pan/zoom and layout maths and is not where
// anyone lands — worth splitting out. The tree is not: it *is* the entry point,
// and lazy-loading the first thing a visitor sees only buys a spinner.
const TimelineScreen = lazy(() =>
  import('./screens/TimelineScreen.tsx').then((m) => ({ default: m.TimelineScreen })),
);
// The workshop is only ever opened deliberately, and carries the whole editing
// surface with it — a natural split point.
const EditScreen = lazy(() =>
  import('./screens/EditScreen.tsx').then((m) => ({ default: m.EditScreen })),
);

/**
 * The tree used to live at /tree, behind a home page. It is the app now, so it
 * answers at the root — and every link ever shared, `?focus=` and all, still
 * lands on the right person.
 */
function ToTree(): React.JSX.Element {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

export function App(): React.JSX.Element {
  return (
    <UiProvider>
      {/* The mark holds the door while the tree and the session load behind
          it — see RootsIntro for what decides when it opens. */}
      <RootsIntro>
        <AppShell>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/" element={<TreeScreen />} />
              <Route path="/login" element={<LoginScreen />} />
              <Route path="/timeline" element={<TimelineScreen />} />
              <Route path="/archive" element={<ArchiveScreen />} />
              <Route path="/person/:id" element={<PersonScreen />} />
              <Route path="/edit" element={<EditScreen />} />
              <Route path="/edit/:tab" element={<EditScreen />} />
              <Route path="/edit/:tab/:id" element={<EditScreen />} />
              <Route path="/tree" element={<ToTree />} />
              {/* The design called this screen "the map"; keep the old path working. */}
              <Route path="/map" element={<ToTree />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
          </Suspense>
        </AppShell>

        {/* Mounted once at the root so any screen can open them. */}
        <SearchSheet />
        <TreasureSheet />
        <TreasureViewer />
        <KinshipSheet />
      </RootsIntro>
    </UiProvider>
  );
}
