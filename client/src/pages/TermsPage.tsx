import { Fragment, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowLeft, Cookie } from 'lucide-react';
import { site } from '@/config';
import { openConsent } from '@/lib/consent';
import { useI18n } from '@/lib/i18n';
import { TERMS, TERMS_UPDATED } from '@/pages/termsContent';

/** "[text](/path)" in the terms' text: links (on the site, or outside it in a new tab). */
function withLinks(text: string): ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (!link) return <Fragment key={i}>{part}</Fragment>;
    const [, label, href] = link;
    return href!.startsWith('/') ? (
      <Link key={i} to={href!}>
        {label}
      </Link>
    ) : (
      <a key={i} href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  });
}

/** Linked from the footer and the sign-up pages: the rules, and what the site keeps about people (termsContent.ts). */
export function TermsPage() {
  const { t, lang, formatDate } = useI18n();
  const { hash } = useLocation();
  const text = TERMS[lang];

  useEffect(() => {
    document.title = `${t('terms.title')} · ${site.name}`;
    return () => {
      document.title = site.name;
    };
  }, [t]);

  // A section asked for in the address (#cookie-uri from the cookie banner).
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div className="container terms-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> {t('post.backHome')}
      </Link>
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('terms.title')}</h1>
          <p className="muted">
            {text.updatedLabel}: {formatDate(TERMS_UPDATED)}
          </p>
        </div>
      </section>

      <div className="terms-layout">
        <nav className="terms-toc card" aria-label={t('terms.contents')}>
          <strong>{t('terms.contents')}</strong>
          <ol>
            {text.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s*/, '')}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="terms-body">
          {text.intro.map((p, i) => (
            <p key={i} className="terms-intro">
              {withLinks(p)}
            </p>
          ))}
          {text.sections.map((section) => (
            <section key={section.id} id={section.id} className="terms-section">
              <h2>{section.title}</h2>
              {section.paragraphs?.map((p, i) => <p key={i}>{withLinks(p)}</p>)}
              {section.items && (
                <ul>
                  {section.items.map((item, i) => (
                    <li key={i}>{withLinks(item)}</li>
                  ))}
                </ul>
              )}
              {section.table && (
                <div className="terms-table-wrap">
                  <table className="terms-table">
                    <thead>
                      <tr>
                        {section.table.head.map((cell) => (
                          <th key={cell} scope="col">
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, i) =>
                            i === 0 ? (
                              <th key={i} scope="row">
                                {cell}
                              </th>
                            ) : (
                              <td key={i} data-label={section.table!.head[i]}>
                                {cell}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {section.id === 'cookie-uri' && (
                <button type="button" className="btn btn-secondary btn-sm terms-cookies" onClick={openConsent}>
                  <Cookie size={15} /> {t('consent.change')}
                </button>
              )}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
