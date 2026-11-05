import { lazy, StrictMode, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';
import { Layout } from '@/components/Layout';
import { TERMS_PATH } from '@/config';
import { AuthProvider } from '@/context/auth';
import { CategoriesProvider } from '@/context/categories';
import { ReactionsProvider } from '@/context/reactions';
import { I18nProvider } from '@/lib/i18n';
import { hideSplashLater } from '@/lib/splash';
import { ConfirmEmailPage, ForgotPasswordPage, ResetPasswordPage } from '@/pages/AccountLinkPages';
import { StatsPage } from '@/pages/StatsPage';
import { AuthPage } from '@/pages/AuthPage';
import { HomePage } from '@/pages/HomePage';
import { InvitePage } from '@/pages/InvitePage';
import { NewsletterConfirmPage, NewsletterManagePage } from '@/pages/NewsletterPages';
import { PersonIndex } from '@/pages/PersonIndex';
import { PreviewPage } from '@/pages/PreviewPage';
import { ArticlesPage, MyPage } from '@/pages/ArticlesPage';
import { PostPage } from '@/pages/PostPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { SavedPage } from '@/pages/SavedPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { NotFoundPage, RequireRole, RouteError } from '@/pages/StatusPages';
import { SupportPage } from '@/pages/SupportPage';
import { TermsPage } from '@/pages/TermsPage';
import '@/styles/fonts.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/pages.css';
import '@/styles/editor.css';
import '@/styles/sky.css';
import '@/styles/comments.css';
import '@/styles/features.css';

// The editor (TipTap) is most of the bundle and only authors and owners use it, so it loads on demand.
const EditorPage = lazy(() => import('@/pages/EditorPage').then((module) => ({ default: module.EditorPage })));

/**
 * The admin panel is its own app (src/admin), with its own look, for administrators only: loaded on demand, page by
 * page. Its pages are child routes with fixed paths, which rank above the site's /:username/articole.
 */
const adminPage = (load: () => Promise<ComponentType>) => ({ lazy: async () => ({ Component: await load() }) });
const adminRoutes: RouteObject = {
  path: '/admin',
  errorElement: <RouteError standalone />,
  ...adminPage(async () => (await import('@/admin/AdminApp')).default),
  children: [
    { index: true, ...adminPage(async () => (await import('@/admin/pages/Dashboard')).DashboardPage) },
    { path: 'statistici', ...adminPage(async () => (await import('@/admin/pages/Stats')).StatsPage) },
    { path: 'articole', ...adminPage(async () => (await import('@/admin/pages/Posts')).PostsPage) },
    { path: 'categorii', ...adminPage(async () => (await import('@/admin/pages/Categories')).CategoriesPage) },
    { path: 'comentarii', ...adminPage(async () => (await import('@/admin/pages/Comments')).CommentsPage) },
    { path: 'utilizatori', ...adminPage(async () => (await import('@/admin/pages/Users')).UsersPage) },
    { path: 'suport', ...adminPage(async () => (await import('@/admin/pages/Support')).SupportPage) },
    { path: 'suport/:id', ...adminPage(async () => (await import('@/admin/pages/Support')).TicketPage) },
    { path: 'setari', ...adminPage(async () => (await import('@/admin/pages/Settings')).SettingsPage) },
    { path: 'jurnal', ...adminPage(async () => (await import('@/admin/pages/Log')).LogPage) },
    { path: 'newsletter', ...adminPage(async () => (await import('@/admin/pages/Newsletter')).NewsletterPage) },
    { path: 'media', ...adminPage(async () => (await import('@/admin/pages/Media')).MediaPage) },
    // Earlier addresses.
    { path: 'stats', element: <Navigate to="/admin/statistici" replace /> },
    { path: 'categories', element: <Navigate to="/admin/categorii" replace /> },
    { path: 'users', element: <Navigate to="/admin/utilizatori" replace /> },
    { path: '*', element: <Navigate to="/admin" replace /> },
  ],
};

const editor = (): ReactNode => (
  <RequireRole role="writer">
    <Suspense fallback={<div className="container page-loading">…</div>}>
      <EditorPage />
    </Suspense>
  </RequireRole>
);

// A data router, so the editor can block navigation while there are unsaved changes.
const router = createBrowserRouter([
  adminRoutes,
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
          { path: '/parola-uitata', element: <ForgotPasswordPage /> },
          { path: '/resetare-parola', element: <ResetPasswordPage /> },
          { path: '/confirmare-email', element: <ConfirmEmailPage /> },
          { path: '/posts/:slug', element: <PostPage /> },
          { path: '/eticheta/:tag', element: <HomePage /> },
          { path: '/previzualizare/:token', element: <PreviewPage /> },
          { path: '/newsletter/confirmare', element: <NewsletterConfirmPage /> },
          { path: '/newsletter/:token', element: <NewsletterManagePage /> },
          { path: '/invitatie', element: <InvitePage /> },
          // The first run's setup shows on every address while it's needed (Layout); after that, home.
          { path: '/setup', element: <Navigate to="/" replace /> },
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
          // A person's pages (after the site's own: usernames never take its words, server/src/lib/usernames.ts).
          // The username alone leads to the list of theirs the viewer may see.
          { path: '/:username', element: <PersonIndex />, handle: { untracked: true } },
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
