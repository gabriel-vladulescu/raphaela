import type { ReactNode } from 'react';
import { isRouteErrorResponse, Link, Navigate, useLocation, useRouteError } from 'react-router';
import { RotateCw } from 'lucide-react';
import { useAuth } from '@/context/auth';
import { useI18n } from '@/lib/i18n';

/**
 * Shown when a page throws while rendering (or a lazy page fails to load).
 * `standalone` is for the root route, where the layout itself failed and there's no header or footer.
 */
export function RouteError({ standalone }: { standalone?: boolean }) {
  const error = useRouteError();
  const { t } = useI18n();

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  const details =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : JSON.stringify(error, null, 2) ?? String(error);

  const content = (
    <div className="container">
      <div className="empty-state card error-state" role="alert">
        <span className="empty-glyph" aria-hidden="true">☄</span>
        <h1>{t('error.pageTitle')}</h1>
        <p className="muted">{t('error.pageBody')}</p>
        <div className="error-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <RotateCw size={16} /> {t('error.reload')}
          </button>
          {/* A full page load, in case what broke was app state or an outdated bundle. */}
          <Link to="/" reloadDocument className="btn btn-secondary">
            {t('post.backHome')}
          </Link>
        </div>
        {import.meta.env.DEV && (
          <details className="error-details">
            <summary>{t('error.details')}</summary>
            <pre>{details}</pre>
          </details>
        )}
      </div>
    </div>
  );

  return standalone ? <main className="site-main">{content}</main> : content;
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="container">
      <div className="empty-state card">
        <span className="empty-glyph" aria-hidden="true">☾</span>
        <h1>{t('page.notFound')}</h1>
        <p className="muted">{t('page.notFoundBody')}</p>
        <Link to="/" className="btn btn-secondary">
          {t('post.backHome')}
        </Link>
      </div>
    </div>
  );
}

/**
 * Pages for signed-in users only: `user` (anyone signed in), `writer` (authors and owners) or `owner`.
 * Guests go to sign-in; signed-in users without the role see a notice.
 */
export function RequireRole({ role, children }: { role: 'user' | 'writer' | 'owner'; children: ReactNode }) {
  const { user, loading, isOwner, canWrite } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (loading) return <div className="container page-loading">{t('common.loading')}</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if ((role === 'owner' && !isOwner) || (role === 'writer' && !canWrite)) {
    return (
      <div className="container">
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">✦</span>
          <p>{t(role === 'owner' ? 'page.ownersOnly' : 'page.writersOnly')}</p>
        </div>
      </div>
    );
  }
  return children;
}
