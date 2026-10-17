import { useEffect, useId, useRef, useState } from 'react';
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

/** A button that toggles a floating panel; closes on outside click or Escape. */
export function Popover({ label, button, buttonClassName = 'icon-btn', panelClassName = '', align = 'end', active, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  /** Where the button ends (px from the top of the screen) when it opened: panels that can't hang under their button
   *  (the editor's toolbar scrolls sideways on phones, which would cut them off) open fixed at that height. */
  const [anchorBottom, setAnchorBottom] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`popover popover-${align} ${panelClassName}`}
          style={{ '--anchor-bottom': `${anchorBottom}px` } as CSSProperties}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
