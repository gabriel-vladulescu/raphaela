import { Link, NavLink } from 'react-router';
import { Feather, Footprints, Library, Play, Plus, Sun } from 'lucide-react';
import { useAuth } from '@/context/auth';
import { chapterPath } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import { newArticlePath } from '@/lib/paths';
import type { ReadingSummary } from '@/lib/types';
import { useHideOnScroll } from '@/lib/useHideOnScroll';

/**
 * Narrow screens (phones and tablets): the site's sections in a floating dock at the bottom, like an app's tab bar,
 * with "continue reading" in the round button in the middle (else the books). The fifth place is the reader's
 * journeys, or "write" for authors. Out of the way while scrolling down.
 */
export function Dock({ reading }: { reading?: ReadingSummary | null }) {
  const { t } = useI18n();
  const { canWrite, isOwner } = useAuth();
  const hidden = useHideOnScroll();
  // Where they are (a chapter they started), else the library.
  const current = reading?.current?.chapter.slug ? chapterPath(reading.current.book.slug, reading.current.chapter.slug) : null;
  return (
    <nav className={`dock${hidden ? ' is-hidden' : ''}`} aria-label={t('nav.sections')}>
      <NavLink to="/" end>
        <Sun size={21} />
        <span>{t('nav.today')}</span>
      </NavLink>
      <NavLink to="/carti">
        <Library size={21} />
        <span>{t('nav.books')}</span>
      </NavLink>
      <Link to={current ?? '/carti'} className="dock-go" aria-label={current ? t('today.continue') : t('nav.books')}>
        <Play size={22} fill="currentColor" />
      </Link>
      <NavLink to="/jurnal">
        <Feather size={21} />
        <span>{t('nav.journal')}</span>
      </NavLink>
      {canWrite && !isOwner ? (
        <NavLink to={newArticlePath()}>
          <Plus size={21} />
          <span>{t('nav.write')}</span>
        </NavLink>
      ) : (
        <NavLink to="/drumuri">
          <Footprints size={21} />
          <span>{t('nav.journeys')}</span>
        </NavLink>
      )}
    </nav>
  );
}
