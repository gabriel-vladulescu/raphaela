import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, CalendarClock, Check, ExternalLink, FilePen, History, MessageCircleOff, Send, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { BannerPicker } from '@/components/BannerPicker';
import { CategorySelect } from '@/components/CategorySelect';
import { RichEditor } from '@/components/editor/RichEditor';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { articlePath, articlesPath, newArticlePath } from '@/lib/paths';
import { useMediaQuery } from '@/lib/useMediaQuery';
import type { Author, EditablePost } from '@/lib/types';

type Mode = 'draft' | 'now' | 'schedule' | 'published';

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  bannerUrl: string | null;
  categoryId: number | null;
  mode: Mode;
  scheduleAt: string; // <input type="datetime-local"> value, local time
  commentsEnabled: boolean;
  seriesId: number | null;
  /** Its part in the series; null: after the others (the server picks). */
  seriesPart: number | null;
  /** The author's username. Administrators pick it (they write in an author's name); for authors it's their own. */
  author: string;
}

const blankForm = (author: string): FormState => ({
  title: '',
  slug: '',
  excerpt: '',
  contentHtml: '',
  bannerUrl: null,
  categoryId: null,
  mode: 'draft',
  scheduleAt: '',
  commentsEnabled: true,
  seriesId: null,
  seriesPart: null,
  author,
});

/** Drafts save themselves this long after the last change. */
const AUTOSAVE_MS = 4000;

interface SeriesOption {
  id: number;
  title: string;
  posts: number;
}

// Every change is also kept on this device until it's saved (all posts, published ones too), in case the tab or
// the phone closes first: reopening the editor offers it back.
interface Backup {
  form: FormState;
  at: number;
}
const backupKey = (id: number | null) => `editor.backup.${id ?? 'new'}`;

function readBackup(id: number | null): Backup | null {
  try {
    const value = JSON.parse(localStorage.getItem(backupKey(id)) ?? 'null') as Backup | null;
    return value && typeof value.at === 'number' && value.form ? value : null;
  } catch {
    return null;
  }
}

function writeBackup(id: number | null, form: FormState | null) {
  try {
    if (form) localStorage.setItem(backupKey(id), JSON.stringify({ form, at: Date.now() }));
    else localStorage.removeItem(backupKey(id));
  } catch {
    // Storage full or unavailable: the server copy is all there is.
  }
}

/** ISO date -> "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(value: string | Date) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formFromPost(post: EditablePost): FormState {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    bannerUrl: post.bannerUrl,
    categoryId: post.category?.id ?? null,
    mode: post.status === 'draft' ? 'draft' : post.status === 'scheduled' ? 'schedule' : 'published',
    scheduleAt: post.status === 'scheduled' && post.publishedAt ? toLocalInput(post.publishedAt) : '',
    commentsEnabled: post.commentsEnabled,
    seriesId: post.series?.id ?? null,
    seriesPart: post.series?.part ?? null,
    author: post.author.username,
  };
}

/**
 * Writing a post: /{username}/articole/nou (new), /{username}/articole/{id}. Authors write under their own name;
 * administrators always in an author's (picked here; a new post at an author's address starts with them).
 */
export function EditorPage() {
  const { username, id } = useParams();
  const postId = id ? Number(id) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const fromPost = (location.state as { from?: string } | null)?.from === 'post';
  const { t, errorMessage, formatDateTime } = useI18n();
  const { reload: reloadCategories } = useCategories();
  const { user, isOwner } = useAuth();
  const me = user!; // RequireRole: signed in, and a writer
  const startAuthor = isOwner ? (username ?? '').toLowerCase() : me.username;
  /** Back to the articles: an author's own list, or (administrators) every post. */
  const listPath = isOwner ? '/admin/articole' : articlesPath(me.username);

  const [post, setPost] = useState<EditablePost | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(startAuthor));
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(blankForm(startAuthor)));
  /** Administrators: the authors they can write for (null while loading). */
  const [authors, setAuthors] = useState<Author[] | null>(null);
  const [editorKey, setEditorKey] = useState('new');
  const [loading, setLoading] = useState(Boolean(postId));
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState('');
  const loadedId = useRef<number | null>(null);
  const allowLeave = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Narrow screens: an app-style bar on top (save there), the post's settings in a sheet.
  const compact = useMediaQuery('(max-width: 980px)');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  /** A copy kept on this device that differs from the saved post: offered back. */
  const [offer, setOffer] = useState<Backup | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesOption[]>([]);
  /** The name of a series being created (null: not creating one). */
  const [newSeries, setNewSeries] = useState<string | null>(null);
  /** The save under way (an autosave can be), which the next one waits for: two saves of a new post would make two. */
  const inFlight = useRef<Promise<void> | null>(null);

  const dirty = JSON.stringify(form) !== snapshot;
  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const setContent = useRef((contentHtml: string) => setForm((current) => ({ ...current, contentHtml }))).current;

  useEffect(() => {
    if (!postId && loadedId.current !== null) {
      // Went from editing a post to "new post": the router reuses this component, so reset it.
      loadedId.current = null;
      setPost(null);
      setForm(blankForm(startAuthor));
      setSnapshot(JSON.stringify(blankForm(startAuthor)));
      setEditorKey(`new-${Date.now()}`);
    }
    if (!postId || loadedId.current === postId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ post: EditablePost }>(`/u/${encodeURIComponent(username ?? me.username)}/articole/${postId}`)
      .then(({ post: loaded }) => {
        if (cancelled) return;
        const loadedForm = formFromPost(loaded);
        loadedId.current = loaded.id;
        setPost(loaded);
        setForm(loadedForm);
        setSnapshot(JSON.stringify(loadedForm));
        setEditorKey(String(loaded.id));
      })
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [postId]);

  useEffect(() => {
    if (!isOwner) return;
    api<{ authors: Author[] }>('/authors')
      .then((data) => setAuthors(data.authors))
      .catch(() => setAuthors([]));
  }, [isOwner]);
  /** Administrators' pick, if it's an author (an administrator's own post from before has none until they pick). */
  const chosenAuthor = isOwner ? authors?.find((author) => author.username === form.author) : undefined;
  const needsAuthor = isOwner && !chosenAuthor;

  // The address follows the post: its id once a new one is saved, its author's username (an old /editor/{id} link,
  // or after an administrator gave it to another author).
  useEffect(() => {
    if (!post) return;
    const path = articlePath(post.author.username, post.id);
    if (location.pathname !== path) navigate(path, { replace: true, state: location.state });
    // Only when the post changes (loaded or saved).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  useEffect(() => {
    api<{ series: SeriesOption[] }>('/series')
      .then((data) => setSeriesList(data.series))
      .catch(() => undefined);
  }, []);

  // Once the post is loaded (or a new one opened): a copy on this device that wasn't saved is offered back.
  useEffect(() => {
    if (loading) return;
    const kept = readBackup(postId);
    if (kept && JSON.stringify(kept.form) !== snapshot) setOffer(kept);
    else if (kept) writeBackup(postId, null);
    // Only when a post has just been loaded; the snapshot changes with every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, postId]);

  // Changes are kept on this device a moment after they're made.
  useEffect(() => {
    if (!dirty || loading) return;
    const timer = window.setTimeout(() => writeBackup(loadedId.current, form), 800);
    return () => window.clearTimeout(timer);
  }, [form, dirty, loading]);

  // Drafts save themselves a few seconds after the last change. A published post waits for "Update", since its
  // changes would go live.
  const canAutosave = form.mode === 'draft' && (post === null || post.status === 'draft') && form.title.trim() !== '' && !needsAuthor;
  useEffect(() => {
    if (!dirty || !canAutosave || saving || offer) return;
    const timer = window.setTimeout(() => void save({ quiet: true }), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // `save` is a new function each render; the timer uses this render's (with this form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, canAutosave, saving, offer]);

  // Grow the title field with its content.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [form.title, loading]);

  // Warn before losing unsaved work: in-app navigation (modal) and closing the tab (browser prompt).
  useEffect(() => {
    if (dirty) allowLeave.current = false;
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  // Leaving the post, not its address changing (a new post's first save, another author).
  const samePost = (pathname: string) => loadedId.current !== null && pathname.endsWith(`/articole/${loadedId.current}`);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname && !samePost(nextLocation.pathname),
  );

  /**
   * Saves the post. `quiet` (autosave): no "Saved" flash and no error message, and what's typed meanwhile stays as it
   * is (it's saved next time).
   */
  async function save({ quiet = false } = {}) {
    if (!quiet) setError('');
    if (!quiet && form.mode === 'schedule' && (!form.scheduleAt || new Date(form.scheduleAt) <= new Date())) {
      setError(t('editor.scheduleInPast'));
      return;
    }
    const sent = form;
    // Administrators write in an author's name: one must be picked.
    const author = isOwner ? authors?.find((candidate) => candidate.username === sent.author) : undefined;
    if (isOwner && !author) {
      if (!quiet) setError(t('error.author_required'));
      return;
    }
    const run = async () => {
      // After an autosave created it, a new post is saved by its id (not created again).
      const existingId = loadedId.current ?? postId;
      const body = {
        title: sent.title,
        slug: sent.slug,
        excerpt: sent.excerpt,
        contentHtml: sent.contentHtml,
        bannerUrl: sent.bannerUrl,
        categoryId: sent.categoryId,
        commentsEnabled: sent.commentsEnabled,
        seriesId: sent.seriesId,
        seriesPart: sent.seriesPart,
        ...(author ? { authorId: author.id } : {}),
        status: sent.mode === 'draft' ? 'draft' : 'published',
        publishedAt:
          sent.mode === 'schedule'
            ? new Date(sent.scheduleAt).toISOString()
            : sent.mode === 'published'
              ? (post?.publishedAt ?? null)
              : null,
      };
      if (quiet) setAutosave('saving');
      else setSaving(true);
      try {
        // New posts go to their author's list; the server places them by the address.
        const owner = encodeURIComponent(author?.username ?? me.username);
        const result = existingId
          ? await api<{ id: number; username: string }>(`/u/${owner}/articole/${existingId}`, { method: 'PUT', body })
          : await api<{ id: number; username: string }>(`/u/${owner}/articole`, { method: 'POST', body });
        const { post: saved } = await api<{ post: EditablePost }>(`/u/${encodeURIComponent(result.username)}/articole/${result.id}`);
        loadedId.current = saved.id;
        setPost(saved);
        writeBackup(null, null);
        writeBackup(saved.id, null);
        if (quiet) {
          setSnapshot(JSON.stringify(sent));
          setAutosave('saved');
        } else {
          const savedForm = formFromPost(saved);
          setForm(savedForm);
          setSnapshot(JSON.stringify(savedForm));
          setAutosave('idle');
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2500);
          setSettingsOpen(false);
        }
        void reloadCategories(); // post counts changed
      } catch (err) {
        if (quiet) setAutosave('failed');
        else setError(errorMessage(err));
      } finally {
        if (!quiet) setSaving(false);
      }
    };
    const previous = inFlight.current;
    const current = (async () => {
      await previous?.catch(() => undefined);
      await run();
    })();
    inFlight.current = current;
    await current;
  }

  function restoreOffer() {
    if (!offer) return;
    setForm(offer.form);
    setEditorKey(`restored-${offer.at}`); // the text editor takes its content when it's created
    setOffer(null);
  }

  function discardOffer() {
    writeBackup(postId, null);
    setOffer(null);
  }

  async function createSeries() {
    const title = (newSeries ?? '').trim();
    if (title.length < 2) return;
    try {
      const { series } = await api<{ series: SeriesOption }>('/series', { method: 'POST', body: { title } });
      setSeriesList((list) => [...list, series].sort((a, b) => a.title.localeCompare(b.title)));
      update({ seriesId: series.id, seriesPart: null });
      setNewSeries(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!postId || !window.confirm(t('editor.confirmDelete'))) return;
    try {
      await api(`/u/${encodeURIComponent(post?.author.username ?? me.username)}/articole/${postId}`, { method: 'DELETE' });
      allowLeave.current = true;
      void reloadCategories();
      navigate(listPath);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Authors write under their own name only.
  if (!postId && !isOwner && username && username.toLowerCase() !== me.username) return <Navigate to={newArticlePath(me.username)} replace />;
  if (notFound) {
    return (
      <div className="container">
        <div className="empty-state card">
          <p>{t('post.notFound')}</p>
          <Link to={listPath} className="btn btn-secondary">
            {t('manage.title')}
          </Link>
        </div>
      </div>
    );
  }
  if (loading) return <div className="container page-loading">{t('common.loading')}</div>;

  const modes: Mode[] = post?.status === 'published' ? ['published', 'draft', 'schedule'] : ['draft', 'now', 'schedule'];
  const primaryLabel = {
    draft: t('editor.saveDraft'),
    now: t('editor.publish'),
    schedule: t('editor.schedule'),
    published: t('editor.update'),
  }[form.mode];

  // The post's settings: in the sidebar on wide screens, in a sheet on narrow ones.
  const settings = (
    <>
      {isOwner && (
        <section className="card side-card">
          <label className="field">
            <span className="side-title">{t('editor.author')}</span>
            <select
              className={`input select${needsAuthor && error ? ' is-invalid' : ''}`}
              value={chosenAuthor ? form.author : ''}
              required
              onChange={(event) => {
                update({ author: event.target.value });
                if (error === t('error.author_required')) setError('');
              }}
            >
              <option value="" disabled>
                {authors === null ? t('common.loading') : t('editor.pickAuthor')}
              </option>
              {(authors ?? []).map((author) => (
                <option key={author.id} value={author.username}>
                  {author.name}
                </option>
              ))}
            </select>
            <span className="field-hint">{t('editor.authorHint')}</span>
          </label>
        </section>
      )}

      <section className="card side-card">
        <h2 className="side-title">{t('editor.publishing')}</h2>
        <div className="mode-options" role="radiogroup" aria-label={t('editor.publishing')}>
          {modes.map((mode) => (
            <label key={mode} className={`mode-option${form.mode === mode ? ' is-selected' : ''}`}>
              <input type="radio" name="mode" checked={form.mode === mode} onChange={() => update({ mode })} />
              {mode === 'draft' ? <FilePen size={16} /> : mode === 'schedule' ? <CalendarClock size={16} /> : <Send size={16} />}
              <span>{t(`editor.mode.${mode}`)}</span>
            </label>
          ))}
        </div>
        {form.mode === 'schedule' && (
          <label className="field">
            <span className="field-label">{t('editor.publishDate')}</span>
            <input
              type="datetime-local"
              className="input"
              value={form.scheduleAt}
              min={toLocalInput(new Date())}
              onChange={(event) => update({ scheduleAt: event.target.value })}
            />
          </label>
        )}
        {form.mode === 'published' && post?.publishedAt && (
          <p className="muted small">{t('editor.publishedOn', { date: formatDateTime(post.publishedAt) })}</p>
        )}
        {error && <p className="form-error">{error}</p>}
        <button type="button" className="btn btn-primary btn-block" onClick={() => void save()} disabled={saving || !form.title.trim()}>
          {saving ? t('common.loading') : primaryLabel}
        </button>
      </section>

      <section className="card side-card">
        <label className="field">
          <span className="side-title">{t('editor.category')}</span>
          <CategorySelect value={form.categoryId} onChange={(categoryId) => update({ categoryId })} emptyLabel={t('editor.noCategory')} />
        </label>
      </section>

      <section className="card side-card">
        <label className="field">
          <span className="side-title">{t('editor.series')}</span>
          <select
            className="input select"
            value={newSeries !== null ? 'new' : (form.seriesId ?? '')}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'new') {
                setNewSeries('');
                return;
              }
              setNewSeries(null);
              update({ seriesId: value ? Number(value) : null, seriesPart: null });
            }}
          >
            <option value="">{t('editor.noSeries')}</option>
            {seriesList.map((series) => (
              <option key={series.id} value={series.id}>
                {series.title}
              </option>
            ))}
            <option value="new">{t('editor.newSeries')}</option>
          </select>
        </label>
        {newSeries !== null && (
          <form
            className="series-new"
            onSubmit={(event) => {
              event.preventDefault();
              void createSeries();
            }}
          >
            <input
              className="input"
              maxLength={160}
              value={newSeries}
              placeholder={t('editor.seriesName')}
              aria-label={t('editor.seriesName')}
              autoFocus
              onChange={(event) => setNewSeries(event.target.value)}
            />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={newSeries.trim().length < 2}>
              {t('editor.createSeries')}
            </button>
          </form>
        )}
        {form.seriesId !== null && newSeries === null && (
          <label className="field">
            <span className="field-label">{t('editor.seriesPart')}</span>
            <input
              type="number"
              className="input"
              min={1}
              max={999}
              value={form.seriesPart ?? ''}
              placeholder={t('editor.seriesPartAuto')}
              onChange={(event) => update({ seriesPart: event.target.value ? Math.max(1, Math.min(999, Number(event.target.value))) : null })}
            />
            <span className="field-hint">{t('editor.seriesHint')}</span>
          </label>
        )}
      </section>

      <section className="card side-card">
        <h2 className="side-title">{t('editor.comments')}</h2>
        <label className="switch-field">
          <span className="switch-text">
            <strong>{t('editor.commentsAllow')}</strong>
            <span className="field-hint">{t('editor.commentsHint')}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={form.commentsEnabled}
            onChange={(event) => update({ commentsEnabled: event.target.checked })}
          />
        </label>
        {!form.commentsEnabled && (post?.existingComments ?? 0) > 0 && (
          <p className="field-warning" role="status">
            <MessageCircleOff size={16} /> {t('editor.commentsHidden')}
          </p>
        )}
      </section>

      <section className="card side-card">
        <label className="field">
          <span className="side-title">{t('editor.excerpt')}</span>
          <textarea
            className="input textarea"
            rows={4}
            maxLength={500}
            value={form.excerpt}
            onChange={(event) => update({ excerpt: event.target.value })}
          />
          <span className="field-hint">{t('editor.excerptHint')}</span>
        </label>
        <label className="field">
          <span className="side-title">{t('editor.slug')}</span>
          <input className="input" maxLength={100} value={form.slug} onChange={(event) => update({ slug: event.target.value })} />
          <span className="field-hint">{t('editor.slugHint')}</span>
        </label>
      </section>

      {post && compact && !fromPost && (
        <Link to={`/posts/${post.slug}`} className="btn btn-secondary btn-block" target="_blank">
          <ExternalLink size={15} /> {t('editor.view')}
        </Link>
      )}
      {post && (
        <button type="button" className="btn btn-danger-ghost btn-block" onClick={remove}>
          <Trash2 size={16} /> {t('editor.delete')}
        </button>
      )}
    </>
  );

  return (
    <div className={`container editor-page${compact ? ' is-compact' : ''}`}>
      <div className="editor-topbar">
        {/* Opened with "Edit" on the post page: back to the post (which also makes "View post" redundant). */}
        {fromPost && post ? (
          <Link to={`/posts/${post.slug}`} className="back-link" aria-label={t('editor.backToPost')}>
            <ArrowLeft size={16} /> <span className="back-text">{t('editor.backToPost')}</span>
          </Link>
        ) : (
          <Link to={listPath} className="back-link" aria-label={t('manage.title')}>
            <ArrowLeft size={16} /> <span className="back-text">{t('manage.title')}</span>
          </Link>
        )}
        <div className="editor-topbar-status">
          {post && <span className={`badge badge-status-${post.status}`}>{t(`post.status.${post.status}`)}</span>}
          {autosave !== 'idle' && (
            <span className={`autosave-status is-${autosave}`} role="status">
              {t(`editor.autosave.${autosave}`)}
            </span>
          )}
          {justSaved && !compact && (
            <span className="saved-indicator">
              <Check size={15} /> {t('editor.saved')}
            </span>
          )}
          {post && !fromPost && !compact && (
            <Link to={`/posts/${post.slug}`} className="btn btn-ghost btn-sm" target="_blank">
              <ExternalLink size={15} /> {t('editor.view')}
            </Link>
          )}
          {compact && (
            <>
              <button type="button" className="icon-btn editor-settings-btn" aria-label={t('editor.settings')} title={t('editor.settings')} onClick={() => setSettingsOpen(true)}>
                <SlidersHorizontal size={18} />
              </button>
              <button type="button" className="btn btn-primary btn-sm editor-save" onClick={() => void save()} disabled={saving || !form.title.trim()}>
                {saving ? (
                  t('common.loading')
                ) : justSaved ? (
                  <>
                    <Check size={15} /> {t('editor.saved')}
                  </>
                ) : (
                  primaryLabel
                )}
              </button>
            </>
          )}
        </div>
      </div>
      {offer && (
        <div className="notice editor-restore" role="status">
          <span>
            <History size={16} /> {t('editor.restore', { time: formatDateTime(new Date(offer.at)) })}
          </span>
          <span className="editor-restore-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={restoreOffer}>
              {t('editor.restoreAction')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={discardOffer}>
              {t('editor.restoreDiscard')}
            </button>
          </span>
        </div>
      )}
      {/* Narrow screens: the settings (where errors show) are in a closed sheet, so errors show here too. */}
      {compact && error && !settingsOpen && <p className="form-error editor-error">{error}</p>}

      <div className="editor-layout">
        <div className="editor-main card">
          <BannerPicker value={form.bannerUrl} onChange={(bannerUrl) => update({ bannerUrl })} />
          <textarea
            ref={titleRef}
            className="title-input"
            rows={1}
            maxLength={200}
            value={form.title}
            placeholder={t('editor.titlePlaceholder')}
            aria-label={t('editor.titlePlaceholder')}
            onChange={(event) => update({ title: event.target.value.replace(/\n/g, ' ') })}
          />
          <RichEditor key={editorKey} initialHtml={form.contentHtml} onChange={setContent} />
        </div>

        {!compact && <aside className="editor-side">{settings}</aside>}
      </div>

      {compact && settingsOpen && (
        <Modal title={t('editor.settings')} onClose={() => setSettingsOpen(false)} closeOnBackdrop sheet className="editor-sheet">
          <div className="editor-sheet-body">
            <div className="editor-sheet-head">
              <h2>{t('editor.settings')}</h2>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {settings}
          </div>
        </Modal>
      )}

      {blocker.state === 'blocked' && (
        <Modal title={t('editor.unsavedTitle')} onClose={() => blocker.reset()}>
          <div className="modal-body">
            <h2>{t('editor.unsavedTitle')}</h2>
            <p className="muted">{t('editor.unsavedBody')}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => blocker.reset()}>
                {t('editor.stay')}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => blocker.proceed()}>
                {t('editor.leave')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

