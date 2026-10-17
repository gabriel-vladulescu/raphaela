import { useEffect } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { site } from '@/config';
import { useI18n } from '@/lib/i18n';

/** Linked from the footer. A placeholder until the terms are written. */
export function TermsPage() {
  const { t } = useI18n();

  useEffect(() => {
    document.title = `${t('terms.title')} · ${site.name}`;
    return () => {
      document.title = site.name;
    };
  }, [t]);

  return (
    <div className="container">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> {t('post.backHome')}
      </Link>
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('terms.title')}</h1>
          <p className="muted">{t('terms.body')}</p>
        </div>
      </section>
    </div>
  );
}
