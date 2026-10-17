import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
// Clips only what overflows at the bottom while the height animates, so lines that reach up or left
// out of the element (the comment tree's connectors) stay visible.
const CLIP_BOTTOM = 'inset(-100vh -100vw 0 -100vw)';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Grows an element from nothing to its height ("in"), or shrinks it away ("out", which then calls `done`,
 * usually to remove it). The content around it moves smoothly instead of jumping.
 */
export function slide(el: HTMLElement, direction: 'in' | 'out', done?: () => void): Animation | null {
  if (reducedMotion() || typeof el.animate !== 'function') {
    done?.();
    return null;
  }
  const height = direction === 'in' ? el.scrollHeight : el.offsetHeight;
  const shown = { height: `${height}px`, opacity: 1 };
  const hidden = { height: '0px', opacity: 0 };
  el.style.clipPath = CLIP_BOTTOM;
  const animation = el.animate(direction === 'in' ? [hidden, shown] : [shown, hidden], {
    duration: direction === 'in' ? 320 : 260,
    easing: EASE,
    // Stay shrunk until whoever called removes the element, instead of flashing back for a frame.
    fill: direction === 'out' ? 'forwards' : 'none',
  });
  animation.onfinish = () => {
    el.style.clipPath = '';
    done?.();
  };
  animation.oncancel = () => {
    el.style.clipPath = '';
  };
  return animation;
}

/** Shows or hides its content with a height animation; the content stays mounted until it has slid out. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const animation = useRef<Animation | null>(null);
  // Where the content is (or is heading): nothing animates on the first render, or on React's dev re-runs.
  const settled = useRef(open);

  useLayoutEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Opening runs twice: first to mount the content, then (with it in the page) to slide it in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || settled.current === open) return;
    settled.current = open;
    animation.current?.cancel();
    animation.current = open ? slide(el, 'in') : slide(el, 'out', () => setMounted(false));
  }, [open, mounted]);

  return mounted ? <div ref={ref}>{children}</div> : null;
}
