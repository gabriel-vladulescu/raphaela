import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { LoaderCircle, MessageCircleOff, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Collapse, slide } from '@/components/Collapse';
import { CommentReactions } from '@/components/CommentReactions';
import { GoogleButton } from '@/components/GoogleButton';
import { ConfirmModal, Modal } from '@/components/Modal';
import { useAuth } from '@/context/auth';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Comment } from '@/lib/types';

const MAX_LENGTH = 2000;
/** Threads loaded at a time, as you scroll. */
const PAGE_SIZE = 10;
/** Replies shown at first, and how many more each "view more" adds. */
const REPLIES_STEP = 5;

type Sort = 'top' | 'new';

interface CommentPage {
  enabled: boolean;
  /** Live comments on the post, replies included. */
  total: number;
  /** This page's threads (their first comment's id), in display order. */
  order: number[];
  /** Everything in those threads, oldest first. */
  comments: Comment[];
  hasMore: boolean;
}

interface CommentNode extends Comment {
  replies: CommentNode[];
}

/** Comments arrive oldest first, so replies stay in the order they were written. */
function buildTree(list: Comment[]): Map<number, CommentNode> {
  const nodes = new Map(list.map((c) => [c.id, { ...c, replies: [] as CommentNode[] }]));
  for (const node of nodes.values()) {
    if (node.parentId !== null) nodes.get(node.parentId)?.replies.push(node);
  }
  return nodes;
}

const countAll = (list: CommentNode[]): number => list.reduce((n, c) => n + 1 + countAll(c.replies), 0);

/** The form for a new comment, a reply, or an edit (`initialBody`). */
function CommentForm(props: {
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
        className="input textarea"
        rows={editing || props.onCancel ? 3 : 2}
        maxLength={MAX_LENGTH}
        value={body}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        // Editing: start with the caret after the existing text.
        onFocus={(event) => editing && event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit();
          if (event.key === 'Escape' && props.onCancel) props.onCancel();
        }}
      />
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
  const [sort, setSort] = useState<Sort>('top');
  /** The one open form (a reply or an edit); opening another closes it. */
  const [active, setActive] = useState<{ kind: 'reply' | 'edit'; id: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  /** How many replies each comment shows (REPLIES_STEP unless "view more" was used). */
  const [shown, setShown] = useState<Map<number, number>>(new Map());
  /** The comment whose options sheet is open (phones), and the one waiting for a delete confirmation. */
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState('');

  const listRef = useRef<HTMLOListElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
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

  // The first page; again when the sort changes, or the viewer does ("your" reactions; owners also get deleted ones).
  useEffect(() => {
    void loadPage(true);
  }, [loadPage, user?.id, user?.role]);

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

  const updateComment = (id: number, fn: (c: Comment) => Comment) => setComments((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  const toggleForm = (kind: 'reply' | 'edit', id: number) => setActive((current) => (current?.kind === kind && current.id === id ? null : { kind, id }));

  async function addComment(body: string, parentId: number | null) {
    const { comment } = await api<{ comment: Comment }>(`/posts/${postId}/comments`, { method: 'POST', body: { body, parentId } });
    entering.current.add(comment.id);
    setComments((list) => [...list, comment]);
    track(comment.parentId === null ? 'comment' : 'reply', postId);
    setTotal((n) => n + 1);
    if (comment.parentId === null) {
      setOrder((list) => [comment.id, ...list]); // your new comment shows first
    } else {
      // Open the thread it went into, with all its replies, so the new one is in view.
      const parentId = comment.parentId;
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
      setShown((map) => new Map(map).set(parentId, Number.MAX_SAFE_INTEGER));
      setActive(null);
    }
  }

  async function saveEdit(comment: Comment, body: string) {
    const result = await api<{ body: string; editedAt: string }>(`/comments/${comment.id}`, { method: 'PATCH', body: { body } });
    updateComment(comment.id, (c) => ({ ...c, ...result }));
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
        setComments((list) => list.filter((c) => !gone.has(c.id)));
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

  function showMoreReplies(node: CommentNode) {
    const current = shown.get(node.id) ?? REPLIES_STEP;
    for (const reply of node.replies.slice(current, current + REPLIES_STEP)) entering.current.add(reply.id);
    setShown((map) => new Map(map).set(node.id, current + REPLIES_STEP));
  }

  // New comments (and revealed replies) grow into place the first time they're attached.
  const enterRef = (id: number) => (el: HTMLLIElement | null) => {
    if (el && entering.current.delete(id)) slide(el, 'in');
  };

  const renderNode = (node: CommentNode): ReactNode => {
    const isCollapsed = collapsed.has(node.id);
    const deleted = node.deletedAt !== null;
    const editable = canEdit(node);
    const deletable = canDelete(node);
    const editing = active?.kind === 'edit' && active.id === node.id;
    const replying = active?.kind === 'reply' && active.id === node.id;
    const limit = shown.get(node.id) ?? REPLIES_STEP;
    const visibleReplies = node.replies.slice(0, limit);
    const hiddenReplies = node.replies.length - visibleReplies.length;
    const threadToggle = node.replies.length > 0 && (
      <button type="button" className="text-btn t-thread-toggle" aria-expanded={!isCollapsed} onClick={() => toggleThread(node.id)}>
        {isCollapsed ? t('comments.showReplies', { replies: plural('comments.replies', countAll(node.replies)) }) : t('comments.hideReplies')}
      </button>
    );
    const edited = node.editedAt && !deleted && <span title={formatDateTime(node.editedAt)}>{t('comments.edited')}</span>;

    return (
      <li key={node.id} ref={enterRef(node.id)} data-comment={node.id} className="t-item">
        <div className={`t-row${deleted ? ' is-deleted' : ''}`}>
          <div className="t-gutter">
            {/* Sized by the tree's --av (smaller on phones). */}
            <Avatar name={node.author.name} picture={node.author.picture} size={null} />
            {node.replies.length > 0 && <span className={`t-rail${isCollapsed ? ' is-hidden' : ''}`} aria-hidden="true" />}
          </div>
          <div className={`t-main${deleted ? ' is-deleted' : ''}`}>
            {/* A card on wider screens; on phones, the grey bubble around the name and text. */}
            <div className={`t-bubble${editing ? ' is-editing' : ''}`}>
              <div className="t-meta">
                <strong>{node.author.name}</strong>
                {node.author.id === postAuthorId && <span className="author-badge">{t('comments.author')}</span>}
                <span className="muted small t-when">
                  <time dateTime={node.createdAt} title={formatDateTime(node.createdAt)}>
                    {timeAgo(node.createdAt)}
                  </time>
                  {edited && <> · {edited}</>}
                </span>
                {deleted && (
                  <span className="badge badge-deleted" title={t('comments.deletedBy', { name: node.deletedBy ?? '?', date: formatDateTime(node.deletedAt!) })}>
                    {t('comments.deleted')}
                  </span>
                )}
                {(editable || deletable) && (
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
                  </span>
                )}
              </div>
              {editing ? (
                <CommentForm
                  autoFocus
                  initialBody={node.body}
                  placeholder={t('comments.placeholder')}
                  submitLabel={t('comments.save')}
                  onSubmit={(body) => saveEdit(node, body)}
                  onCancel={() => setActive(null)}
                />
              ) : (
                <p className="t-text">{node.body}</p>
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
                  {user && (
                    <button type="button" className={`text-btn${replying ? ' is-active' : ''}`} aria-expanded={replying} onClick={() => toggleForm('reply', node.id)}>
                      {t('comments.reply')}
                    </button>
                  )}
                  {threadToggle}
                  {/* Phones: edit and delete sit behind "⋯", in a sheet (wider screens show them as icons). */}
                  {(editable || deletable) && (
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
                  autoFocus
                  placeholder={t('comments.replyTo', { name: node.author.name.split(' ')[0]! })}
                  submitLabel={t('comments.send')}
                  onSubmit={(body) => addComment(body, node.id)}
                  onCancel={() => setActive(null)}
                />
              </div>
            </Collapse>
          </div>
        </div>
        {node.replies.length > 0 && (
          <Collapse open={!isCollapsed}>
            <ol className="t-children">
              {visibleReplies.map((reply) => renderNode(reply))}
              {hiddenReplies > 0 && (
                <li className="t-item t-more">
                  <div className="t-row">
                    <div className="t-gutter">
                      <span className="t-more-count" aria-hidden="true">
                        +{hiddenReplies}
                      </span>
                    </div>
                    <div className="t-more-main">
                      <button type="button" className="text-btn" onClick={() => showMoreReplies(node)}>
                        {t('comments.moreReplies', { n: hiddenReplies })}
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
      <section className="discussion" aria-labelledby="discussion-title">
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
    <section className="discussion" aria-labelledby="discussion-title">
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

      {user ? (
        <div className="discussion-composer card">
          <Avatar name={user.name} picture={user.picture} size={38} />
          <CommentForm placeholder={t('comments.placeholder')} submitLabel={t('comments.submit')} onSubmit={(body) => addComment(body, null)} />
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
            </div>
          </div>
        </Modal>
      )}
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
