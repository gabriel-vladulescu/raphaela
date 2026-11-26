import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { ArrowDownUp, Eye, GripVertical, Pencil } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { chapterEditorPath, chapterPath, roman } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import type { Chapter } from '@/lib/types';

/** The space between two rows (.chapter-list's gap, px). */
const GAP = 6;
/** How close to the screen's top or bottom (px) a dragged row scrolls the page. */
const EDGE = 90;

interface Drag {
  from: number;
  to: number;
  /** How far the row has moved (px). */
  dy: number;
  /** Where the pointer started, on the page (not the screen: the page may scroll meanwhile). */
  startY: number;
  /** The rows' middles on the page, when it started. */
  mids: number[];
  /** How far the others step aside: the dragged row's height and the gap. */
  step: number;
}

interface Pending {
  from: number;
  to: number;
  /** The chapters in their new order (renumbered), shown until it's confirmed or not. */
  list: Chapter[];
  moved: Chapter;
}

/** The chapters in a new order: one taken from `from` and put at `to`, all numbered again from 1. */
function reordered(chapters: Chapter[], from: number, to: number) {
  const list = [...chapters];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  return list.map((chapter, index) => ({ ...chapter, no: index + 1 }));
}

/**
 * A book's chapters, in order, in its editor: each one to see and to edit, and a handle to drag it somewhere else (or,
 * on the handle, the up and down keys). Dropped, it's shown in its new place, everything else blurred, with a question
 * over it: moved there, it becomes chapter so-and-so and the others are numbered again; yes saves the order
 * (`onSave`), no puts it back.
 */
export function ChapterOrder(props: {
  chapters: Chapter[];
  bookSlug: string | null;
  bookId: number;
  onSave: (order: Chapter[]) => Promise<boolean>;
}) {
  const { chapters, bookSlug, bookId, onSave } = props;
  const { t } = useI18n();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  /** Where the moved chapter is on screen, for the question over it. */
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useRef(new Map<number, HTMLLIElement>());
  /** The pointer's last height on screen (the page scrolls under a still pointer near its edges). */
  const pointerY = useRef(0);

  const shown = pending?.list ?? chapters;

  /** The row follows the pointer; the place it would go is where its middle is among the others'. */
  const follow = (clientY: number) =>
    setDrag((current) => {
      if (!current) return current;
      const dy = clientY + window.scrollY - current.startY;
      const middle = current.mids[current.from]! + dy;
      let to = current.from;
      current.mids.forEach((mid, index) => {
        if (index < current.from && middle < mid) to = Math.min(to, index);
        if (index > current.from && middle > mid) to = Math.max(to, index);
      });
      return { ...current, dy, to };
    });

  // While dragging near the screen's top or bottom, the page scrolls (and the row with it).
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      const by = y < EDGE ? -(EDGE - y) / 5 : y > window.innerHeight - EDGE ? (y - (window.innerHeight - EDGE)) / 5 : 0;
      if (by) {
        window.scrollBy(0, by);
        follow(y);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    document.body.classList.add('is-dragging-row');
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove('is-dragging-row');
    };
  }, [drag !== null]);

  const start = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (pending || busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const boxes = shown.map((chapter) => rows.current.get(chapter.id)!.getBoundingClientRect());
    pointerY.current = event.clientY;
    setDrag({
      from: index,
      to: index,
      dy: 0,
      startY: event.clientY + window.scrollY,
      mids: boxes.map((box) => box.top + window.scrollY + box.height / 2),
      step: boxes[index]!.height + GAP,
    });
  };

  /** Shows the chapter in its new place and asks. */
  const propose = (from: number, to: number) => {
    setDrag(null);
    if (to === from || to < 0 || to >= chapters.length) return;
    const list = reordered(chapters, from, to);
    setRect(null);
    setPending({ from, to, list, moved: list[to]! });
  };

  const drop = () => {
    if (drag) propose(drag.from, drag.to);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    propose(index, index + (event.key === 'ArrowUp' ? -1 : 1));
  };

  // Once it's in its new place: in view, and measured, for the question over it.
  useLayoutEffect(() => {
    if (!pending || rect) return;
    const row = rows.current.get(pending.moved.id);
    if (!row) return;
    const box = row.getBoundingClientRect();
    if (box.top < 70 || box.bottom > window.innerHeight - 220) {
      row.scrollIntoView({ block: 'center' });
    }
    setRect(row.getBoundingClientRect());
  }, [pending, rect]);

  const cancel = () => {
    setPending(null);
    setRect(null);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    // Saved: the list comes back from the server; not: it's back as it was (the page says why).
    await onSave(pending.list);
    setBusy(false);
    cancel();
  };

  /** A row's contents: its number, title and state, and (in the list) see, edit, drag. */
  const rowBody = (chapter: Chapter, index: number, actions: boolean) => (
    <>
      <span className="toc-no">{roman(chapter.no)}</span>
      <span className="chapter-row-text">
        <b>{chapter.title || t('post.untitled')}</b>
        <span className="muted">{t(`post.status.${chapter.state}`)}</span>
      </span>
      {actions && (
        <span className="chapter-row-actions">
          {bookSlug && chapter.slug && (
            <Link to={chapterPath(bookSlug, chapter.slug)} className="icon-btn" aria-label={t('books.view')} title={t('books.view')}>
              <Eye size={16} />
            </Link>
          )}
          <Link to={chapterEditorPath(bookId, chapter.id)} className="icon-btn" aria-label={t('books.edit')} title={t('books.edit')}>
            <Pencil size={16} />
          </Link>
          <button
            type="button"
            className="icon-btn drag-handle"
            aria-label={t('books.dragChapter', { n: roman(chapter.no) })}
            title={t('books.dragChapter', { n: roman(chapter.no) })}
            disabled={chapters.length < 2}
            onPointerDown={(event) => start(event, index)}
            onPointerMove={(event) => {
              if (!drag) return;
              pointerY.current = event.clientY;
              follow(event.clientY);
            }}
            onPointerUp={drop}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(event) => onKey(event, index)}
          >
            <GripVertical size={17} />
          </button>
        </span>
      )}
    </>
  );

  /** Where a row is while another is dragged: the dragged one under the pointer, those it passed one place over. */
  const rowStyle = (index: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (index === drag.from) return { transform: `translateY(${drag.dy}px)` };
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-drag.step}px)` };
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return { transform: `translateY(${drag.step}px)` };
    return { transform: 'translateY(0)' };
  };

  // The question: under the chapter if there's room, else over it.
  const bubbleWidth = Math.min(420, window.innerWidth - 32);
  const above = rect ? rect.bottom + 220 > window.innerHeight : false;
  const bubbleStyle: CSSProperties | undefined = rect
    ? {
        width: bubbleWidth,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - bubbleWidth - 16)),
        ...(above ? { bottom: window.innerHeight - rect.top + 14 } : { top: rect.bottom + 14 }),
      }
    : undefined;
  // What happens, by name and by place: the chapter goes from one number to another, and the ones in between move one
  // place the other way (their numbers before and after).
  let move = '';
  let shift = '';
  if (pending) {
    const { from, to } = pending;
    const name = pending.moved.title || t('post.untitled');
    move = t('books.orderMove', { title: name.length > 48 ? `${name.slice(0, 46)}…` : name, from: roman(chapters[from]!.no), to: roman(to + 1) });
    // Moved down, the ones it passed go up a place; moved up, down a place.
    const down = to > from;
    const first = down ? from + 1 : to;
    const last = down ? to : from - 1;
    const values = {
      a: roman(chapters[first]!.no),
      b: roman(chapters[last]!.no),
      c: roman(first + 1 + (down ? -1 : 1)),
      d: roman(last + 1 + (down ? -1 : 1)),
    };
    const one = first === last;
    shift = t(down ? (one ? 'books.orderUpOne' : 'books.orderUp') : one ? 'books.orderDownOne' : 'books.orderDown', values);
  }

  return (
    <>
      <ol className={`chapter-list${drag ? ' is-sorting' : ''}`}>
        {shown.map((chapter, index) => (
          <li
            key={chapter.id}
            ref={(element) => {
              if (element) rows.current.set(chapter.id, element);
              else rows.current.delete(chapter.id);
            }}
            className={`chapter-row is-${chapter.state}${drag?.from === index ? ' is-dragging' : ''}${pending?.moved.id === chapter.id ? ' is-moved' : ''}`}
            style={rowStyle(index)}
          >
            {rowBody(chapter, index, true)}
          </li>
        ))}
      </ol>

      {pending && rect && (
        <Modal title={t('books.orderTitle')} onClose={cancel} className="order-confirm">
          <div className="order-confirm-layer" onClick={(event) => event.target === event.currentTarget && !busy && cancel()}>
            {/* The chapter, sharp, where it now is (the page behind is blurred). */}
            <ol className="chapter-list order-confirm-row" style={{ top: rect.top, left: rect.left, width: rect.width }} aria-hidden="true">
              <li className={`chapter-row is-${pending.moved.state} is-moved`}>{rowBody(pending.moved, pending.to, false)}</li>
            </ol>
            <div className={`order-bubble${above ? ' is-above' : ''}`} style={bubbleStyle} role="alertdialog" aria-label={t('books.orderTitle')} aria-describedby="order-question">
              <p id="order-question">
                <ArrowDownUp size={18} aria-hidden="true" />
                <span>
                  <strong>{move}</strong> {shift} <span className="order-sure">{t('books.orderSure')}</span>
                </span>
              </p>
              <div className="order-bubble-actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>
                  {t('books.orderNo')}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} autoFocus onClick={() => void confirm()}>
                  {busy ? t('common.loading') : t('books.orderYes')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
