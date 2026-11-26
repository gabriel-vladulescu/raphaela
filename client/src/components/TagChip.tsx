import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Hash } from 'lucide-react';
import { tagIcon, tagStyle } from '@/lib/tags';
import type { Tag } from '@/lib/types';

type Look = Pick<Tag, 'name' | 'color' | 'icon'>;

/** What a tag shows: its sign (else a #) and its name. */
export function TagLabel({ tag }: { tag: Look }) {
  const Icon = tagIcon(tag.icon) ?? Hash;
  return (
    <>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      <span className="tag-pill-name">{tag.name}</span>
    </>
  );
}

/**
 * A tag, in its colour (none: the site's): a link to its page (`to`), or just shown, with `children` after it (the
 * editor's ×).
 */
export function TagChip({ tag, to, className = '', children }: { tag: Look; to?: string; className?: string; children?: ReactNode }) {
  const props = { className: `tag-pill${className ? ` ${className}` : ''}`, style: tagStyle(tag.color) };
  return to ? (
    <Link to={to} {...props}>
      <TagLabel tag={tag} />
      {children}
    </Link>
  ) : (
    <span {...props}>
      <TagLabel tag={tag} />
      {children}
    </span>
  );
}
