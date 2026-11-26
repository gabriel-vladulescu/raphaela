import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { BookCover } from '@/components/BookCover';
import type { CoverDesign } from '@/lib/covers';
import { useI18n } from '@/lib/i18n';

export interface DeskLast {
  /** Its picture (a book's cover, an article's banner), and where it leads. */
  thumb: ReactNode;
  thumbTo: string;
  title: string;
  /** "Chapter III · draft · 2 hours ago". */
  meta: string;
  actions: ReactNode;
}

/**
 * The top of an author's own pages (/{username}/carti, /{username}/jurnal), one card: the title and how their writing
 * goes (`line`), three numbers (`stats`, none while there's nothing yet) with the button for a new one, and along its
 * bottom what they last worked on (`last`: to go on with it). Behind, one cover tilted in its top corner. It measures
 * its own width: narrow, the numbers share it and the button goes under them; the last one's actions become a bar.
 */
export function WritingDesk(props: {
  title: string;
  line: string;
  stats: { value: number; label: string }[] | null;
  newTo: string;
  newLabel: string;
  cover: { design: CoverDesign; title: string; subject: string; author: string };
  last: DeskLast | null;
}) {
  const { title, line, stats, newTo, newLabel, cover, last } = props;
  const { t } = useI18n();
  return (
    <section className="writing-desk" aria-labelledby="desk-title">
      <span className="writing-desk-bg" aria-hidden="true">
        <BookCover design={cover.design} title={cover.title} subject={cover.subject} author={cover.author} />
      </span>
      <h1 id="desk-title">{title}</h1>
      {line && <p className="writing-desk-line">{line}</p>}
      <div className="writing-desk-row">
        {stats?.map((stat) => (
          <div key={stat.label} className="desk-stat">
            <b>{stat.value}</b>
            <span>{stat.label}</span>
          </div>
        ))}
        <Link to={newTo} className="btn btn-warm writing-desk-new">
          <Plus size={18} /> {newLabel}
        </Link>
      </div>
      {last && (
        <div className="writing-desk-last">
          <Link to={last.thumbTo} className="writing-desk-last-cover" aria-label={last.title} tabIndex={-1}>
            {last.thumb}
          </Link>
          <div className="writing-desk-last-text">
            <span className="writing-desk-last-label">{t('books.deskLast')}</span>
            <strong>{last.title}</strong>
            <span className="muted">{last.meta}</span>
          </div>
          <div className="writing-desk-last-actions">{last.actions}</div>
        </div>
      )}
    </section>
  );
}
