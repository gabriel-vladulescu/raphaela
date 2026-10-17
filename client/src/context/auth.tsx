import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';

interface AuthValue {
  user: User | null;
  loading: boolean;
  isOwner: boolean;
  /** Authors and owners write posts. */
  canWrite: boolean;
  /** Owners edit any post; authors only their own. */
  canEditPost: (authorId: number) => boolean;
  /** Re-reads the session, e.g. after email/password sign-in. */
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User | null }>('/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const isOwner = user?.role === 'owner';
    return {
      user,
      loading,
      isOwner,
      canWrite: isOwner || user?.role === 'author',
      canEditPost: (authorId: number) => isOwner || (user?.role === 'author' && user.id === authorId),
      refresh,
      setUser,
      logout,
    };
  }, [user, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
