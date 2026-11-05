import { Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/** Profile: everything the site keeps about the account, as a file (GDPR: access and portability; the Terms say so). */
export function DataExportCard() {
  const { t } = useI18n();
  return (
    <section className="card profile-card">
      <h2 className="side-title">{t('dataExport.title')}</h2>
      <p className="muted small">{t('dataExport.hint')}</p>
      <div className="profile-actions">
        <a className="btn btn-secondary" href="/api/me/export" download>
          <Download size={16} /> {t('dataExport.download')}
        </a>
      </div>
    </section>
  );
}
