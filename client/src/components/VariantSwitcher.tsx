import { useSearchParams } from 'react-router';

// TEMPORARY: layout variants of a page, to compare before choosing one (then the chosen one stays and this goes).
// Development only. The variant is in the address (?varianta=b) and remembered per page in this browser.

export interface LayoutVariant {
  id: string;
  label: string;
  /** What it changes, shown beside the buttons. */
  hint: string;
}

const CURRENT: LayoutVariant = { id: 'acum', label: 'Acum', hint: 'Aspectul de acum' };
const storageKey = (page: string) => `variant.${page}`;

/** The page's variant (null: the layout as it is now); always null in production builds. */
export function useLayoutVariant(page: string, variants: LayoutVariant[]): string | null {
  const [params] = useSearchParams();
  if (!import.meta.env.DEV) return null;
  const ids = variants.map((variant) => variant.id);
  const fromAddress = params.get('varianta');
  if (fromAddress) return ids.includes(fromAddress) ? fromAddress : null;
  try {
    const stored = localStorage.getItem(storageKey(page));
    return stored && ids.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The bar at the bottom of the page that switches between the variants. */
export function VariantSwitcher({ page, variants }: { page: string; variants: LayoutVariant[] }) {
  const [, setParams] = useSearchParams();
  const current = useLayoutVariant(page, variants) ?? CURRENT.id;
  if (!import.meta.env.DEV) return null;
  const all = [CURRENT, ...variants];
  const choose = (id: string) => {
    try {
      localStorage.setItem(storageKey(page), id);
    } catch {
      // Only the address keeps it then.
    }
    setParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.set('varianta', id);
        return next;
      },
      { replace: true },
    );
  };
  return (
    <div className="variant-switcher" role="group" aria-label="Variante de aspect">
      <span className="variant-switcher-label">Variantă</span>
      <span className="variant-switcher-options">
        {all.map((variant) => (
          <button key={variant.id} type="button" className={variant.id === current ? 'is-selected' : ''} aria-pressed={variant.id === current} onClick={() => choose(variant.id)}>
            {variant.label}
          </button>
        ))}
      </span>
      <span className="variant-switcher-hint">{all.find((variant) => variant.id === current)!.hint}</span>
    </div>
  );
}
