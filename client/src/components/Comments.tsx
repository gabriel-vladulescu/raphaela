import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Clock, Flag, LoaderCircle, MessageCircleOff, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Collapse, slide } from '@/components/Collapse';
import { CommentReactions } from '@/components/CommentReactions';
import { GoogleButton } from '@/components/GoogleButton';
import { ConfirmModal, Modal } from '@/components/Modal';
import { ReportCommentModal } from '@/components/ReportCommentModal';
import { EmailOffModal, isEmailOff } from '@/components/EmailOffModal';
import { useAuth } from '@/context/auth';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { showToast } from '@/lib/toast';
import type { Comment } from '@/lib/types';

const MAX_LENGTH = 2000;
/** Threads loaded at a time, as you scroll. */
const PAGE_SIZE = 10;
/** Replies each "view more" brings (a page of threads brings each thread's first three: the server's REPLY_PREVIEW). */
const REPLIES_STEP = 10;
/** A whole comment's replies at once (answering under it, so the new reply lands after them): this many a request. */
const REPLIES_ALL = 50;

type Sort = 'top' | 'new';

interface CommentPage {
  enabled: boolean;
  /** Only accounts with a confirmed address comment and reply (the admin panel's setting). */
  requireVerifiedEmail: boolean;
  /** Live comments on the post, replies included. */
  total: number;
  /** This page's threads (their first comment's id), in display order. */
  order: number[];
  /** Those threads' first comments and the first replies to each, oldest first (the rest come when asked). */
  comments: Comment[];
  hasMore: boolean;
}

interface CommentNode extends Comment {
  replies: CommentNode[];
}

/** A page of a comment's replies (GET /comments/:id/replies). */
interface ReplyPage {
  replies: Comment[];
  /** All its replies now (one may have come meanwhile). */
  total: number;
  hasMore: boolean;
}

const byTime = (a: Comment, b: Comment) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id;

/** Replies in the order they were written, however they arrived (a page, "view more", one just written). */
function buildTree(list: Comment[]): Map<number, CommentNode> {
  const nodes = new Map(list.map((c) => [c.id, { ...c, replies: [] as CommentNode[] }]));
  for (const node of nodes.values()) {
    if (node.parentId !== null) nodes.get(node.parentId)?.replies.push(node);
  }
  for (const node of nodes.values()) node.replies.sort(byTime);
  return nodes;
}

/** @username, as the server finds mentions (mentionedUsernames, server/src/lib/notifications.ts). */
const MENTION = /(^|[^\w.@])@([a-z0-9]+(?:\.[a-z0-9]+)*)/gi;

/** A comment's text, with its @mentions marked. */
function CommentText({ body }: { body: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const start = match.index! + match[1]!.length;
    parts.push(body.slice(last, start));
    parts.push(
      <span key={start} className="mention">
        @{match[2]}
      </span>,
    );
    last = start + match[2]!.length + 1;
  }
  parts.push(body.slice(last));
  return <p className="t-text">{parts}</p>;
}

interface Mentionable {
  username: string;
  name: string;
  picture: string | null;
}

/** The "@na" being typed just before the caret, if any. */
function mentionAt(text: string, caret: number) {
  const match = /(?:^|[^\w.@])@([a-z0-9.]{0,30})$/i.exec(text.slice(0, caret));
  return match ? { query: match[1]!, start: caret - match[1]!.length - 1 } : null;
}

/** The form for a new comment, a reply, or an edit (`initialBody`). */
function CommentForm(props: {
  /** The post: whom @ suggests (its author and those in its discussion). */
  postId: number;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  /** Text to start from (editing). */
  initialBody?: string;
  autoFocus?: boolean;
}) {
  const { t, errorMessage } = useI18n();
  const [body, setBody] = useState(props.initialBody ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const editing = props.initialBody !== undefined;
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** @-suggestions: the word being typed, the people it matches, the highlighted one. */
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [people, setPeople] = useState<Mentionable[]>([]);
  const [picked, setPicked] = useState(0);

  useEffect(() => {
    if (!mention) return setPeople([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ people: Mentionable[] }>(`/posts/${props.postId}/mentionable?q=${encodeURIComponent(mention.query)}`)
        .then((data) => {
          if (cancelled) return;
          setPeople(data.people);
          setPicked(0);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mention?.query, props.postId]);

  const follow = (el: HTMLTextAreaElement) => setMention(mentionAt(el.value, el.selectionStart ?? el.value.length));

  function pick(person: Mentionable) {
    if (!mention) return;
    const caret = textRef.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.start)}@${person.username} ${body.slice(caret)}`;
    setBody(next.slice(0, MAX_LENGTH));
    setMention(null);
    const at = mention.start + person.username.length + 2;
    requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(at, at);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError('');
    try {
      await props.onSubmit(body.trim());
      if (!editing) setBody('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="comment-form" onSubmit={submit}>
      <textarea
        ref={textRef}
        className="input textarea"
        rows={editing || props.onCancel ? 3 : 2}
        maxLength={MAX_LENGTH}
        value={body}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        // Editing: start with the caret after the existing text.
        onFocus={(event) => editing && event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
        onChange={(event) => {
          setBody(event.target.value);
          follow(event.target);
        }}
        onSelect={(event) => follow(event.currentTarget)}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        aria-autocomplete="list"
        aria-expanded={people.length > 0 && mention !== null}
        onKeyDown={(event) => {
          if (mention && people.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setPicked((index) => (index + (event.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              pick(people[picked]!);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setMention(null);
              return;
            }
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit();
          if (event.key === 'Escape' && props.onCancel) props.onCancel();
        }}
      />
      {mention && people.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label={t('comments.mention')}>
          {people.map((person, index) => (
            <li key={person.username} role="option" aria-selected={index === picked}>
              <button
                type="button"
                className={index === picked ? 'is-active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(person);
                }}
              >
                <Avatar name={person.name} picture={person.picture} size={24} />
                <span className="mention-name">{person.name}</span>
                <span className="muted small">@{person.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="comment-form-actions">
        <span className="muted small comment-form-count">
          {body.length}/{MAX_LENGTH}
        </span>
        {props.onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !body.trim() || (editing && body.trim() === props.initialBody)}>
          {!editing && <Send size={14} />} {props.submitLabel}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

export function Comments(props: {
  postId: number;
  postAuthorId: number;
  commentsEnabled: boolean;
  onCountChange?: (count: number) => void;
}) {
  const { postId, postAuthorId, onCountChange } = props;
  const { user, isOwner } = useAuth();
  const { t, plural, errorMessage, timeAgo, timeShort, formatDateTime } = useI18n();
  const location = useLocation();

  const [comments, setComments] = useState<Comment[]>([]);
  /** Threads in display order: the server's pages, with ones written here added on top. */
  const [order, setOrder] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'loading' | 'idle' | 'more' | 'error'>('loading');
  const [enabled, setEnabled] = useState(props.commentsEnabled);
  const [requireVerified, setRequireVerified] = useState(false);
  const [sort, setSort] = useState<Sort>('top');
  /** The one open form (a reply or an edit); opening another closes it. */
  const [active, setActive] = useState<{ kind: 'reply' | 'edit'; id: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  /** Comments whose next replies are on their way ("view more"). */
  const [loadingReplies, setLoadingReplies] = useState<Set<number>>(new Set());
  /** The discussion came near: it loads then, not with the page (many readers never reach it). */
  const [near, setNear] = useState(false);
  /** The comment whose options sheet is open (phones), and the one waiting for a delete confirmation. */
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [reporting, setReporting] = useState<number | null>(null);
  const [error, setError] = useState('');

  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  /** The comments as they are now (for what arrives later: which ones are new). */
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  /** Comments to animate in when they first appear (new ones, and replies revealed by "view more"). */
  const entering = useRef(new Set<number>());
  /** Threads the server has sent so far: where the next page starts. */
  const loadedFromServer = useRef(0);
  const request = useRef(0);

  const loadPage = useCallback(
    async (reset: boolean) => {
      const id = ++request.current;
      setStatus(reset ? 'loading' : 'more');
      const offset = reset ? 0 : loadedFromServer.current;
      try {
        const page = await api<CommentPage>(`/posts/${postId}/comments?sort=${sort}&offset=${offset}&limit=${PAGE_SIZE}`);
        if (id !== request.current) return; // a newer request (another sort, or signing in) won
        loadedFromServer.current = offset + page.order.length;
        setEnabled(page.enabled);
        setRequireVerified(page.requireVerifiedEmail);
        setTotal(page.total);
        setHasMore(page.hasMore);
        // Pages can overlap when comments were added meanwhile; keep each thread once.
        setComments((list) => {
          const base = reset ? [] : list;
          const known = new Set(base.map((c) => c.id));
          return [...base, ...page.comments.filter((c) => !known.has(c.id))];
        });
        setOrder((list) => {
          const base = reset ? [] : list;
          return [...base, ...page.order.filter((rootId) => !base.includes(rootId))];
        });
        setStatus('idle');
      } catch {
        if (id === request.current) setStatus('error');
      }
    },
    [postId, sort],
  );

  // Nothing until the discussion comes near (a screen or so away), then the first page.
  useEffect(() => {
    const section = sectionRef.current;
    if (near || !section) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setNear(true), { rootMargin: '800px 0px' });
    observer.observe(section);
    return () => observer.disconnect();
  }, [near]);

  // The first page; again when the sort changes, or the viewer does ("your" reactions; owners also get deleted ones).
  useEffect(() => {
    if (near) void loadPage(true);
  }, [near, loadPage, user?.id, user?.role]);

  // The next page when the end of the list comes near. Observing again after each page also catches a sentinel
  // that's still in view (short pages).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || status !== 'idle') return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadPage(false), { rootMargin: '600px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, status, loadPage]);

  useEffect(() => {
    if (status !== 'loading') onCountChange?.(enabled ? total : 0);
  }, [enabled, total, status, onCountChange]);

  const nodes = useMemo(() => buildTree(comments), [comments]);
  const threads = order.map((id) => nodes.get(id)).filter((node): node is CommentNode => node !== undefined);

  // Members and authors manage only their own comments; owners can also remove anyone's.
  const canEdit = (c: Comment) => user?.id === c.author.id && c.deletedAt === null;
  const canDelete = (c: Comment) => (user?.id === c.author.id || isOwner) && c.deletedAt === null;
  /** Signed in, but commenting waits for a confirmed address (the admin panel's setting). */
  const mustVerify = Boolean(user) && requireVerified && !user!.emailVerified && !isOwner;
  const canWriteComments = Boolean(user) && !mustVerify;
  // Anyone signed in can report someone else's comment (administrators delete it instead).
  const canReport = (c: Comment) => Boolean(user) && !isOwner && user?.id !== c.author.id && c.deletedAt === null;
  /** A deleted account's comments stay, without its name. */
  const nameOf = (c: Comment) => (c.author.deleted ? t('comments.deletedAccount') : c.author.name);

  const updateComment = (id: number, fn: (c: Comment) => Comment) => setComments((list) => list.map((c) => (c.id === id ? fn(c) : c)));

  /**
   * A comment's next replies (`all`: every one left, answering under it), after the `loaded` ones; they grow into
   * place, and its count follows the server's.
   */
  async function loadReplies(parentId: number, loaded: number, all = false) {
    setLoadingReplies((current) => new Set(current).add(parentId));
    setError('');
    try {
      let offset = loaded;
      for (;;) {
        const page = await api<ReplyPage>(`/comments/${parentId}/replies?offset=${offset}&limit=${all ? REPLIES_ALL : REPLIES_STEP}`);
        const known = new Set(commentsRef.current.map((c) => c.id));
        for (const reply of page.replies) if (!known.has(reply.id)) entering.current.add(reply.id);
        setComments((list) => {
          const have = new Set(list.map((c) => c.id));
          return [...list, ...page.replies.filter((c) => !have.has(c.id))].map((c) => (c.id === parentId ? { ...c, replyCount: page.total } : c));
        });
        offset += page.replies.length;
        if (!all || !page.hasMore) break;
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingReplies((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
  }
  const toggleForm = (kind: 'reply' | 'edit', id: number) => setActive((current) => (current?.kind === kind && current.id === id ? null : { kind, id }));

  async function addComment(body: string, parentId: number | null) {
    const { comment } = await api<{ comment: Comment }>(`/posts/${postId}/comments`, { method: 'POST', body: { body, parentId } });
    entering.current.add(comment.id);
    setComments((list) => [...list, comment].map((c) => (c.id === comment.parentId ? { ...c, replyCount: c.replyCount + 1 } : c)));
    track(comment.parentId === null ? 'comment' : 'reply', postId);
    if (comment.held) showToast({ message: t('comments.heldNotice') });
    setTotal((n) => n + 1);
    if (comment.parentId === null) {
      setOrder((list) => [comment.id, ...list]); // your new comment shows first
    } else {
      // Open the thread it went into; its replies not loaded yet come too, so the new one lands after them.
      const parentId = comment.parentId;
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
      setActive(null);
      const parent = nodes.get(parentId);
      if (parent && parent.replies.length < parent.replyCount) void loadReplies(parentId, parent.replies.length, true);
    }
  }

  async function saveEdit(comment: Comment, body: string) {
    const result = await api<{ body: string; editedAt: string; held: boolean }>(`/comments/${comment.id}`, { method: 'PATCH', body: { body } });
    updateComment(comment.id, (c) => ({ ...c, ...result }));
    if (result.held && !comment.held) showToast({ message: t('comments.heldNotice') });
    setActive(null);
  }

  async function react(comment: Comment, emoji: string) {
    const toggled = (c: Comment): Comment => {
      const had = c.mine.includes(emoji);
      const reactions = { ...c.reactions, [emoji]: (c.reactions[emoji] ?? 0) + (had ? -1 : 1) };
      if (reactions[emoji]! <= 0) delete reactions[emoji];
      return { ...c, reactions, mine: had ? c.mine.filter((e) => e !== emoji) : [...c.mine, emoji] };
    };
    updateComment(comment.id, toggled);
    setError('');
    try {
      const result = await api<Pick<Comment, 'reactions' | 'mine'>>(`/comments/${comment.id}/reactions`, { method: 'POST', body: { emoji } });
      updateComment(comment.id, (c) => ({ ...c, ...result }));
      if (result.mine.includes(emoji)) track('react', postId);
    } catch (err) {
      updateComment(comment.id, (c) => ({ ...c, reactions: comment.reactions, mine: comment.mine }));
      setError(errorMessage(err));
    }
  }

  // A soft delete: the comment and its replies slide away, except for owners, who keep seeing them greyed out.
  async function remove(node: CommentNode) {
    try {
      const { ids } = await api<{ ids: number[] }>(`/comments/${node.id}`, { method: 'DELETE' });
      const gone = new Set(ids);
      setTotal((n) => Math.max(0, n - ids.length));
      if (active && gone.has(active.id)) setActive(null);
      if (isOwner) {
        const now = new Date().toISOString();
        setComments((list) => list.map((c) => (gone.has(c.id) ? { ...c, deletedAt: now, deletedBy: user!.name } : c)));
        return;
      }
      const drop = () => {
        setComments((list) =>
          list.filter((c) => !gone.has(c.id)).map((c) => (c.id === node.parentId ? { ...c, replyCount: Math.max(0, c.replyCount - 1) } : c)),
        );
        if (node.parentId === null) {
          setOrder((list) => list.filter((id) => id !== node.id));
          loadedFromServer.current = Math.max(0, loadedFromServer.current - 1); // the server's pages moved up by one
        }
      };
      const el = listRef.current?.querySelector<HTMLElement>(`[data-comment="${node.id}"]`);
      if (el) slide(el, 'out', drop);
      else drop();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const toggleThread = (id: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });


  // New comments (and revealed replies) grow into place the first time they're attached.
  const enterRef = (id: number) => (el: HTMLLIElement | null) => {
    if (el && entering.current.delete(id)) slide(el, 'in');
  };

  const renderNode = (node: CommentNode): ReactNode => {
    const isCollapsed = collapsed.has(node.id);
    const deleted = node.deletedAt !== null;
    const editable = canEdit(node);
    const deletable = canDelete(node);
    const reportable = canReport(node);
    const editing = active?.kind === 'edit' && active.id === node.id;
    const replying = active?.kind === 'reply' && active.id === node.id;
    // Its replies: those loaded, and how many are still on the server ("view more" brings them).
    const hiddenReplies = Math.max(0, node.replyCount - node.replies.length);
    const hasReplies = node.replies.length > 0 || hiddenReplies > 0;
    const loadingMore = loadingReplies.has(node.id);
    const threadToggle = node.replies.length > 0 && (
      <button type="button" className="text-btn t-thread-toggle" aria-expanded={!isCollapsed} onClick={() => toggleThread(node.id)}>
        {isCollapsed ? t('comments.showReplies', { replies: plural('comments.replies', Math.max(node.replyCount, node.replies.length)) }) : t('comments.hideReplies')}
      </button>
    );
    const edited = node.editedAt && !deleted && <span title={formatDateTime(node.editedAt)}>{t('comments.edited')}</span>;

    return (
      <li key={node.id} ref={enterRef(node.id)} data-comment={node.id} className="t-item">
        <div className={`t-row${deleted ? ' is-deleted' : ''}`}>
          <div className="t-gutter">
            {/* Sized by the tree's --av (smaller on phones). */}
            <Avatar name={nameOf(node)} picture={node.author.picture} size={null} />
            {hasReplies && <span className={`t-rail${isCollapsed ? ' is-hidden' : ''}`} aria-hidden="true" />}
          </div>
          <div className={`t-main${deleted ? ' is-deleted' : ''}`}>
            {/* A card on wider screens; on phones, the grey bubble around the name and text. */}
            <div className={`t-bubble${editing ? ' is-editing' : ''}`}>
              <div className="t-meta">
                <strong className={node.author.deleted ? 't-gone' : undefined}>{nameOf(node)}</strong>
                {node.author.id === postAuthorId && <span className="author-badge">{t('comments.author')}</span>}
                <span className="muted small t-when">
                  <time dateTime={node.createdAt} title={formatDateTime(node.createdAt)}>
                    {timeAgo(node.createdAt)}
                  </time>
                  {edited && <> · {edited}</>}
                </span>
                {node.held && !deleted && (
                  <span className="badge badge-held" title={t('comments.heldHint')}>
                    <Clock size={12} aria-hidden="true" /> {t('comments.held')}
                  </span>
                )}
                {deleted && (
                  <span className="badge badge-deleted" title={t('comments.deletedBy', { name: node.deletedBy ?? '?', date: formatDateTime(node.deletedAt!) })}>
                    {t('comments.deleted')}
                  </span>
                )}
                {(editable || deletable || reportable) && (
                  <span className="t-tools">
                    {editable && (
                      <button
                        type="button"
                        className={`icon-btn icon-btn-sm${editing ? ' is-active' : ''}`}
                        aria-label={t('comments.edit')}
                        aria-pressed={editing}
                        title={t('comments.edit')}
                        onClick={() => toggleForm('edit', node.id)}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {deletable && (
                      <button type="button" className="icon-btn icon-btn-sm t-delete" aria-label={t('comments.delete')} title={t('comments.delete')} onClick={() => setDeleting(node.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                    {reportable && (
                      <button type="button" className="icon-btn icon-btn-sm t-report" aria-label={t('report.action')} title={t('report.action')} onClick={() => setReporting(node.id)}>
                        <Flag size={14} />
                      </button>
                    )}
                  </span>
                )}
              </div>
              {editing ? (
                <CommentForm
                  postId={postId}
                  autoFocus
                  initialBody={node.body}
                  placeholder={t('comments.placeholder')}
                  submitLabel={t('comments.save')}
                  onSubmit={(body) => saveEdit(node, body)}
                  onCancel={() => setActive(null)}
                />
              ) : (
                <CommentText body={node.body} />
              )}
            </div>
            <div className="t-actions">
              {/* Phones: when, under the bubble ("2 h · edited"). */}
              <span className="t-when-below">
                <time dateTime={node.createdAt} title={formatDateTime(node.createdAt)}>
                  {timeShort(node.createdAt)}
                </time>
                {edited && <> · {edited}</>}
              </span>
              {deleted ? (
                threadToggle
              ) : (
                <CommentReactions reactions={node.reactions} mine={node.mine} canReact={Boolean(user)} onToggle={(emoji) => void react(node, emoji)}>
                  {canWriteComments && (
                    <button type="button" className={`text-btn${replying ? ' is-active' : ''}`} aria-expanded={replying} onClick={() => toggleForm('reply', node.id)}>
                      {t('comments.reply')}
                    </button>
                  )}
                  {threadToggle}
                  {/* Phones: edit, delete and report sit behind "⋯", in a sheet (wider screens show them as icons). */}
                  {(editable || deletable || reportable) && (
                    <button type="button" className="text-btn t-more-btn" aria-label={t('comments.options')} title={t('comments.options')} aria-haspopup="dialog" onClick={() => setMenuFor(node.id)}>
                      <MoreHorizontal size={17} />
                    </button>
                  )}
                </CommentReactions>
              )}
            </div>
            {/* The reply form looks like the edit form, and slides open under the comment. */}
            <Collapse open={replying}>
              <div className="t-reply-form">
                <CommentForm
                  postId={postId}
                  autoFocus
                  placeholder={t('comments.replyTo', { name: nameOf(node).split(' ')[0]! })}
                  submitLabel={t('comments.send')}
                  onSubmit={(body) => addComment(body, node.id)}
                  onCancel={() => setActive(null)}
                />
              </div>
            </Collapse>
          </div>
        </div>
        {hasReplies && (
          <Collapse open={!isCollapsed}>
            <ol className="t-children">
              {node.replies.map((reply) => renderNode(reply))}
              {hiddenReplies > 0 && (
                <li className="t-item t-more">
                  <div className="t-row">
                    <div className="t-gutter">
                      <span className="t-more-count" aria-hidden="true">
                        +{hiddenReplies}
                      </span>
                    </div>
                    <div className="t-more-main">
                      <button
                        type="button"
                        className="text-btn"
                        disabled={loadingMore}
                        aria-busy={loadingMore}
                        onClick={() => void loadReplies(node.id, node.replies.length)}
                      >
                        {loadingMore && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{' '}
                        {t(node.replies.length > 0 ? 'comments.moreReplies' : 'comments.viewReplies', { replies: plural('comments.replies', hiddenReplies) })}
                      </button>
                    </div>
                  </div>
                </li>
              )}
            </ol>
          </Collapse>
        )}
      </li>
    );
  };

  const here = location.pathname + location.search;
  const menuNode = menuFor === null ? undefined : nodes.get(menuFor);
  const deleteNode = deleting === null ? undefined : nodes.get(deleting);

  // The author turned comments off: existing ones are hidden too.
  if (!enabled) {
    return (
      <section ref={sectionRef} className="discussion" aria-labelledby="discussion-title">
        <div className="discussion-head">
          <h2 id="discussion-title">{t('comments.title')}</h2>
        </div>
        <div className="discussion-off card">
          <MessageCircleOff size={22} aria-hidden="true" />
          <p>{t('comments.disabled')}</p>
        </div>
      </section>
    );
  }

  const firstLoad = status === 'loading' && threads.length === 0;

  return (
    <section ref={sectionRef} className="discussion" aria-labelledby="discussion-title">
      <div className="discussion-head">
        <h2 id="discussion-title">
          <span className="discussion-title-text">{t('comments.title')}</span> {!firstLoad && <span className="count-pill">{total}</span>}
        </h2>
        <div className="segmented" role="group" aria-label={t('comments.sortLabel')}>
          {(['top', 'new'] as const).map((option) => (
            <button key={option} type="button" className={sort === option ? 'is-selected' : ''} aria-pressed={sort === option} onClick={() => setSort(option)}>
              {t(option === 'top' ? 'comments.sortTop' : 'comments.sortNew')}
            </button>
          ))}
        </div>
      </div>

      {mustVerify ? (
        <VerifyToComment email={user!.email} />
      ) : user ? (
        <div className="discussion-composer card">
          <Avatar name={user.name} picture={user.picture} size={38} />
          <CommentForm postId={postId} placeholder={t('comments.placeholder')} submitLabel={t('comments.submit')} onSubmit={(body) => addComment(body, null)} />
        </div>
      ) : (
        <div className="discussion-join card">
          <div className="discussion-join-body">
            <div>
              <strong>{t('comments.loginTitle')}</strong>
              <p className="muted small">{t('comments.loginBody')}</p>
            </div>
            <div className="discussion-join-actions">
              <GoogleButton next={`${here}#discussion-title`} size="medium" />
              <Link to={`/login?next=${encodeURIComponent(here)}`} className="small">
                {t('auth.otherOptions')}
              </Link>
            </div>
          </div>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      {firstLoad ? (
        <p className="muted">{t('common.loading')}</p>
      ) : threads.length === 0 && status !== 'error' ? (
        <p className="muted discussion-empty">{t('comments.empty')}</p>
      ) : (
        <ol ref={listRef} className={`t-list${status === 'loading' ? ' is-loading' : ''}`} aria-busy={status !== 'idle'}>
          {threads.map((node) => renderNode(node))}
        </ol>
      )}

      {/* Comes into view near the end of the list: loads the next threads. */}
      <div ref={sentinelRef} className="t-sentinel" aria-hidden="true" />
      {status === 'more' && (
        <p className="t-loading muted">
          <LoaderCircle size={16} className="spin" /> {t('common.loading')}
        </p>
      )}
      {status === 'error' && (
        <p className="t-loading">
          <span className="form-error">{t('comments.loadFailed')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPage(threads.length === 0)}>
            {t('comments.retry')}
          </button>
        </p>
      )}

      {menuNode && (
        <Modal title={t('comments.options')} onClose={() => setMenuFor(null)} closeOnBackdrop sheet className="comment-sheet">
          <div className="comment-sheet-body">
            <div className="menu-list">
              {canEdit(menuNode) && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuFor(null);
                    setActive({ kind: 'edit', id: menuNode.id });
                  }}
                >
                  <Pencil size={18} /> {t('comments.edit')}
                </button>
              )}
              {canDelete(menuNode) && (
                <button
                  type="button"
                  className="menu-item menu-item-danger"
                  onClick={() => {
                    setMenuFor(null);
                    setDeleting(menuNode.id);
                  }}
                >
                  <Trash2 size={18} /> {t('comments.delete')}
                </button>
              )}
              {canReport(menuNode) && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuFor(null);
                    setReporting(menuNode.id);
                  }}
                >
                  <Flag size={18} /> {t('report.action')}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {reporting !== null && <ReportCommentModal commentId={reporting} onClose={() => setReporting(null)} />}
      {deleteNode && (
        <ConfirmModal
          title={t('comments.delete')}
          message={t('comments.confirmDelete')}
          confirmLabel={t('common.delete')}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setDeleting(null);
            void remove(deleteNode);
          }}
        />
      )}
    </section>
  );
}

/** Instead of the composer, when commenting needs a confirmed address and this account's isn't yet. */
function VerifyToComment({ email }: { email: string }) {
  const { t, lang, errorMessage } = useI18n();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [mailOff, setMailOff] = useState(false);
  async function resend() {
    setState('sending');
    setError('');
    try {
      await api('/me/verify-email', { method: 'POST', body: { lang } });
      setState('sent');
    } catch (err) {
      if (isEmailOff(err)) setMailOff(true);
      else setError(errorMessage(err));
      setState('idle');
    }
  }
  return (
    <div className="discussion-join card discussion-verify">
      <div className="discussion-join-body">
        <div>
          <strong>{t('comments.verifyTitle')}</strong>
          <p className="muted small">{state === 'sent' ? t('verify.sent', { email }) : t('comments.verifyBody', { email })}</p>
          {error && <p className="form-error small">{error}</p>}
        </div>
        {state !== 'sent' && (
          <div className="discussion-join-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={state === 'sending'} onClick={() => void resend()}>
              {state === 'sending' ? t('common.loading') : t('verify.resend')}
            </button>
          </div>
        )}
      </div>
      {mailOff && <EmailOffModal detail={t('mail.offVerify')} onClose={() => setMailOff(false)} />}
    </div>
  );
}
