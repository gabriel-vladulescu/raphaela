import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useI18n } from '@/lib/i18n';
import { NARROW, PHONE } from '@/lib/useMediaQuery';

/** Past this much of its height, letting go of a sheet closes it; a quicker flick (px/ms) does too. */
const CLOSE_FRACTION = 1 / 3;
const CLOSE_VELOCITY = 0.5;

interface ModalProps {
  title: string;
  children: ReactNode;
  /** Called on Escape; omit to make the modal non-dismissable. */
  onClose?: () => void;
  /** Also close on a click (or tap) outside the dialog. */
  closeOnBackdrop?: boolean;
  /** A sheet: `true` rises from the bottom on phones and is swiped down to close, `'top'` drops from the top on
   *  narrow screens (phones and tablets) and is swiped up. A dialog on wider screens. */
  sheet?: boolean | 'top';
  className?: string;
  /** Its head, drawn by the modal: the title and (when it can be closed) the close button, as every dialog and sheet
   *  has it (ModalHead). Without it, the content brings its own. */
  head?: boolean;
}

/** A dialog's or a sheet's head: its title, and the button that closes it (when it can be closed). */
export function ModalHead({ title, onClose, children }: { title: string; onClose?: () => void; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="modal-head">
      <h2>{title}</h2>
      {children}
      {onClose && (
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/**
 * Whether something between the finger and the sheet (or the sheet itself) is scrolled away from the edge the sheet
 * closes toward (`way`: 1 down, -1 up): then the finger scrolls it back first, as in the phone's own sheets.
 */
function scrolledAway(target: EventTarget | null, dialog: HTMLElement, way: number) {
  for (let el = target instanceof HTMLElement ? target : null; el; el = el === dialog ? null : el.parentElement) {
    const scrolls = el === dialog || /(auto|scroll)/.test(getComputedStyle(el).overflowY);
    if (!scrolls || el.scrollHeight <= el.clientHeight + 1) continue;
    if (way > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  return false;
}

/**
 * Phones: a sheet follows a finger dragging it toward the edge it came from (down for a bottom sheet, up for a top
 * one; from anywhere on it, while its content is scrolled to that end), and closes when let go past a third of its
 * height or flicked; otherwise it springs back. Returns a close that slides the sheet away first (for taps on the
 * backdrop), or nothing when the sheet can't be closed.
 */
function useSwipeToClose(ref: RefObject<HTMLDialogElement | null>, onClose: (() => void) | undefined, from: 'bottom' | 'top') {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const enabled = onClose !== undefined;
  /** Which way closing goes on the screen's y axis. */
  const way = from === 'top' ? -1 : 1;
  /** Where it's a sheet (the same widths as its CSS). */
  const media = from === 'top' ? NARROW : PHONE;

  // `start`: how far it's already been dragged (px). The backdrop fades with it (--sheet-drag, see components.css).
  const slideAway = useCallback(
    (start = 0) => {
      const dialog = ref.current;
      const animate = dialog && window.matchMedia(media).matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!animate) return closeRef.current?.();
      dialog
        .animate(
          [
            { transform: `translateY(${way * start}px)`, '--sheet-drag': start / dialog.offsetHeight },
            { transform: `translateY(${way * 100}%)`, '--sheet-drag': 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        )
        .finished.then(
          () => closeRef.current?.(),
          () => undefined,
        );
    },
    [ref, way, media],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !enabled) return;
    let mode: 'idle' | 'maybe' | 'drag' = 'idle';
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let offset = 0;

    const onStart = (event: TouchEvent) => {
      mode = 'idle';
      if (event.touches.length !== 1 || scrolledAway(event.target, dialog, way) || !window.matchMedia(media).matches) return;
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = lastY = touch.clientY;
      lastTime = event.timeStamp;
      velocity = 0;
      offset = 0;
      mode = 'maybe';
    };

    const onMove = (event: TouchEvent) => {
      if (mode === 'idle') return;
      const touch = event.touches[0]!;
      if (mode === 'maybe') {
        const dx = touch.clientX - startX;
        const dy = (touch.clientY - startY) * way;
        if (Math.hypot(dx, dy) < 8) return;
        // Away from its edge, or sideways: that's scrolling, not closing.
        if (dy <= 0 || Math.abs(dx) > dy) {
          mode = 'idle';
          return;
        }
        mode = 'drag';
        for (const animation of dialog.getAnimations()) animation.cancel(); // e.g. still rising
      }
      event.preventDefault(); // the sheet moves, not the content
      offset = Math.max(0, (touch.clientY - startY) * way);
      if (event.timeStamp > lastTime) velocity = ((touch.clientY - lastY) * way) / (event.timeStamp - lastTime);
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      dialog.style.transform = `translateY(${way * offset}px)`;
      dialog.style.setProperty('--sheet-drag', String(Math.min(1, offset / dialog.offsetHeight)));
    };

    const onEnd = () => {
      if (mode !== 'drag') {
        mode = 'idle';
        return;
      }
      mode = 'idle';
      dialog.style.transform = '';
      dialog.style.removeProperty('--sheet-drag');
      if (offset > dialog.offsetHeight * CLOSE_FRACTION || velocity > CLOSE_VELOCITY) {
        slideAway(offset);
        return;
      }
      dialog.animate(
        [
          { transform: `translateY(${way * offset}px)`, '--sheet-drag': offset / dialog.offsetHeight },
          { transform: 'translateY(0)', '--sheet-drag': 0 },
        ],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
      );
    };

    dialog.addEventListener('touchstart', onStart, { passive: true });
    dialog.addEventListener('touchmove', onMove, { passive: false });
    dialog.addEventListener('touchend', onEnd);
    dialog.addEventListener('touchcancel', onEnd);
    return () => {
      dialog.removeEventListener('touchstart', onStart);
      dialog.removeEventListener('touchmove', onMove);
      dialog.removeEventListener('touchend', onEnd);
      dialog.removeEventListener('touchcancel', onEnd);
    };
  }, [ref, enabled, way, media, slideAway]);

  return enabled ? slideAway : undefined;
}

/** A click that landed outside the dialog's box: on the backdrop. */
function onBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}

/**
 * Centered dialog on a blurred backdrop, built on <dialog> for focus trapping and Escape handling. While one is open,
 * the page behind it doesn't scroll (components.css).
 */
export function Modal({ title, children, onClose, closeOnBackdrop, sheet = false, className = '', head = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const slideAway = useSwipeToClose(ref, sheet ? onClose : undefined, sheet === 'top' ? 'top' : 'bottom');
  /** Still on the page (its own closing, when it goes, isn't the browser's). */
  const shown = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    shown.current = true;
    if (dialog && !dialog.open) {
      // The scrollbar's width, measured before it goes (the page is locked while a dialog is open, components.css);
      // over another dialog, it's gone already.
      if (!document.querySelector('dialog.modal[open]')) {
        document.documentElement.style.setProperty('--scrollbar-gap', `${window.innerWidth - document.documentElement.clientWidth}px`);
      }
      dialog.showModal();
    }
    return () => {
      shown.current = false;
      dialog?.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${sheet ? ' sheet' : ''}${sheet === 'top' ? ' sheet-top' : ''} ${className}`}
      aria-label={title}
      // (A dialog opened from inside this one is its own: its events reach this one through React, and are let be.)
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!event.cancelable) return; // the browser closes it regardless: see onClose
        event.preventDefault();
        onClose?.();
      }}
      // Browsers let a page keep a dialog open on Escape only once per click or tap: pressed again straight away, the
      // browser closes it itself. Then it's opened again at once, and closed (or stepped back) the page's way.
      onClose={(event) => {
        const dialog = event.currentTarget;
        if (event.target !== dialog || !shown.current || dialog.open) return;
        dialog.showModal();
        onClose?.();
      }}
      onClick={closeOnBackdrop ? (event) => onBackdrop(event) && (slideAway ?? onClose)?.() : undefined}
    >
      {head && <ModalHead title={title} onClose={onClose} />}
      {children}
    </dialog>
  );
}

/** A message with one button (e.g. why an image was refused). */
export function AlertModal({ title, message, onClose }: { title: string; message: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={title} onClose={onClose} head>
      <div className="modal-body" role="alertdialog" aria-label={title}>
        <p className="muted">{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Asks before doing something; `danger` styles the confirm button as destructive. */
export function ConfirmModal(props: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={props.title} onClose={props.onCancel} head>
      <div className="modal-body">
        <p className="muted">{props.message}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel} autoFocus>
            {t('common.cancel')}
          </button>
          <button type="button" className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
