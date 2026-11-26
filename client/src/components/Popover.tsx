import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface PopoverProps {
  /** Accessible name for the trigger button (also shown as a tooltip). */
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
  align?: 'start' | 'end';
  active?: boolean;
  children: (close: () => void) => ReactNode;
}

/** How close to the screen's edge a panel may come (px) before it opens the other way. */
const EDGE = 8;

/**
 * A button that toggles a floating panel; closes on outside click or Escape. The panel lines up with the button's
 * start or end (`align`), and the other way when that would take it past the edge of the screen (a wide panel under
 * the last of a row of buttons).
 */
export function Popover({ label, button, buttonClassName = 'icon-btn', panelClassName = '', align = 'end', active, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  /** Where the button ends (px from the top of the screen) when it opened: panels that can't hang under their button
   *  (the editor's toolbar scrolls sideways on phones, which would cut them off) open fixed at that height. */
  const [anchorBottom, setAnchorBottom] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Measured before it's painted, so it never shows on the wrong side first.
  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    // Its own width (it opens scaled down a little, growing from the side it lines up with).
    const box = panel.getBoundingClientRect();
    const past = align === 'start' ? box.left + panel.offsetWidth > window.innerWidth - EDGE : box.right - panel.offsetWidth < EDGE;
    if (past) setFlipped(true);
  }, [open, align]);
  const side = flipped ? (align === 'start' ? 'end' : 'start') : align;

  useEffect(() => {
    if (!open) return;
    // A dialog opened over the panel (from it: the scheduling picker's list of what's scheduled) isn't "outside" it:
    // what's done there, Escape included, is that dialog's, and the panel is there again once it closes.
    const modal = (dialog: Element) => {
      try {
        return dialog.matches(':modal');
      } catch {
        return true; // a browser without :modal: the site opens its dialogs as modals
      }
    };
    const over = () => [...document.querySelectorAll('dialog[open]')].some((dialog) => modal(dialog) && rootRef.current && !dialog.contains(rootRef.current));
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !over()) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !over()) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="popover-root" ref={rootRef}>
      <button
        type="button"
        className={`${buttonClassName}${open || active ? ' is-active' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setAnchorBottom(rootRef.current?.getBoundingClientRect().bottom ?? 0);
          setOpen((value) => !value);
        }}
      >
        {button}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`popover popover-${side} ${panelClassName}`}
          style={{ '--anchor-bottom': `${anchorBottom}px` } as CSSProperties}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
