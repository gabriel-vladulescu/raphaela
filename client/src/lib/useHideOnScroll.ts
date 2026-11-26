import { useEffect, useState } from 'react';

/** How close to the end of the page counts as there (px): the room pages leave for the bar is about this tall. */
const NEAR_END = 140;

/** For a bar fixed to the bottom of the screen: true while scrolling down (it steps aside), false again on the way
 *  up, near the top, and at the end of the page (where the room left for it would otherwise stay empty). */
export function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - NEAR_END;
      if (y < 120 || y < lastY - 6 || atEnd) setHidden(false);
      else if (y > lastY + 6) setHidden(true);
      lastY = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return hidden;
}
