import { useEffect, useState } from 'react';

/** For a bar fixed to the bottom of the screen: true while scrolling down (it steps aside), false again on the way
 *  up and near the top. */
export function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      if (y < 120 || y < lastY - 6) setHidden(false);
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
