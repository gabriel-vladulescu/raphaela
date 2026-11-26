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
import { BookPage, JourneysPage, LibraryPage, SubjectPage, SubjectsPage } from '@/pages/BookPages';
import { HomePage } from '@/pages/HomePage';
import { TodayPage } from '@/pages/TodayPage';
import { InvitePage } from '@/pages/InvitePage';
import { NewsletterConfirmPage, NewsletterManagePage } from '@/pages/NewsletterPages';
import { PersonIndex } from '@/pages/PersonIndex';
import { PreviewPage } from '@/pages/PreviewPage';
import { JournalPage, OldPath } from '@/pages/ArticlesPage';
import { PersonPage } from '@/pages/PersonPage';
import { bookEditorPath, chapterEditorPath, newBookPath, newChapterPath } from '@/lib/books';
import { articlePath, articlesPath, newArticlePath, personListPath } from '@/lib/paths';
import { PostPage } from '@/pages/PostPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { SavedPage } from '@/pages/SavedPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { NotFoundPage, RequireRole, RouteError } from '@/pages/StatusPages';
import { SupportPage } from '@/pages/SupportPage';
import { SupportTicketPage, SupportTicketsPage } from '@/pages/SupportTicketsPage';
import { TermsPage } from '@/pages/TermsPage';
import '@/styles/fonts.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/pages.css';
import '@/styles/editor.css';
import '@/styles/sky.css';
import '@/styles/comments.css';
import '@/styles/features.css';
import '@/styles/books.css';

// The editor (TipTap) is most of the bundle and only authors and owners use it, so it loads on demand.
const EditorPage = lazy(() => import('@/pages/EditorPage').then((module) => ({ default: module.EditorPage })));
// A writer's books (and the cover studio): on demand too.
const MyBooksPage = lazy(() => import('@/pages/MyBooksPage').then((module) => ({ default: module.MyBooksPage })));
const BookEditorPage = lazy(() => import('@/pages/MyBooksPage').then((module) => ({ default: module.BookEditorPage })));

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
    { path: 'carti', ...adminPage(async () => (await import('@/admin/pages/Books')).BooksPage) },
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

const writerPage = (page: ReactNode): ReactNode => (
  <RequireRole role="writer">
    <Suspense fallback={<div className="container page-loading">…</div>}>{page}</Suspense>
  </RequireRole>
);

/** The editor: an article, or a chapter of a book (the same editor, with a few fields of its own). */
const editor = (kind: 'post' | 'chapter' = 'post'): ReactNode => (
  <RequireRole role="writer">
    <Suspense fallback={<div className="container page-loading">…</div>}>
      <EditorPage key={kind} kind={kind} />
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
          { path: '/', element: <TodayPage /> },
          { path: '/jurnal', element: <HomePage /> },
          { path: '/carti', element: <LibraryPage /> },
          { path: '/carti/:slug', element: <BookPage /> },
          // A book's chapter: the post page, with its book.
          { path: '/carti/:book/:slug', element: <PostPage /> },
          { path: '/subiecte', element: <SubjectsPage /> },
          { path: '/subiecte/:slug', element: <SubjectPage /> },
          { path: '/drumuri', element: <JourneysPage /> },
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
          // One's own saved posts (a guest's, in the browser); the old addresses lead there.
          { path: '/salvate', element: <SavedPage /> },
          { path: '/articole-salvate', element: <Navigate to="/salvate" replace /> },
          { path: '/saved', element: <Navigate to="/salvate" replace /> },
          { path: TERMS_PATH, element: <TermsPage /> },
          { path: '/profil', element: <RequireRole role="user"><ProfilePage /></RequireRole> },
          { path: '/notificari', element: <RequireRole role="user"><NotificationsPage /></RequireRole> },
          { path: '/setari', element: <RequireRole role="user"><SettingsPage /></RequireRole> },
          { path: '/suport', element: <SupportPage /> },
          { path: '/suport/tichete', element: <SupportTicketsPage /> },
          { path: '/suport/tichete/:id', element: <SupportTicketPage /> },
          { path: '/editor/new', element: <Navigate to={newArticlePath()} replace /> },
          { path: '/editor/:id', element: editor() },
          { path: '/admin/posts', element: <Navigate to={articlesPath()} replace /> },
          { path: '/statistici', element: <RequireRole role="writer"><StatsPage /></RequireRole> },
          // The writer's own pages (theirs alone, no username in them): their journal and its articles in the editor;
          // their books, one to write, its chapters in the editor.
          { path: '/jurnalul-meu', element: <RequireRole role="writer"><JournalPage /></RequireRole> },
          { path: '/jurnalul-meu/nou', element: editor() },
          { path: '/jurnalul-meu/:id', element: editor() },
          { path: '/cartile-mele', element: writerPage(<MyBooksPage />) },
          { path: '/cartile-mele/nou', element: writerPage(<BookEditorPage />) },
          { path: '/cartile-mele/:id', element: writerPage(<BookEditorPage />) },
          { path: '/cartile-mele/:book/capitole/nou', element: editor('chapter') },
          { path: '/cartile-mele/:book/capitole/:id', element: editor('chapter') },
          // A person's public pages (after the site's own: usernames never take its words, server/src/lib/usernames.ts):
          // their journal, books and saved posts, each when they made it public. The username alone leads to the first
          // of them the viewer may see.
          { path: '/:username', element: <PersonIndex />, handle: { untracked: true } },
          { path: '/:username/jurnal', element: <PersonPage list="jurnal" /> },
          { path: '/:username/carti', element: <PersonPage list="carti" /> },
          { path: '/:username/salvate', element: <PersonPage list="salvate" /> },
          // The old addresses: the writer's pages and editors under their username, "articole", "articole-salvate".
          { path: '/:username/jurnal/nou', element: <OldPath to={() => newArticlePath()} /> },
          { path: '/:username/jurnal/:id', element: <OldPath to={({ id }) => articlePath(Number(id))} /> },
          { path: '/:username/articole', element: <OldPath to={({ username }) => personListPath(username ?? '', 'jurnal')} /> },
          { path: '/:username/articole/nou', element: <OldPath to={() => newArticlePath()} /> },
          { path: '/:username/articole/:id', element: <OldPath to={({ id }) => articlePath(Number(id))} /> },
          { path: '/:username/articole-salvate', element: <OldPath to={({ username }) => personListPath(username ?? '', 'salvate')} /> },
          { path: '/:username/carti/nou', element: <OldPath to={() => newBookPath()} /> },
          { path: '/:username/carti/:id', element: <OldPath to={({ id }) => bookEditorPath(Number(id))} /> },
          { path: '/:username/carti/:book/capitole/nou', element: <OldPath to={({ book }) => newChapterPath(Number(book))} /> },
          { path: '/:username/carti/:book/capitole/:id', element: <OldPath to={({ book, id }) => chapterEditorPath(Number(book), Number(id))} /> },
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
