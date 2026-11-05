import { useEffect, useState } from 'react';
import { SearchSelect } from '@/admin/Dropdown';
import type { Option } from '@/admin/Dropdown';
import { useAdminI18n } from '@/admin/i18n';
import { api } from '@/lib/api';

interface LookupUser {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  role: string;
  deleted?: boolean;
  posts?: number;
}

/** Which people the menu offers (server: /admin/lookup/users). */
export interface UserFilter {
  role?: 'member' | 'author' | 'owner' | 'writer';
  /** Only people who wrote posts. */
  posts?: boolean;
  /** Not deleted or suspended. */
  active?: boolean;
  exclude?: number;
}

const toOption = (user: LookupUser, hint: string): Option<number> => ({ value: user.id, label: user.name, hint, picture: user.picture });

/**
 * A person, searched in the database by name or email (a few at a time). `value`: the picked id (e.g. from the
 * address), whose name it fetches; null for none. `clear`: the "everyone" entry's label.
 */
export function UserSelect(props: {
  label: string;
  placeholder: string;
  value: number | null;
  onChange: (id: number | null) => void;
  filter?: UserFilter;
  clear?: string;
  block?: boolean;
  align?: 'start' | 'end';
}) {
  const { t } = useAdminI18n();
  const [selected, setSelected] = useState<Option<number> | null>(null);
  const hint = (user: LookupUser) =>
    [user.email, user.posts ? t('lookup.posts', { n: user.posts }) : null, user.deleted ? t('users.status.deleted') : null].filter(Boolean).join(' · ');

  // The picked person's name, when only their id is known (or it changed from elsewhere).
  useEffect(() => {
    if (props.value === null) return setSelected(null);
    if (selected?.value === props.value) return;
    api<{ user: LookupUser }>(`/admin/lookup/users/${props.value}`)
      .then(({ user }) => setSelected({ value: user.id, label: user.name, hint: user.email, picture: user.picture }))
      .catch(() => setSelected({ value: props.value!, label: `#${props.value}` }));
  }, [props.value]);

  async function load(query: string, limit: number) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query) params.set('q', query);
    const filter = props.filter ?? {};
    if (filter.role) params.set('role', filter.role);
    if (filter.posts) params.set('posts', 'true');
    if (filter.active) params.set('active', 'true');
    if (filter.exclude) params.set('exclude', String(filter.exclude));
    const result = await api<{ users: LookupUser[]; hasMore: boolean }>(`/admin/lookup/users?${params}`);
    return { options: result.users.map((user) => toOption(user, hint(user))), hasMore: result.hasMore };
  }

  return (
    <SearchSelect<number>
      label={props.label}
      placeholder={props.placeholder}
      searchPlaceholder={t('lookup.search')}
      selected={selected}
      load={load}
      clear={props.clear}
      block={props.block}
      align={props.align}
      onChange={(option) => {
        setSelected(option);
        props.onChange(option?.value ?? null);
      }}
    />
  );
}
