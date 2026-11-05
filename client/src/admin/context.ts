import { createContext, useContext } from 'react';
import type { Overview } from '@/admin/types';

export interface AdminContextValue {
  overview: Overview | null;
  /** Re-reads the numbers behind the sidebar's badges and the dashboard (after a change that moves them). */
  refreshOverview: () => void;
}

export const AdminContext = createContext<AdminContextValue>({ overview: null, refreshOverview: () => undefined });

/** The admin panel's shared numbers (AdminApp provides them). */
export const useAdmin = () => useContext(AdminContext);
