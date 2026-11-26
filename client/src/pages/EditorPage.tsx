import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, BookOpen, CalendarClock, ChevronDown, Copy, ExternalLink, Eye, FilePen, History, Link2Off, MessageCircleOff, Send, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { BackToTop } from '@/components/BackToTop';
import { BannerPicker } from '@/components/BannerPicker';
import { FoldCard } from '@/components/editor/FoldCard';
import { CategorySelect } from '@/components/CategorySelect';
import { ConfirmBubble } from '@/components/ConfirmBubble';
import { DateTimePicker } from '@/components/DateRangePicker';
import { RichEditor } from '@/components/editor/RichEditor';
import { ScheduledDialog } from '@/components/editor/ScheduledDialog';
import { SeoFields } from '@/components/editor/SeoFields';
import { TagsField } from '@/components/editor/TagsField';
import { VersionsDialog } from '@/components/editor/VersionsDialog';
import type { Version } from '@/components/editor/VersionsDialog';
import { MenuButton } from '@/components/MenuButton';
import { ConfirmModal, Modal } from '@/components/Modal';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { api } from '@/lib/api';
import { bookEditorPath, chapterEditorPath } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import { articlePath, articlesPath, postPath } from '@/lib/paths';
import { showToast } from '@/lib/toast';
import { useMediaQuery } from '@/lib/useMediaQuery';
import type { Author, Book, EditablePost } from '@/lib/types';

/** The post's state in the form: a draft; published (`published`), or to be published now (`now`, only until that's
 *  saved); scheduled. */
type Mode = 'draft' | 'now' | 'schedule' | 'published';

/** The three states one picks between (the publishing toggle). */
type State = 'draft' | 'live' | 'schedule';
const STATES: { state: State; icon: typeof Send }[] = [
  { state: 'draft', icon: FilePen },
  { state: 'live', icon: Send },
  { state: 'schedule', icon: CalendarClock },
];
const stateOf = (mode: Mode): State => (mode === 'now' || mode === 'published' ? 'live' : mode);

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  bannerUrl: string | null;
  /** Who made the banner and its licence (filled in for an image from a library); its link stays as it came. */
  bannerCredit: string;
  bannerCreditUrl: string | null;
  /** An article's category (a chapter has none: its book has one). */
  categoryId: number | null;
  mode: Mode;
  scheduleAt: string; // <input type="datetime-local"> value, local time
  commentsEnabled: boolean;
  /** A chapter: its book (its author's), and its number there; null: after the others (the server picks). An
   *  article has none. */
  bookId: number | null;
  chapterNo: number | null;
  /** The author's username. Administrators pick it (they write in an author's name); for authors it's their own. */
  author: string;
  tags: string[];
  /** For search engines and shares (empty: the title, the excerpt, the banner). */
  seoTitle: string;
  seoDescription: string;
  socialImageUrl: string | null;
}

const blankForm = (author: string, bookId: number | null = null): FormState => ({
  title: '',
  slug: '',
  excerpt: '',
  contentHtml: '',
  bannerUrl: null,
  bannerCredit: '',
  bannerCreditUrl: null,
  categoryId: null,
  mode: 'draft',
  scheduleAt: '',
  commentsEnabled: true,
  bookId,
  chapterNo: null,
  author,
  tags: [],
  seoTitle: '',
  seoDescription: '',
  socialImageUrl: null,
});

/** Everything saves itself (there's no Save button): text this long after the last change; a setting (a tag, the
 *  category, a switch, the date it's scheduled for) at once. One that couldn't (offline, say) tries again after
 *  RETRY_MS. */
const AUTOSAVE_MS = 4000;
const SETTING_MS = 400;
const RETRY_MS = 15_000;
/** What's typed (saved once the typing pauses); any other change is a setting. */
const TYPED: (keyof FormState)[] = ['title', 'contentHtml', 'excerpt', 'slug', 'seoTitle', 'seoDescription', 'bannerCredit'];

/** Whether there's anything written yet (a title, a summary, text, a picture, a banner, a tag): an empty post isn't
 *  saved by itself. */
function hasContent(form: FormState) {
  const text = form.contentHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return Boolean(form.title.trim() || form.excerpt.trim() || text || /<(img|iframe|table|hr)\b/.test(form.contentHtml) || form.bannerUrl || form.tags.length);
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
    // A copy from before a field existed gets it, empty.
    return value && typeof value.at === 'number' && value.form ? { ...value, form: { ...blankForm(value.form.author ?? ''), ...value.form } } : null;
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
    bannerCredit: post.bannerCredit?.text ?? '',
    bannerCreditUrl: post.bannerCredit?.url ?? null,
    categoryId: post.category?.id ?? null,
    mode: post.status === 'draft' ? 'draft' : post.status === 'scheduled' ? 'schedule' : 'published',
    scheduleAt: post.status === 'scheduled' && post.publishedAt ? toLocalInput(post.publishedAt) : '',
    commentsEnabled: post.commentsEnabled,
    bookId: post.book?.id ?? null,
    chapterNo: post.book?.chapter ?? null,
    author: post.author.username,
    tags: post.tags ?? [],
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
    socialImageUrl: post.socialImageUrl ?? null,
  };
}

/** The editor's addresses, and the API's (which mirrors them): an article, or a chapter under its book. */
const editorBase = (kind: Kind, username: string, bookId: number | null) =>
  kind === 'chapter' ? `/u/${encodeURIComponent(username)}/carti/${bookId ?? 0}/capitole` : `/u/${encodeURIComponent(username)}/articole`;

type Kind = 'post' | 'chapter';

/**
 * Writing an article (`kind` post: /jurnalul-meu/nou, /jurnalul-meu/{id}) or a chapter of a book
 * (/cartile-mele/{book}/capitole/nou, .../capitole/{id}): the same editor; an article has a category, a chapter
 * its book and its number there. Authors write under their own name; administrators always in an author's (picked
 * here; a new one at an author's address starts with them).
 */
export function EditorPage({ kind = 'post' }: { kind?: Kind }) {
  const { id, book: bookParam } = useParams();
  const postId = id ? Number(id) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const fromPost = (location.state as { from?: string } | null)?.from === 'post';
  const { t, errorMessage, formatDateTime } = useI18n();
  const { reload: reloadCategories } = useCategories();
  const { user, isOwner } = useAuth();
  const me = user!; // RequireRole: signed in, and a writer
  // Authors write under their own name; administrators pick an author (no one at first).
  const startAuthor = isOwner ? '' : me.username;
  /** A chapter: the book in the address (a new one's, from the book's page). */
  const routeBook = kind === 'chapter' ? Number(bookParam) || null : null;
  const startBook = postId ? null : routeBook;

  const [post, setPost] = useState<EditablePost | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(startAuthor, startBook));
  /** The summary, the address, search and sharing, comments: folded away until asked for. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** A chapter: its book and number, and the version history; folded away too. */
  const [placeOpen, setPlaceOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(blankForm(startAuthor, startBook)));
  /** A chapter: its author's books, to keep it in or move it to (null while loading). */
  const [bookList, setBookList] = useState<Book[] | null>(null);
  /** Administrators: the authors they can write for (null while loading). */
  const [authors, setAuthors] = useState<Author[] | null>(null);
  const [editorKey, setEditorKey] = useState('new');
  const [loading, setLoading] = useState(Boolean(postId));
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Moving it on or off the site (publishing it, taking it off, scheduling it again): asked first, over the toggle
   *  (the state it would go to, where it was picked; `rect`: the toggle's place on the screen). */
  const [confirming, setConfirming] = useState<{ kind: 'publish' | 'unpublish' | 'schedule'; target: State; rect: DOMRect } | null>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  /** What the author has scheduled already (from the scheduling picker). */
  const [scheduledOpen, setScheduledOpen] = useState(false);
  /** Deleting it, or turning its comments off or on: asked first, in a dialog (as leaving with changes not saved). */
  const [asking, setAsking] = useState<'delete' | 'commentsOff' | 'commentsOn' | null>(null);
  const [error, setError] = useState('');
  const loadedId = useRef<number | null>(null);
  const allowLeave = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Narrow screens: an app-style bar on top (back, state, settings), the post's settings in a sheet.
  const compact = useMediaQuery('(max-width: 980px)');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  /** A copy kept on this device that differs from the saved post: offered back. */
  const [offer, setOffer] = useState<Backup | null>(null);
  /** The save under way (an autosave can be), which the next one waits for: two saves of a new post would make two. */
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  /** An earlier version was brought back: the next save keeps the text it replaces as a version too. */
  const restoredVersion = useRef(false);
  const [previewBusy, setPreviewBusy] = useState(false);

  /** Back: a chapter to its book; an article to the articles (an author's own list, or every post for administrators). */
  const listBook = post?.book?.id ?? routeBook;
  const listPath =
    kind === 'chapter' && listBook ? bookEditorPath(listBook) : isOwner ? '/admin/articole' : articlesPath();
  const listLabel = kind === 'chapter' ? t('books.backToBook') : t('manage.title');
  /** Where it will be read, with this address (a chapter: under its book). */
  const addressOf = (slug: string) => {
    const book = bookList?.find((candidate) => candidate.id === form.bookId) ?? post?.book;
    return kind === 'chapter' && book ? `/carti/${book.slug}/${slug}` : `/posts/${slug}`;
  };
  const viewLabel = kind === 'chapter' ? t('editor.viewChapter') : t('editor.view');

  const dirty = JSON.stringify(form) !== snapshot;
  const saved = useMemo(() => JSON.parse(snapshot) as FormState, [snapshot]);
  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));
  const setContent = useRef((contentHtml: string) => setForm((current) => ({ ...current, contentHtml }))).current;

  useEffect(() => {
    if (!postId && loadedId.current !== null) {
      // Went from editing a post to "new post": the router reuses this component, so reset it.
      loadedId.current = null;
      setPost(null);
      setForm(blankForm(startAuthor, startBook));
      setSnapshot(JSON.stringify(blankForm(startAuthor, startBook)));
      setEditorKey(`new-${Date.now()}`);
    }
    if (!postId || loadedId.current === postId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ post: EditablePost }>(`${editorBase(kind, me.username, routeBook)}/${postId}`)
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
  // or after an administrator gave it to another author), a chapter's book (moved to another).
  useEffect(() => {
    if (!post) return;
    const path = post.book ? chapterEditorPath(post.book.id, post.id) : articlePath(post.id);
    if (location.pathname !== path) navigate(path, { replace: true, state: location.state });
    // Only when the post changes (loaded or saved).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  // A chapter: its author's books (it's in one of them, and may move to another).
  useEffect(() => {
    if (kind !== 'chapter' || !form.author) return;
    let cancelled = false;
    api<{ books: Book[] }>(`/u/${encodeURIComponent(form.author)}/carti`)
      .then((data) => !cancelled && setBookList(data.books))
      .catch(() => !cancelled && setBookList([]));
    return () => {
      cancelled = true;
    };
  }, [form.author]);

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

  // Everything saves itself, drafts and published posts alike (a published one's changes go live as they're saved):
  // text once the typing pauses, a setting at once. Not while it couldn't be saved as it is: a post out (or to come
  // out) needs a title, one scheduled a date to come; nor the publishing itself (`now`), which the toggle saves. A
  // copy found on this device (`offer`) doesn't stop it: going on writing is saved, and the copy can still be brought
  // back until it's dismissed.
  const titleOk = form.mode === 'draft' || Boolean(form.title.trim());
  const scheduleOk = form.mode !== 'schedule' || (Boolean(form.scheduleAt) && new Date(form.scheduleAt) > new Date());
  const canAutosave = form.mode !== 'now' && hasContent(form) && !needsAuthor && titleOk && scheduleOk;
  const typing = TYPED.some((key) => form[key] !== saved[key]);
  const delay = autosave === 'failed' ? RETRY_MS : typing ? AUTOSAVE_MS : SETTING_MS;
  useEffect(() => {
    if (!dirty || !canAutosave || saving || autosave === 'saving') return;
    const timer = window.setTimeout(() => void save({ quiet: true }), delay);
    return () => window.clearTimeout(timer);
    // `save` is a new function each render; the timer uses this render's (with this form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, canAutosave, saving, autosave, delay]);

  // Leaving the page or the app (another tab, the phone's home screen, closing it): saved at once, not 4 s later.
  const saveNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveNow.current = () => {
      if (dirty && canAutosave && !saving) void save({ quiet: true });
    };
  });
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveNow.current();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

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
  // Leaving the post, not its address changing (a new post's first save, another author, another book).
  const samePost = (pathname: string) => loadedId.current !== null && pathname.endsWith(`/${kind === 'chapter' ? 'capitole' : 'jurnalul-meu'}/${loadedId.current}`);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname && !samePost(nextLocation.pathname),
  );
  // Leaving with changes not saved yet (a moment after typing): they're saved, then it goes on. Only when they can't
  // be (no title for a published post, say) or the save fails, it asks.
  const [leaveSave, setLeaveSave] = useState<'saving' | 'failed' | null>(null);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      setLeaveSave(null);
      return;
    }
    if (!canAutosave) {
      setLeaveSave('failed');
      return;
    }
    setLeaveSave('saving');
    void save({ quiet: true }).then((ok) => {
      if (!ok) return setLeaveSave('failed');
      allowLeave.current = true;
      blocker.proceed();
    });
    // Once, when a leaving is stopped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  /**
   * Saves the post (`sent`: this form, or the one a toggle just made). What's typed meanwhile stays as it is: it's
   * saved next time. The state comes back from the server (a post published now has its date, and its address).
   * `quiet` (every save but the publishing toggle's): no error message, the bar says it couldn't. True once saved.
   */
  async function save({ quiet = false, sent = form }: { quiet?: boolean; sent?: FormState } = {}): Promise<boolean> {
    if (!quiet) setError('');
    if (!quiet && sent.mode === 'schedule' && (!sent.scheduleAt || new Date(sent.scheduleAt) <= new Date())) {
      setError(t('editor.scheduleInPast'));
      return false;
    }
    // Administrators write in an author's name: one must be picked.
    const author = isOwner ? authors?.find((candidate) => candidate.username === sent.author) : undefined;
    if (isOwner && !author) {
      if (!quiet) setError(t('error.author_required'));
      return false;
    }
    const run = async (): Promise<boolean> => {
      // After an autosave created it, a new post is saved by its id (not created again).
      const existingId = loadedId.current ?? postId;
      const body = {
        title: sent.title,
        slug: sent.slug,
        excerpt: sent.excerpt,
        contentHtml: sent.contentHtml,
        bannerUrl: sent.bannerUrl,
        bannerCredit: sent.bannerCredit.trim() || null,
        bannerCreditUrl: sent.bannerCredit.trim() ? sent.bannerCreditUrl : null,
        // An article: its category; a chapter: its book and its number there.
        ...(kind === 'chapter' ? { bookId: sent.bookId, chapterNo: sent.chapterNo } : { categoryId: sent.categoryId }),
        commentsEnabled: sent.commentsEnabled,
        tags: sent.tags,
        seoTitle: sent.seoTitle,
        seoDescription: sent.seoDescription,
        socialImageUrl: sent.socialImageUrl,
        ...(restoredVersion.current ? { restoredVersion: true } : {}),
        ...(author ? { authorId: author.id } : {}),
        status: sent.mode === 'draft' ? 'draft' : 'published',
        publishedAt:
          sent.mode === 'schedule'
            ? new Date(sent.scheduleAt).toISOString()
            : sent.mode === 'published'
              ? (post?.publishedAt ?? null)
              : null,
      };
      setAutosave('saving');
      if (!quiet) setSaving(true);
      try {
        // New ones go to their author's list (a chapter: their book); the server places them by the address.
        const base = editorBase(kind, author?.username ?? me.username, sent.bookId);
        const result = existingId
          ? await api<{ id: number; username: string; bookId: number | null }>(`${base}/${existingId}`, { method: 'PUT', body })
          : await api<{ id: number; username: string; bookId: number | null }>(base, { method: 'POST', body });
        const { post: saved } = await api<{ post: EditablePost }>(`${editorBase(kind, result.username, result.bookId)}/${result.id}`);
        loadedId.current = saved.id;
        restoredVersion.current = false;
        setPost(saved);
        writeBackup(null, null);
        writeBackup(saved.id, null);
        // Its state as saved: published now is "published" (with its date); out, it has its address (a draft's
        // follows its title until then, so it stays empty).
        const back = formFromPost(saved);
        const synced = { mode: back.mode, scheduleAt: back.scheduleAt, ...(back.mode !== 'draft' && !sent.slug ? { slug: back.slug } : {}) };
        setSnapshot(JSON.stringify({ ...sent, ...synced }));
        setForm((current) => ({
          ...current,
          ...(current.mode === sent.mode && current.scheduleAt === sent.scheduleAt ? { mode: synced.mode, scheduleAt: synced.scheduleAt } : {}),
          ...(synced.slug && current.slug === sent.slug ? { slug: synced.slug } : {}),
        }));
        setAutosave('saved');
        void reloadCategories(); // post counts changed
        return true;
      } catch (err) {
        setAutosave('failed');
        if (!quiet) setError(errorMessage(err));
        return false;
      } finally {
        if (!quiet) setSaving(false);
      }
    };
    const previous = inFlight.current;
    const current = (async () => {
      await previous?.catch(() => undefined);
      return run();
    })();
    inFlight.current = current;
    return current;
  }

  /**
   * The publishing toggle: a draft, out, or scheduled. Going out (a draft's or a scheduled one's: it's announced to
   * readers) and coming off the site (to a draft, or scheduled again) are asked first (`confirming`). Scheduling waits
   * for a date to come, then saves itself.
   */
  function choose(next: State) {
    setError('');
    setConfirming(null);
    if (next === stateOf(form.mode)) return;
    const out = post?.status === 'published';
    const ask = (kind: 'publish' | 'unpublish' | 'schedule') => {
      const rect = toggleRef.current?.getBoundingClientRect();
      if (rect) setConfirming({ kind, target: next, rect });
    };
    if (next === 'live') {
      if (!form.title.trim()) setError(t('editor.titleNeeded'));
      else ask('publish');
    } else if (next === 'schedule') {
      if (out) ask('schedule');
      else update({ mode: 'schedule' });
    } else if (out) ask('unpublish');
    else void apply('draft');
  }

  /** "Yes" to the question over the toggle. */
  function confirmState() {
    if (!confirming) return;
    if (confirming.kind === 'publish') void apply('now');
    else if (confirming.kind === 'unpublish') void apply('draft');
    else {
      setConfirming(null);
      update({ mode: 'schedule' });
    }
  }

  /** Puts the post in this state and saves it; if that fails, it stays as it was. */
  async function apply(mode: Mode) {
    setConfirming(null);
    const before = { mode: form.mode, scheduleAt: form.scheduleAt };
    const next = { ...form, mode };
    setForm(next);
    // A new one with nothing in it yet: saved with what's written first.
    if (!post && !hasContent(next)) return;
    const ok = await save({ sent: next });
    if (!ok) setForm((current) => ({ ...current, ...before }));
    else if (mode === 'now') showToast({ message: t(kind === 'chapter' ? 'editor.toastPublishedChapter' : 'editor.toastPublished') });
    else if (mode === 'draft' && before.mode !== 'draft') showToast({ message: t('editor.toastUnpublished') });
  }

  function restoreOffer() {
    if (!offer) return;
    setForm(offer.form);
    setEditorKey(`restored-${offer.at}`); // the text editor takes its content when it's created
    setOffer(null);
  }

  function restoreVersion(version: Version) {
    setForm((current) => ({
      ...current,
      title: version.title,
      excerpt: version.excerpt,
      contentHtml: version.contentHtml,
      bannerUrl: version.bannerUrl,
      // A version keeps no credit: one for another banner wouldn't fit.
      ...(version.bannerUrl !== current.bannerUrl ? { bannerCredit: '', bannerCreditUrl: null } : {}),
    }));
    setEditorKey(`version-${version.id}-${Date.now()}`);
    restoredVersion.current = true;
    showToast({ message: t('versions.restored') });
  }

  /** The preview link: a new one (an earlier one stops working), or none. */
  async function setPreview(on: boolean) {
    if (!post) return;
    setPreviewBusy(true);
    try {
      const { token } = await api<{ token: string | null }>(`${editorBase(kind, post.author.username, post.book?.id ?? null)}/${post.id}/preview`, { method: on ? 'POST' : 'DELETE' });
      setPost({ ...post, previewToken: token });
      if (token) await copyPreview(token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function copyPreview(token: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/previzualizare/${token}`);
      showToast({ message: t('editor.previewCopied') });
    } catch {
      // No clipboard (an insecure page, or refused): the link is on screen to copy by hand.
    }
  }

  function discardOffer() {
    writeBackup(postId, null);
    setOffer(null);
  }

  /** Deletes it (asked first: `asking` "delete"). */
  async function remove() {
    setAsking(null);
    if (!postId) return;
    try {
      await api(`${editorBase(kind, post?.author.username ?? me.username, post?.book?.id ?? routeBook)}/${postId}`, { method: 'DELETE' });
      allowLeave.current = true;
      void reloadCategories();
      navigate(listPath);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

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

  const state = stateOf(form.mode);
  // The advanced cards, folded: what's in them, in a line.
  const shortExcerpt = form.excerpt.trim().length > 60 ? `${form.excerpt.trim().slice(0, 60).trimEnd()}…` : form.excerpt.trim();
  const slugNow = form.slug.trim() || post?.slug || '';
  const excerptSummary = [shortExcerpt || t('editor.excerptAuto'), slugNow && `/${slugNow}`].filter(Boolean).join(' · ');
  const seoSummary = form.seoTitle.trim() || form.seoDescription.trim() || form.socialImageUrl ? t('editor.seoCustom') : t('editor.seoAuto');
  // The advanced settings someone changed (the toggle says so while they're folded away).
  const advancedChanged = Boolean(form.excerpt.trim() || form.seoTitle.trim() || form.seoDescription.trim() || form.socialImageUrl || !form.commentsEnabled);
  // Folded, it still says where the chapter is.
  const placeBook = bookList?.find((book) => book.id === form.bookId);
  const placeHint = !placeBook
    ? t('editor.placeHintNone')
    : form.chapterNo
      ? t('editor.placeHint', { book: placeBook.title, no: form.chapterNo })
      : t('editor.placeHintLast', { book: placeBook.title });

  // The post's settings: in the sidebar on wide screens, in a sheet on narrow ones.
  const settings = (
    <>
      {/* Narrow screens (wide ones have it in the top bar): where it's read, first of all. */}
      {post && compact && !fromPost && (
        <Link to={postPath(post)} className="btn btn-secondary btn-block" target="_blank">
          <ExternalLink size={15} /> {viewLabel}
        </Link>
      )}

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

      {/* Its state, a toggle (each change saves itself: there's no Save button), and what that state means. */}
      <section className="card side-card">
        <h2 className="side-title">{t('editor.publishing')}</h2>
        <div ref={toggleRef} className="state-toggle" role="radiogroup" aria-label={t('editor.publishing')}>
          {STATES.map(({ state: option, icon: Icon }) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={state === option}
              className={`state-option is-${option}`}
              disabled={saving}
              onClick={() => choose(option)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{t(`editor.state.${option}`)}</span>
            </button>
          ))}
        </div>
        {state === 'schedule' ? (
          <div className="field">
            {/* The day and time, picked as the notifications' period is (a panel; a sheet on phones). */}
            <MenuButton
              title={t('editor.publishDate')}
              buttonClassName={`filter-field schedule-field${form.scheduleAt ? ' has-value' : ''}`}
              panelClassName="filter-popover"
              button={
                <>
                  <CalendarClock size={17} aria-hidden="true" />
                  <span className="filter-field-text">
                    <span className="filter-field-label">{t('editor.publishDate')}</span>
                    <span className="filter-field-value">{form.scheduleAt ? formatDateTime(new Date(form.scheduleAt)) : t('editor.pickMoment')}</span>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </>
              }
            >
              {(close) => (
                <DateTimePicker
                  value={form.scheduleAt ? new Date(form.scheduleAt) : null}
                  onChange={(moment) => update({ scheduleAt: toLocalInput(moment) })}
                  onDone={close}
                  onSeeScheduled={() => setScheduledOpen(true)}
                />
              )}
            </MenuButton>
            <span className="field-hint">
              {post?.status === 'scheduled' && form.scheduleAt === saved.scheduleAt && post.publishedAt
                ? t('post.scheduledFor', { date: formatDateTime(post.publishedAt) })
                : form.scheduleAt && !scheduleOk
                  ? t('editor.scheduleInPast')
                  : t('editor.scheduleHint')}
            </span>
          </div>
        ) : (
          <p className="muted small state-hint">
            {state === 'live' && post?.publishedAt
              ? `${t('editor.publishedOn', { date: formatDateTime(post.publishedAt) })}. ${t('editor.liveHint')}`
              : t('editor.draftHint')}
          </p>
        )}
        {!titleOk && error !== t('editor.titleNeeded') && <p className="field-warning">{t('editor.titleNeeded')}</p>}
        {error && <p className="form-error">{error}</p>}
      </section>

      {/* Not out yet (a draft, or scheduled: it isn't public until its time): a secret link to show it to someone
          before then (it shows what's saved). Out: none. */}
      {post && post.status !== 'published' && !post.deleted && (
        <section className="card side-card">
          <h2 className="side-title">{t('editor.preview')}</h2>
          {post.previewToken ? (
            <>
              <div className="preview-link">
                <input
                  className="input"
                  readOnly
                  value={`${window.location.origin}/previzualizare/${post.previewToken}`}
                  onFocus={(event) => event.target.select()}
                  aria-label={t('editor.preview')}
                />
                <button type="button" className="icon-btn" aria-label={t('editor.previewCopy')} title={t('editor.previewCopy')} onClick={() => void copyPreview(post.previewToken!)}>
                  <Copy size={16} />
                </button>
              </div>
              <span className="field-hint">{t('editor.previewOnHint')}</span>
              <div className="preview-link-actions">
                <a href={`/previzualizare/${post.previewToken}`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">
                  <Eye size={15} /> {t('editor.previewOpen')}
                </a>
                <button type="button" className="btn btn-ghost btn-sm" disabled={previewBusy} onClick={() => void setPreview(false)}>
                  <Link2Off size={15} /> {t('editor.previewOff')}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="field-hint">{t('editor.previewHint')}</span>
              <button type="button" className="btn btn-secondary btn-block" disabled={previewBusy} onClick={() => void setPreview(true)}>
                <Eye size={15} /> {t('editor.previewCreate')}
              </button>
            </>
          )}
        </section>
      )}

      {kind !== 'chapter' && (
        <section className="card side-card">
          {/* (not a <label>: a tap in the picker would open it again) */}
          <div className="field">
            <span className="side-title">{t('editor.category')}</span>
            <CategorySelect value={form.categoryId} onChange={(categoryId) => update({ categoryId })} emptyLabel={t('editor.noCategory')} />
          </div>
        </section>
      )}

      <section className="card side-card">
        <div className="field">
          <span className="side-title">{t('editor.tags')}</span>
          <TagsField value={form.tags} onChange={(tags) => update({ tags })} hint={kind === 'chapter' ? t('editor.chapterTagsHint') : undefined} />
        </div>
      </section>

      {/* A chapter's book and place: rarely touched, so folded away under the tags. */}
      {kind === 'chapter' && (
        <>
          <button
            type="button"
            className={`editor-advanced-toggle${placeOpen ? ' is-open' : ''}`}
            aria-expanded={placeOpen}
            aria-controls="editor-place"
            onClick={() => setPlaceOpen(!placeOpen)}
          >
            <BookOpen size={16} aria-hidden="true" />
            <span className="editor-advanced-text">
              <strong>{t(placeOpen ? 'editor.placeHide' : 'editor.placeShow')}</strong>
              <span>{placeHint}</span>
            </span>
            <ChevronDown size={18} className="editor-advanced-chevron" aria-hidden="true" />
          </button>
          {placeOpen && (
            <div id="editor-place" className="editor-advanced">
              <section className="card side-card">
                <label className="field">
                  <span className="side-title">{t('editor.book')}</span>
                  {/* A chapter is always in a book: one of its author's (it can move to another). */}
                  <select
                    className="input select"
                    value={form.bookId ?? ''}
                    onChange={(event) => update({ bookId: Number(event.target.value), chapterNo: null })}
                  >
                    {bookList === null && <option value={form.bookId ?? ''}>{t('common.loading')}</option>}
                    {(bookList ?? []).map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('editor.chapterNo')}</span>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={999}
                    value={form.chapterNo ?? ''}
                    placeholder={t('editor.chapterNoAuto')}
                    onChange={(event) => update({ chapterNo: event.target.value ? Math.max(1, Math.min(999, Number(event.target.value))) : null })}
                  />
                  <span className="field-hint">{t('editor.bookHint')}</span>
                </label>
              </section>
            </div>
          )}
        </>
      )}

      {/* The summary and the address, search and sharing, comments, its earlier versions, deleting it: set once, if at
          all, so folded away. */}
      <button
        type="button"
        className={`editor-advanced-toggle${advancedOpen ? ' is-open' : ''}`}
        aria-expanded={advancedOpen}
        aria-controls="editor-advanced"
        onClick={() => setAdvancedOpen(!advancedOpen)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span className="editor-advanced-text">
          <strong>{t(advancedOpen ? 'editor.advancedHide' : 'editor.advancedShow')}</strong>
          <span>{advancedChanged ? t('editor.advancedChanged') : t('editor.advancedHint')}</span>
        </span>
        <ChevronDown size={18} className="editor-advanced-chevron" aria-hidden="true" />
      </button>

      {advancedOpen && (
        <div id="editor-advanced" className="editor-advanced">
          {/* Each folded too (its title opens it), saying in a line what it holds. */}
          <FoldCard title={t('editor.excerpt')} summary={excerptSummary}>
            <label className="field">
              <textarea
                className="input textarea"
                rows={4}
                maxLength={500}
                value={form.excerpt}
                aria-label={t('editor.excerpt')}
                onChange={(event) => update({ excerpt: event.target.value })}
              />
              <span className="field-hint">{t('editor.excerptHint')}</span>
            </label>
            <label className="field">
              <span className="side-title">{t('editor.slug')}</span>
              <input className="input" maxLength={100} value={form.slug} onChange={(event) => update({ slug: event.target.value })} />
              <span className="field-hint">{t('editor.slugHint')}</span>
            </label>
          </FoldCard>

          <FoldCard title={t('editor.seo')} summary={seoSummary}>
            <SeoFields
              value={{ seoTitle: form.seoTitle, seoDescription: form.seoDescription, socialImageUrl: form.socialImageUrl }}
              onChange={update}
              title={form.title}
              excerpt={form.excerpt}
              path={addressOf(form.slug || post?.slug || '…')}
              bannerUrl={form.bannerUrl}
            />
          </FoldCard>

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
                onChange={(event) => setAsking(event.target.checked ? 'commentsOn' : 'commentsOff')}
              />
            </label>
            {!form.commentsEnabled && (post?.existingComments ?? 0) > 0 && (
              <p className="field-warning" role="status">
                <MessageCircleOff size={16} /> {t('editor.commentsHidden')}
              </p>
            )}
          </section>

          {post && (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setVersionsOpen(true)}>
              <History size={16} /> {t('versions.title')}
            </button>
          )}

          {/* Deleting it: rarely, so in here, last. */}
          {post && (
            <button type="button" className="btn btn-danger-ghost btn-block" onClick={() => setAsking('delete')}>
              <Trash2 size={16} /> {t(kind === 'chapter' ? 'editor.deleteChapter' : 'editor.delete')}
            </button>
          )}
        </div>
      )}


    </>
  );

  return (
    <div className={`container editor-page${compact ? ' is-compact' : ''}`}>
      <div className="editor-topbar">
        {/* Opened with "Edit" on the post page: back to the post (which also makes "View post" redundant). */}
        {fromPost && post ? (
          <Link to={postPath(post)} className="back-link" aria-label={t('editor.backToPost')}>
            <ArrowLeft size={16} /> <span className="back-text">{t('editor.backToPost')}</span>
          </Link>
        ) : (
          <Link to={listPath} className="back-link" aria-label={listLabel}>
            <ArrowLeft size={16} /> <span className="back-text">{listLabel}</span>
          </Link>
        )}
        <div className="editor-topbar-status">
          {post && <span className={`badge badge-status-${post.status}`}>{t(`post.status.${post.status}`)}</span>}
          {autosave !== 'idle' && (
            <span className={`autosave-status is-${autosave}`} role="status">
              {t(`editor.autosave.${autosave}`)}
            </span>
          )}
          {post && !fromPost && !compact && (
            <Link to={postPath(post)} className="btn btn-ghost btn-sm" target="_blank">
              <ExternalLink size={15} /> {viewLabel}
            </Link>
          )}
          {compact && (
            <button type="button" className="icon-btn editor-settings-btn" aria-label={t('editor.settings')} title={t('editor.settings')} onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal size={18} />
            </button>
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
          <BannerPicker
            value={form.bannerUrl}
            credit={{ text: form.bannerCredit, url: form.bannerCreditUrl }}
            onChange={(bannerUrl, credit) => update({ bannerUrl, bannerCredit: credit?.text ?? '', bannerCreditUrl: credit?.url ?? null })}
            onCreditChange={(bannerCredit) => update({ bannerCredit })}
          />
          <textarea
            ref={titleRef}
            className="title-input"
            rows={1}
            maxLength={200}
            value={form.title}
            placeholder={t(kind === 'chapter' ? 'editor.chapterTitlePlaceholder' : 'editor.titlePlaceholder')}
            aria-label={t(kind === 'chapter' ? 'editor.chapterTitlePlaceholder' : 'editor.titlePlaceholder')}
            onChange={(event) => update({ title: event.target.value.replace(/\n/g, ' ') })}
          />
          <RichEditor key={editorKey} initialHtml={form.contentHtml} onChange={setContent} />
        </div>

        {!compact && <aside className="editor-side">{settings}</aside>}
      </div>

      {compact && settingsOpen && (
        <Modal title={t('editor.settings')} onClose={() => setSettingsOpen(false)} closeOnBackdrop sheet className="editor-sheet">
          <div className="editor-sheet-head">
            <h2>{t('editor.settings')}</h2>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setSettingsOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="editor-sheet-body">{settings}</div>
        </Modal>
      )}

      {versionsOpen && post && (
        <VersionsDialog
          base={`${editorBase(kind, post.author.username, post.book?.id ?? null)}/${post.id}`}
          current={{ title: form.title, contentHtml: form.contentHtml }}
          onRestore={restoreVersion}
          onClose={() => setVersionsOpen(false)}
        />
      )}

      {/* Going out or coming off the site: the page blurred, the toggle sharp with the state picked, the question under it. */}
      {confirming && (
        <ConfirmBubble
          className="state-bubble"
          rect={confirming.rect}
          pointAt={confirming.rect.left + ((STATES.findIndex((entry) => entry.state === confirming.target) + 0.5) * confirming.rect.width) / STATES.length}
          icon={confirming.kind === 'publish' ? Send : confirming.kind === 'schedule' ? CalendarClock : FilePen}
          title={t(`editor.ask.${confirming.kind}`)}
          detail={t(confirming.kind === 'publish' && post?.status === 'scheduled' ? 'editor.ask.publishScheduledBody' : `editor.ask.${confirming.kind}Body`)}
          confirmLabel={t(`editor.ask.${confirming.kind}Go`)}
          busy={saving}
          onConfirm={confirmState}
          onCancel={() => setConfirming(null)}
        >
          <div className="state-toggle">
            {STATES.map(({ state: option, icon: Icon }) => (
              <span key={option} className={`state-option is-${option}`} aria-checked={confirming.target === option} role="radio">
                <Icon size={15} aria-hidden="true" />
                <span>{t(`editor.state.${option}`)}</span>
              </span>
            ))}
          </div>
        </ConfirmBubble>
      )}

      {scheduledOpen && (
        <ScheduledDialog username={post?.author.username ?? (form.author || me.username)} currentId={post?.id ?? null} onClose={() => setScheduledOpen(false)} />
      )}

      {asking === 'delete' && (
        <ConfirmModal
          title={t(kind === 'chapter' ? 'editor.deleteChapter' : 'editor.delete')}
          message={t(kind === 'chapter' ? 'editor.confirmDeleteChapter' : 'editor.confirmDelete')}
          confirmLabel={t(kind === 'chapter' ? 'editor.deleteChapter' : 'editor.delete')}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setAsking(null)}
        />
      )}
      {(asking === 'commentsOff' || asking === 'commentsOn') && (
        <ConfirmModal
          title={t(asking === 'commentsOff' ? 'editor.commentsOffTitle' : 'editor.commentsOnTitle')}
          message={
            asking === 'commentsOff'
              ? `${t('editor.commentsOffBody')}${(post?.existingComments ?? 0) > 0 ? ` ${t('editor.commentsHidden')}` : ''}`
              : t('editor.commentsOnBody')
          }
          confirmLabel={t(asking === 'commentsOff' ? 'editor.commentsOffGo' : 'editor.commentsOnGo')}
          danger={asking === 'commentsOff'}
          onConfirm={() => {
            update({ commentsEnabled: asking === 'commentsOn' });
            setAsking(null);
          }}
          onCancel={() => setAsking(null)}
        />
      )}

      {blocker.state === 'blocked' && leaveSave === 'failed' && (
        <Modal title={t('editor.unsavedTitle')} onClose={() => blocker.reset()} head>
          <div className="modal-body">
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
      <BackToTop />
    </div>
  );
}

