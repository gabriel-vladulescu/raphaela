import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, BookOpen, Bookmark, Eye, FilePlus2, LayoutGrid, Pencil, Save, Trash2, X } from 'lucide-react';
import { BookCover } from '@/components/BookCover';
import { BookStatus, CoverOf } from '@/components/Books';
import { CategorySelect } from '@/components/CategorySelect';
import { ChapterOrder } from '@/components/ChapterOrder';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { InDevelopment } from '@/components/InDevelopment';
import { WritingDesk } from '@/components/WritingDesk';
import { ScrollHint } from '@/components/ScrollHint';
import { ConfirmModal } from '@/components/Modal';
import { OrnamentChoice, OrnamentPicker } from '@/components/OrnamentPicker';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { api, ApiError } from '@/lib/api';
import { bookEditorPath, bookPath, chapterEditorPath, myBooksPath, newBookPath, newChapterPath, roman } from '@/lib/books';
import { colorsOf, DEFAULT_COVER, LAYOUTS, ORNAMENT_IDS, ORNAMENT_PICKS, PALETTES, TEMPLATES } from '@/lib/covers';
import type { CoverDesign, CoverTemplate, LayoutId } from '@/lib/covers';
import { useI18n } from '@/lib/i18n';
import { showToast } from '@/lib/toast';
import { PHONE, useMediaQuery } from '@/lib/useMediaQuery';
import type { Book, Chapter } from '@/lib/types';
import { NotFoundPage } from '@/pages/StatusPages';

// A writer's own books (/cartile-mele): the list (an author's own: nobody else's; anyone's public ones are at
// /{username}/carti, PersonPage), and one book to write (its details, its cover from a template, its chapters' order;
// administrators too, in an author's name).

/** The writer's desk (theirs and administrators' to see): their chapters still drafts, and the one last saved. */
interface Desk {
  drafts: number;
  last: { book: Book; chapter: { id: number; title: string; no: number; state: 'draft' | 'scheduled' | 'published'; updatedAt: string } } | null;
}

/** The desk's background: one cover, tilted in its corner (always this one: it's a picture, not a book). */
const DESK_COVER = { template: 'spirala', layout: 'clasic', ornament: 'spiral', palette: 'adanc' } as CoverDesign;

/** The top of "My books" (WritingDesk): their books, the chapters out, the drafts; the chapter last worked on. */
function BooksDesk({ books, desk, title, author }: { books: Book[] | null; desk: Desk | null; title: string; author: string }) {
  const { t, plural, timeAgo } = useI18n();
  const writing = books?.filter((book) => !book.complete).length ?? 0;
  const complete = (books?.length ?? 0) - writing;
  const published = books?.reduce((sum, book) => sum + book.chapters, 0) ?? 0;
  const line = !books
    ? ''
    : books.length === 0
      ? t('books.mineIntro')
      : writing && complete
        ? t('books.deskBoth', { writing: plural('books.count', writing), complete })
        : writing
          ? t('books.deskWriting', { writing: plural('books.count', writing) })
          : t('books.deskComplete', { complete: plural('books.count', complete) });
  const last = desk?.last;
  return (
    <WritingDesk
      title={title}
      line={line}
      stats={
        desk && books && books.length > 0
          ? [
              { value: books.length, label: t(books.length === 1 ? 'books.deskBook' : 'books.deskBooks') },
              { value: published, label: t(published === 1 ? 'books.deskChapter' : 'books.deskChapters') },
              { value: desk.drafts, label: t(desk.drafts === 1 ? 'books.deskDraft' : 'books.deskDrafts') },
            ]
          : null
      }
      newTo={newBookPath()}
      newLabel={t('books.new')}
      cover={{ design: DESK_COVER, title: 'Spirala Păsării Phoenix', subject: t('books.deskCoverSubject'), author }}
      last={
        last
          ? {
              thumb: <CoverOf book={last.book} mini />,
              thumbTo: bookEditorPath(last.book.id),
              title: last.book.title,
              meta: `${t('books.chapterWord')} ${roman(last.chapter.no)} · ${t(`post.status.${last.chapter.state}`).toLocaleLowerCase()} · ${timeAgo(last.chapter.updatedAt)}`,
              actions: (
                <>
                  <Link to={chapterEditorPath(last.book.id, last.chapter.id)} className="btn btn-soft btn-sm">
                    <Pencil size={15} /> {t('books.deskContinue')}
                  </Link>
                  <Link to={newChapterPath(last.book.id)} className="btn btn-soft btn-sm">
                    <FilePlus2 size={15} /> {t('books.newChapter')}
                  </Link>
                </>
              ),
            }
          : null
      }
    />
  );
}

export function MyBooksPage() {
  const { t, errorMessage } = useI18n();
  const { user } = useAuth();
  const username = user?.username ?? '';
  const [books, setBooks] = useState<Book[] | null>(null);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  // Only an author: their own books (/cartile-mele).
  const allowed = user?.role === 'author';

  useEffect(() => {
    if (!allowed) return;
    api<{ books: Book[]; desk?: Desk }>(`/u/${encodeURIComponent(username)}/carti`)
      .then((data) => {
        setBooks(data.books);
        setDesk(data.desk ?? null);
      })
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setError(errorMessage(err))));
  }, [username, allowed]);

  if (missing || !allowed) return <NotFoundPage />;

  return (
    <div className="container books-page my-books">
      <HeaderBackLink />
      <BooksDesk
        books={books}
        desk={desk}
        title={t('books.mineTitle')}
        author={user!.name}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="my-books-list">
        {(books ?? []).map((book) => (
          <article key={book.id} className="my-book glass">
            {/* Inside a box of its own: the card measures its width (styles/books.css: the actions' bar). */}
            <div className="my-book-inner">
            <Link to={bookEditorPath(book.id)} className="my-book-cover">
              <CoverOf book={book} />
            </Link>
            <div className="my-book-text">
              {/* Its state first, over the title. */}
              <span className="my-book-chips">
                <BookStatus book={book} />
                {!book.published && <span className="book-chip is-hidden">{t('books.unpublished')}</span>}
              </span>
              <h2>
                <Link to={bookEditorPath(book.id)}>{book.title}</Link>
              </h2>
              <p className="muted">
                {book.subject ? `${book.subject.name} · ` : ''}
                {t('books.chaptersPublic', { n: book.chapters, all: book.allChapters })}
              </p>
            </div>
            <div className="my-book-actions">
                <Link to={newChapterPath(book.id)} className="btn btn-soft btn-sm">
                  <FilePlus2 size={15} /> {t('books.newChapter')}
                </Link>
                {book.chapters > 0 && (
                  <Link to={bookPath(book.slug)} className="btn btn-soft btn-sm">
                    <Eye size={15} /> {t('books.viewBook')}
                  </Link>
                )}
                <Link to={bookEditorPath(book.id)} className="btn btn-soft btn-sm">
                  <Pencil size={15} /> {t('books.edit')}
                </Link>
            </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ---------- One book: details, cover, chapters ----------

interface BookForm {
  title: string;
  description: string;
  categoryId: number | null;
  planned: string;
  complete: boolean;
  /** On the site, or hidden (a new book starts hidden: it's published when the author says so). */
  published: boolean;
  cover: CoverDesign;
}

const EMPTY_FORM: BookForm = { title: '', description: '', categoryId: null, planned: '', complete: false, published: false, cover: DEFAULT_COVER };

export function BookEditorPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { t, errorMessage } = useI18n();
  const { user } = useAuth();
  const { categories } = useCategories();
  const [form, setForm] = useState<BookForm>(EMPTY_FORM);
  const [book, setBook] = useState<Book | null>(null);
  const [contents, setContents] = useState<Chapter[]>([]);
  /** In the API's addresses: the book's author (an administrator edits in their name), else the signed-in writer. */
  const username = book?.author.username ?? user?.username ?? '';
  const [loaded, setLoaded] = useState(isNew);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api<{ book: Book; contents: Chapter[] }>(`/u/${encodeURIComponent(username)}/carti/${id}`)
      .then((data) => {
        setBook(data.book);
        setContents(data.contents);
        setForm({
          title: data.book.title,
          description: data.book.description,
          categoryId: data.book.subject?.id ?? null,
          planned: data.book.planned ? String(data.book.planned) : '',
          complete: data.book.complete,
          published: data.book.published,
          cover: data.book.cover,
        });
        setLoaded(true);
      })
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setError(errorMessage(err))));
    // Once per book (its author's username, which comes with it, doesn't load it again).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (missing) return <NotFoundPage />;
  if (!loaded) return <div className="container page-loading">{error || t('common.loading')}</div>;

  const set = <K extends keyof BookForm>(key: K, value: BookForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setSaving(true);
    setError('');
    const planned = Number(form.planned);
    const body = {
      title: form.title,
      description: form.description,
      categoryId: form.categoryId,
      cover: form.cover,
      plannedChapters: Number.isInteger(planned) && planned > 0 ? planned : null,
      complete: form.complete,
      published: form.published,
    };
    try {
      if (isNew) {
        const created = await api<{ id: number }>(`/u/${encodeURIComponent(username)}/carti`, { method: 'POST', body });
        showToast({ message: t('books.created') });
        navigate(bookEditorPath(created.id), { replace: true });
      } else {
        await api(`/u/${encodeURIComponent(username)}/carti/${id}`, { method: 'PUT', body });
        showToast({ message: t('books.saved') });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(false);
    try {
      await api(`/u/${encodeURIComponent(username)}/carti/${id}`, { method: 'DELETE' });
      showToast({ message: t('books.deleted') });
      navigate(myBooksPath(), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /** The chapters in a new order (ChapterOrder, once confirmed): saved at once, numbered again by the server. */
  async function saveOrder(order: Chapter[]) {
    setError('');
    try {
      const data = await api<{ contents: Chapter[] }>(`/u/${encodeURIComponent(username)}/carti/${id}/ordine`, {
        method: 'PUT',
        body: { order: order.map((chapter) => chapter.id) },
      });
      setContents(data.contents);
      showToast({ message: t('books.orderSaved') });
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  const preview = { title: form.title || t('books.titlePlaceholder'), subject: '', author: book?.author.name ?? user?.name ?? '' };

  return (
    <div className="container book-editor">
      <HeaderBackLink to={myBooksPath()} label={t('nav.myBooks')} />
      <form className="book-editor-grid" onSubmit={save}>
        <aside className="studio-stage glass">
          <div className="stage-cover">
            <BookCover design={form.cover} title={preview.title} subject={subjectName(form.categoryId)} author={preview.author} label={preview.title} />
          </div>
          <div className="stage-sizes" aria-hidden="true">
            <figure>
              <BookCover design={form.cover} title={preview.title} subject={subjectName(form.categoryId)} author={preview.author} />
              <figcaption>{t('books.sizeShelf')}</figcaption>
            </figure>
            <figure>
              <BookCover design={form.cover} title={preview.title} subject={subjectName(form.categoryId)} author={preview.author} />
              <figcaption>{t('books.sizeList')}</figcaption>
            </figure>
            <figure className="stage-row">
              <span className="stage-row-card">
                <BookCover design={form.cover} title={preview.title} mini />
                <span>
                  <b>{preview.title}</b>
                  <span>{t('books.chapterRomanOf', { n: 'I', total: form.planned || '…' })}</span>
                </span>
              </span>
              <figcaption>{t('books.sizeThumb')}</figcaption>
            </figure>
          </div>
          <div className="stage-actions">
            <button type="submit" className="btn btn-warm" disabled={saving}>
              <Save size={17} /> {saving ? t('common.loading') : isNew ? t('books.create') : t('books.save')}
            </button>
            {!isNew && book && book.chapters > 0 && (
              <Link to={bookPath(book.slug)} className="btn btn-soft">
                <Eye size={16} /> {t('books.view')}
              </Link>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
        </aside>

        <div className="studio-panel glass">
          <section className="studio-group">
            <div className="studio-group-head">
              <h2>{t('books.details')}</h2>
              {/* Published or not: saved with the rest ("Save"). */}
              <label className={`publish-toggle${form.published ? ' is-on' : ''}`}>
                <span>{form.published ? t('books.published') : t('books.unpublished')}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={form.published}
                  aria-label={t('books.publishedField')}
                  onChange={(event) => set('published', event.target.checked)}
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">{t('books.titleField')}</span>
              <input
                className="input"
                required
                minLength={2}
                maxLength={160}
                value={form.title}
                placeholder={t('books.titlePlaceholder')}
                onChange={(event) => set('title', event.target.value)}
              />
            </label>
            <div className="studio-pair">
              {/* (not a <label>: a tap in the picker would open it again) */}
              <div className="field">
                <span className="field-label">{t('books.subject')}</span>
                <CategorySelect value={form.categoryId} onChange={(value) => set('categoryId', value)} emptyLabel={t('books.noSubject')} title={t('books.subject')} />
              </div>
              <label className="field">
                <span className="field-label">{t('books.plannedField')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  value={form.planned}
                  placeholder={t('books.plannedPlaceholder')}
                  onChange={(event) => set('planned', event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">{t('books.descriptionField')}</span>
              <textarea
                className="input textarea"
                rows={4}
                maxLength={1000}
                value={form.description}
                placeholder={t('books.descriptionPlaceholder')}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>
            <label className="switch-field">
              <span className="switch-text">
                <strong>{t('books.completeField')}</strong>
                <span className="field-hint">{t('books.completeHint')}</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={form.complete} onChange={(event) => set('complete', event.target.checked)} />
            </label>
          </section>

          <CoverStudio cover={form.cover} title={preview.title} subject={subjectName(form.categoryId)} author={preview.author} onChange={(cover) => set('cover', cover)} />

          {!isNew && (
            <section className="studio-group">
              <div className="studio-group-head">
                <h2>{t('books.chaptersTitle')}</h2>
                <Link to={newChapterPath(Number(id))} className="btn btn-soft btn-sm">
                  <FilePlus2 size={15} /> {t('books.newChapter')}
                </Link>
              </div>
              {contents.length === 0 ? (
                <p className="muted">{t('books.noChapters')}</p>
              ) : (
                <ChapterOrder chapters={contents} bookSlug={book?.slug ?? null} bookId={Number(id)} onSave={saveOrder} />
              )}
            </section>
          )}

          {!isNew && (
            <section className="studio-group studio-danger">
              <div>
                <h2>{t('books.deleteTitle')}</h2>
                <p className="muted">{contents.length ? t('books.deleteNotEmpty') : t('books.deleteHint')}</p>
              </div>
              <button type="button" className="btn btn-danger-ghost" disabled={contents.length > 0} onClick={() => setDeleting(true)}>
                <Trash2 size={16} /> {t('books.delete')}
              </button>
            </section>
          )}
        </div>
      </form>
      {deleting && (
        <ConfirmModal
          title={t('books.deleteTitle')}
          message={t('books.deleteConfirm', { title: form.title })}
          confirmLabel={t('books.delete')}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );

  /** The subject's name, for the cover's top line. */
  function subjectName(categoryId: number | null) {
    return categories.find((category) => category.id === categoryId)?.name ?? '';
  }
}

// ---------- The cover studio ----------

const hexOf = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000');

/**
 * A book's cover from a template: pick one (each drawn with this book's title), then change the arrangement, the
 * ornament, the palette or the colours; a design can be saved as a template of its own, for other books (shared
 * by the writers).
 */
function CoverStudio({
  cover,
  title,
  subject,
  author,
  onChange,
}: {
  cover: CoverDesign;
  title: string;
  subject: string;
  author: string;
  onChange: (cover: CoverDesign) => void;
}) {
  const { t, lang, errorMessage } = useI18n();
  const [saved, setSaved] = useState<CoverTemplate[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  /** The templates' row, which scrolls sideways on phones (its title says so: ScrollHint). */
  const templatesRow = useRef<HTMLDivElement>(null);
  /** The ornaments shown first: 18 (10 on phones), the chosen one among them; all of them in "See more". */
  const phone = useMediaQuery(PHONE);
  const [allOrnaments, setAllOrnaments] = useState(false);
  const firstOrnaments = ORNAMENT_PICKS.slice(0, phone ? 10 : 18);
  const shownOrnaments = firstOrnaments.includes(cover.ornament) ? firstOrnaments : [...firstOrnaments.slice(0, -1), cover.ornament];

  useEffect(() => {
    api<{ templates: { id: number; name: string; design: CoverDesign; creator: string | null; canDelete: boolean }[] }>('/cover-templates')
      .then((data) =>
        setSaved(
          data.templates.map((template) => ({
            id: `sablon-${template.id}`,
            name: template.name,
            design: template.design,
            saved: { id: template.id, creator: template.creator, canDelete: template.canDelete },
          })),
        ),
      )
      .catch(() => undefined);
  }, []);

  const all = [...TEMPLATES, ...saved];
  const colors = colorsOf(cover);
  const change = (patch: Partial<CoverDesign>) => onChange({ ...cover, ...patch });

  async function saveTemplate() {
    setBusy(true);
    setNote('');
    try {
      const label = name.trim() || t('books.templateDefaultName', { n: saved.length + 1 });
      const { template } = await api<{ template: { id: number; name: string; design: CoverDesign; creator: string | null; canDelete: boolean } }>(
        '/cover-templates',
        { method: 'POST', body: { name: label, design: cover } },
      );
      const added: CoverTemplate = {
        id: `sablon-${template.id}`,
        name: template.name,
        design: template.design,
        saved: { id: template.id, creator: template.creator, canDelete: true },
      };
      setSaved((list) => [...list, added]);
      onChange({ ...cover, template: added.id });
      setName('');
      setNote(t('books.templateSaved', { name: template.name }));
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(template: CoverTemplate) {
    try {
      await api(`/cover-templates/${template.saved!.id}`, { method: 'DELETE' });
      setSaved((list) => list.filter((item) => item.id !== template.id));
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  return (
    <section className="studio-group cover-studio" aria-labelledby="cover-title">
      <div className="studio-group-head">
        <h2 id="cover-title">{t('books.cover')}</h2>
        <p className="muted">{t('books.coverHint')}</p>
      </div>

      <div className="studio-label-row">
        <h3 className="studio-label">{t('books.template')}</h3>
        <ScrollHint target={templatesRow} />
      </div>
      <div className="templates" ref={templatesRow}>
        {all.map((template) => (
          <div key={template.id} className="tpl-item">
            <button
              type="button"
              className="tpl"
              aria-pressed={cover.template === template.id}
              onClick={() => onChange({ ...template.design, colors: template.design.colors, template: template.id })}
            >
              <BookCover design={template.design} title={title} subject={subject} author={author} />
              <span>{template.name}</span>
            </button>
            {template.saved && <span className="tpl-mine">{t('books.templateSavedBadge')}</span>}
            {template.saved?.canDelete && (
              <button type="button" className="tpl-del" aria-label={t('books.templateDelete', { name: template.name })} onClick={() => void removeTemplate(template)}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <h3 className="studio-label">{t('books.layout')}</h3>
      <div className="seg-cards">
        {(Object.keys(LAYOUTS) as LayoutId[]).map((layout) => (
          <button key={layout} type="button" aria-pressed={cover.layout === layout} onClick={() => change({ layout })}>
            <span className={`sketch is-${layout}`} aria-hidden="true" />
            {LAYOUTS[layout][lang]}
          </button>
        ))}
      </div>

      <h3 className="studio-label">{t('books.ornament')}</h3>
      <div className="ornament-grid">
        {shownOrnaments.map((ornament) => (
          <OrnamentChoice key={ornament} id={ornament} selected={cover.ornament === ornament} onPick={(id) => change({ ornament: id })} />
        ))}
      </div>
      <button type="button" className="ornament-more" aria-haspopup="dialog" onClick={() => setAllOrnaments(true)}>
        <LayoutGrid size={16} aria-hidden="true" /> {t('books.ornamentsMore', { n: ORNAMENT_IDS.length })} <ArrowRight size={16} aria-hidden="true" />
      </button>
      {allOrnaments && (
        <OrnamentPicker
          value={cover.ornament}
          onPick={(id) => {
            change({ ornament: id });
            setAllOrnaments(false);
          }}
          onClose={() => setAllOrnaments(false)}
        />
      )}

      <h3 className="studio-label">
        {t('books.colors')} <span className="muted">· {cover.colors ? t('books.ownColors') : PALETTES[cover.palette]?.[lang]}</span>
      </h3>
      <div className="cover-swatches">
        {Object.entries(PALETTES).map(([id, palette]) => (
          <button
            key={id}
            type="button"
            className="cover-swatch"
            title={palette[lang]}
            aria-label={palette[lang]}
            aria-pressed={!cover.colors && cover.palette === id}
            style={{ '--c1': palette.c1, '--c2': palette.c2, '--ink-c': palette.ink } as CSSProperties}
            onClick={() => onChange({ ...cover, palette: id, colors: undefined })}
          />
        ))}
      </div>
      {/* Not ready yet: shown, but not usable. */}
      <InDevelopment>
        <div className="own-colors">
          <b>{t('books.ownColors')}</b>
          {(['c1', 'c2', 'ink'] as const).map((key) => (
            <label key={key}>
              <input
                type="color"
                value={hexOf(colors[key])}
                onChange={(event) => change({ colors: { c1: colors.c1, c2: colors.c2, ink: colors.ink, [key]: event.target.value } })}
              />
              {t(`books.color.${key}`)}
            </label>
          ))}
          {cover.colors && (
            <button type="button" className="btn btn-soft btn-sm" onClick={() => change({ colors: undefined })}>
              {t('books.paletteColors')}
            </button>
          )}
        </div>
      </InDevelopment>

      <InDevelopment>
        <div className="save-template">
          <label className="field">
            <span className="field-label">{t('books.templateName')}</span>
            <input className="input" maxLength={40} value={name} placeholder={t('books.templateNamePlaceholder')} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void saveTemplate()}>
            <Bookmark size={16} /> {t('books.templateSave')}
          </button>
        </div>
        <p className={`note${note ? ' is-ok' : ''}`}>{note || t('books.templateHint')}</p>
      </InDevelopment>
      <p className="muted small studio-foot">
        <BookOpen size={14} /> {t('books.coverStored')}
      </p>
    </section>
  );
}
