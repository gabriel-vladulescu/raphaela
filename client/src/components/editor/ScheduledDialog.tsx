import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, CalendarClock, FileText, X } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { chapterEditorPath, roman } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import { articlePath } from '@/lib/paths';
import type { PostSummary } from '@/lib/types';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** How many are asked for at a time. */
const PAGE = 20;

/**
 * What an author has scheduled, articles and chapters, by day in the order they come out (each to its editor; the
 * one being edited marked): to see what's taken when picking a time. 20 at a time: more as the end of the list comes
 * into view. A dialog on wide screens, the whole screen on phones; over the scheduling picker it was opened from,
 * which is there again once it's closed.
 */
export function ScheduledDialog({ username, currentId, onClose }: { username: string; currentId: number | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function loadMore() {
    setLoading(true);
    try {
      const data = await api<{ posts: PostSummary[]; hasMore: boolean; total: number }>(
        `/u/${encodeURIComponent(username)}/programate?offset=${posts.length}&limit=${PAGE}`,
      );
      setPosts((list) => [...list, ...data.posts.filter((post) => !list.some((p) => p.id === post.id))]);
      setHasMore(data.hasMore);
      setTotal(data.total);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  // More as the end of the list comes into view (inside the list's own scroll); the first ones at once.
  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasMore || loading || failed) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && void loadMore(), {
      root: listRef.current,
      rootMargin: '0px 0px 160px',
    });
    observer.observe(end);
    return () => observer.disconnect();
    // `loadMore` reads this render's list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, failed, posts.length]);

  // By day: today, tomorrow, then the day's name and date.
  const today = startOfDay(new Date());
  const dayLabel = (day: Date) => {
    const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (diff === 0) return t('date.today');
    if (diff === 1) return t('date.tomorrow');
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(day);
  };
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const days: { day: Date; posts: PostSummary[] }[] = [];
  for (const post of posts) {
    const day = startOfDay(new Date(post.publishedAt!));
    const last = days[days.length - 1];
    if (last && last.day.getTime() === day.getTime()) last.posts.push(post);
    else days.push({ day, posts: [post] });
  }

  const title = t('schedule.title');
  return (
    <Modal title={title} onClose={onClose} closeOnBackdrop className="scheduled-dialog">
      <div className="scheduled-body">
        <div className="scheduled-head">
          <h2>
            {title} {total !== null && <span className="muted">· {total}</span>}
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div ref={listRef} className="scheduled-list">
          {total === 0 ? (
            <EmptyState icon={CalendarClock} title={t('schedule.none')} text={t('schedule.noneText')} compact />
          ) : (
            days.map(({ day, posts: ofDay }) => (
              <section key={day.getTime()} className="scheduled-day" aria-label={dayLabel(day)}>
                <h3 className="studio-label">{dayLabel(day)}</h3>
                <ol>
                  {ofDay.map((post) => {
                    const to = post.book ? chapterEditorPath(post.book.id, post.id) : articlePath(post.id);
                    const current = post.id === currentId;
                    return (
                      <li key={post.id}>
                        <Link to={to} className={`scheduled-item${current ? ' is-current' : ''}`} onClick={onClose} aria-current={current ? 'page' : undefined}>
                          <span className="scheduled-time">{time.format(new Date(post.publishedAt!))}</span>
                          <span className="scheduled-text">
                            <strong>{post.title || t('post.untitled')}</strong>
                            <span className="muted">
                              {post.book ? <BookOpen size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
                              <span>{post.book ? `${t('books.chapterWord')} ${roman(post.book.chapter)} · ${post.book.title}` : (post.category?.name ?? t('schedule.article'))}</span>
                            </span>
                          </span>
                          {current && <span className="scheduled-this">{t('schedule.this')}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          )}
          {loading && <p className="muted small scheduled-status">{t('common.loading')}</p>}
          {failed && (
            <button type="button" className="btn btn-ghost btn-sm scheduled-status" onClick={() => setFailed(false)}>
              {t('notif.retry')}
            </button>
          )}
          <div ref={endRef} className="scheduled-end" aria-hidden="true" />
        </div>
      </div>
    </Modal>
  );
}
