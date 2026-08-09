import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.tsx';
import { ApiError } from './api/client.ts';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A family archive changes slowly; refetching on every window focus is
      // noise. Mutations invalidate what they touch.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Retrying a 401/403/404 just delays the message the user needs.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/**
 * A deployment replaces every fingerprinted chunk, so a tab that stayed open
 * across one fails the moment it lazy-loads its next screen — the file it
 * asks for no longer exists. To the person holding the tab that reads as
 * "העריכה לא נפתחת". Reloading fetches the new index.html and its chunks and
 * the click just works; the timestamp keeps a genuinely broken network from
 * spinning the page in a reload loop.
 */
window.addEventListener('vite:preloadError', (event) => {
  const lastReload = Number(sessionStorage.getItem('shoresh-chunk-reload') ?? 0);
  if (Date.now() - lastReload < 10_000) return;
  event.preventDefault();
  sessionStorage.setItem('shoresh-chunk-reload', String(Date.now()));
  window.location.reload();
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
