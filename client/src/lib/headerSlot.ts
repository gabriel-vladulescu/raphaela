import { createContext, useContext } from 'react';

/** The top bar's free space, left of its buttons: a page can put a control of its own there with a portal (the
 *  home page's search, on phones). Null until the header has rendered. */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export const useHeaderSlot = () => useContext(HeaderSlotContext);
