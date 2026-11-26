import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type Edge = 'none' | 'more' | 'end';

/** Whether a row that scrolls sideways has more to the right ('more'), is at its end ('end'), or fits ('none'). */
function useEdge(target: RefObject<HTMLElement | null>): Edge {
  const [edge, setEdge] = useState<Edge>('none');
  useEffect(() => {
    const row = target.current;
    if (!row) return;
    const check = () => {
      // Only a row that scrolls (phones): on wide screens the same lists are grids, which may stick out a little (a
      // delete button on a corner) without scrolling.
      const scrolls = ['auto', 'scroll'].includes(getComputedStyle(row).overflowX);
      if (!scrolls || row.scrollWidth <= row.clientWidth + 4) setEdge('none');
      else setEdge(row.scrollLeft + row.clientWidth >= row.scrollWidth - 8 ? 'end' : 'more');
    };
    // Its size, and its items' (they load, or change: the templates), change whether it overflows.
    const resized = new ResizeObserver(check);
    const watch = () => {
      resized.disconnect();
      resized.observe(row);
      for (const item of row.children) resized.observe(item);
    };
    const changed = new MutationObserver(() => {
      watch();
      check();
    });
    watch();
    changed.observe(row, { childList: true });
    row.addEventListener('scroll', check, { passive: true });
    // Rotating a tablet, or resizing the window, switches between the row and the grid.
    window.addEventListener('resize', check);
    check();
    return () => {
      resized.disconnect();
      changed.disconnect();
      row.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [target]);
  return edge;
}

/**
 * Beside the title of a row that scrolls sideways (phones): "Scroll →", the arrow nudging that way, while there's more
 * to the right; "← Back" once the last item is in view. Tapped, it scrolls on (most of a screen), or back to the start.
 * Nothing while the row fits. `compact`: the arrow alone (a title with a link beside it leaves little room).
 */
export function ScrollHint({ target, compact = false }: { target: RefObject<HTMLElement | null>; compact?: boolean }) {
  const { t } = useI18n();
  const edge = useEdge(target);
  if (edge === 'none') return null;
  const back = edge === 'end';
  const label = back ? t('scroll.back') : t('scroll.more');
  const go = () => {
    const row = target.current;
    if (!row) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (back) row.scrollTo({ left: 0, behavior: still ? 'auto' : 'smooth' });
    else row.scrollBy({ left: Math.round(row.clientWidth * 0.8), behavior: still ? 'auto' : 'smooth' });
  };
  return (
    <button type="button" className={`scroll-hint${back ? ' is-back' : ''}${compact ? ' is-compact' : ''}`} aria-label={label} title={label} onClick={go}>
      {back && <ArrowLeft size={15} className="scroll-hint-arrow" aria-hidden="true" />}
      {!compact && <span>{label}</span>}
      {!back && <ArrowRight size={15} className="scroll-hint-arrow" aria-hidden="true" />}
    </button>
  );
}
