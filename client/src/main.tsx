import { lazy, StrictMode, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Layout } from '@/components/Layout';
import { TERMS_PATH } from '@/config';
import { AuthProvider } from '@/context/auth';
import { CategoriesProvider } from '@/context/categories';
import { ReactionsProvider } from '@/context/reactions';
import { I18nProvider } from '@/lib/i18n';
import { hideSplashLater } from '@/lib/splash';
import { AdminDashboard } from '@/pages/AdminDashboard';
import { AdminStatsPage, StatsPage } from '@/pages/StatsPage';
import { AdminSupportPage, AdminSupportTicketPage } from '@/pages/AdminSupportPage';
import { AuthPage } from '@/pages/AuthPage';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { HomePage } from '@/pages/HomePage';
import { AdminArticlesPage, ArticlesPage, MyPage } from '@/pages/ArticlesPage';
import { PostPage } from '@/pages/PostPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { SavedPage } from '@/pages/SavedPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { NotFoundPage, RequireRole, RouteError } from '@/pages/StatusPages';
import { SupportPage } from '@/pages/SupportPage';
import { TermsPage } from '@/pages/TermsPage';
import { UsersPage } from '@/pages/UsersPage';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/pages.css';
import '@/styles/editor.css';
import '@/styles/sky.css';
import '@/styles/comments.css';

// The editor (TipTap) is most of the bundle and only authors and owners use it, so it loads on demand.
const EditorPage = lazy(() => import('@/pages/EditorPage').then((module) => ({ default: module.EditorPage })));

const editor = (): ReactNode => (
  <RequireRole role="writer">
    <Suspense fallback={<div className="container page-loading">…</div>}>
      <EditorPage />
    </Suspense>
  </RequireRole>
);

// A data router, so the editor can block navigation while there are unsaved changes.
const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError standalone />, // the layout itself failed
    children: [
      {
        errorElement: <RouteError />, // a page failed: the header and footer stay
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/login', element: <AuthPage mode="login" /> },
          { path: '/register', element: <AuthPage mode="register" /> },
          { path: '/posts/:slug', element: <PostPage /> },
          { path: '/articole-salvate', element: <SavedPage /> },
          { path: '/saved', element: <Navigate to="/articole-salvate" replace /> },
          { path: TERMS_PATH, element: <TermsPage /> },
          { path: '/profil', element: <RequireRole role="user"><ProfilePage /></RequireRole> },
          { path: '/notificari', element: <RequireRole role="user"><NotificationsPage /></RequireRole> },
          { path: '/setari', element: <RequireRole role="user"><SettingsPage /></RequireRole> },
          { path: '/suport', element: <SupportPage /> },
          { path: '/editor/new', element: <RequireRole role="writer"><MyPage to="new" /></RequireRole> },
          { path: '/editor/:id', element: editor() },
          { path: '/admin/posts', element: <RequireRole role="writer"><MyPage to="articles" /></RequireRole> },
          { path: '/statistici', element: <RequireRole role="writer"><StatsPage /></RequireRole> },
          { path: '/admin', element: <RequireRole role="owner"><AdminDashboard /></RequireRole> },
          { path: '/admin/statistici', element: <RequireRole role="owner"><AdminStatsPage /></RequireRole> },
          { path: '/admin/stats', element: <Navigate to="/admin/statistici" replace /> },
          { path: '/admin/articole', element: <RequireRole role="owner"><AdminArticlesPage /></RequireRole> },
          { path: '/admin/categories', element: <RequireRole role="owner"><CategoriesPage /></RequireRole> },
          { path: '/admin/users', element: <RequireRole role="owner"><UsersPage /></RequireRole> },
          { path: '/admin/suport', element: <RequireRole role="owner"><AdminSupportPage /></RequireRole> },
          { path: '/admin/suport/:id', element: <RequireRole role="owner"><AdminSupportTicketPage /></RequireRole> },
          // A person's pages (after the site's own: usernames never take its words, server/src/lib/usernames.ts).
          { path: '/:username/articole', element: <ArticlesPage /> },
          { path: '/:username/articole/nou', element: editor() },
          { path: '/:username/articole/:id', element: editor() },
          { path: '/:username/articole-salvate', element: <SavedPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

// The service worker (public/sw.js): push notifications, and in production offline copies of read pages and
// cached files. In development it's push only (?dev), since caching would get in the way of Vite.
if ('serviceWorker' in navigator) {
  const script = import.meta.env.PROD ? '/sw.js' : '/sw.js?dev';
  window.addEventListener('load', () => void navigator.serviceWorker.register(script).catch(() => undefined));
}

// The splash (index.html) goes once the home page has its posts; this is in case it never does.
hideSplashLater();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <CategoriesProvider>
          <ReactionsProvider>
            <RouterProvider router={router} />
          </ReactionsProvider>
        </CategoriesProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
