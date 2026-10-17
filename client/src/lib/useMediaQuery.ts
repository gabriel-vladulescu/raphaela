import { useCallback, useSyncExternalStore } from 'react';

/** Phones: sheets from the bottom instead of dialogs, no footer (the CSS uses the same width). */
export const PHONE = '(max-width: 640px)';
/** Narrow screens, phones and tablets: the app-like layout. The post page's bottom bar, the home page as a feed with
 *  its search in the top bar, the account sheet from the top (the CSS uses the same width). */
export const NARROW = '(max-width: 1000px)';

/** Whether a media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
