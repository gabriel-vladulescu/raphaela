import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { buildTree } from '@/lib/categories';
import type { CategoryNode } from '@/lib/categories';
import type { Category, CategoryLimits } from '@/lib/types';

interface CategoriesValue {
  categories: Category[];
  tree: CategoryNode[];
  limits: CategoryLimits;
  loaded: boolean;
  reload: () => Promise<void>;
}

const CategoriesContext = createContext<CategoriesValue | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [limits, setLimits] = useState<CategoryLimits>({ maxDepth: 3, maxChildren: 10 });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ categories: Category[]; limits: CategoryLimits }>('/categories');
      setCategories(data.categories);
      setLimits(data.limits);
    } catch {
      // Offline or the server is down: keep what we have.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(
    () => ({ categories, tree: buildTree(categories), limits, loaded, reload }),
    [categories, limits, loaded, reload],
  );
  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}

export function useCategories(): CategoriesValue {
  const value = useContext(CategoriesContext);
  if (!value) throw new Error('useCategories must be used inside <CategoriesProvider>');
  return value;
}
