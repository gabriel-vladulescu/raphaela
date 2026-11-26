import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/** Shown once the page is scrolled past a screen's height (and at least this far). */
const MIN_SCROLL = 600;

/**
 * "Back to the top": a round button in the bottom left corner, on the home page, the editor and the post page. It
 * rises into view once the page is scrolled past a screen's height and sinks away near the top again (styles in
 * components.css: over the phone bar where there's one, out of the cookie banner's way).
 */
export function BackToTop() {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setShown(window.scrollY > Math.max(MIN_SCROLL, window.innerHeight));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const toTop = () => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    // Keyboard users carry on from the top too (the button itself is about to go).
    document.querySelector<HTMLElement>('.site-header a')?.focus({ preventScroll: true });
  };

  const label = t('common.backToTop');
  return (
    <button type="button" className={`back-to-top${shown ? ' is-shown' : ''}`} onClick={toTop} aria-label={label} title={label} inert={!shown}>
      <ArrowUp size={20} aria-hidden="true" />
    </button>
  );
}
