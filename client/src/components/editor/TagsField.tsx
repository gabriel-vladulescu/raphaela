import { useEffect, useState } from 'react';
import { Tags, X } from 'lucide-react';
import { TagPicker } from '@/components/editor/TagPicker';
import type { KnownTag } from '@/components/editor/TagPicker';
import { TagChip } from '@/components/TagChip';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { tagSlug } from '@/lib/tags';

/**
 * The editor's tags card: the post's tags (each in its colour, with an × to take it away) and a button that opens
 * the picker (TagPicker), to choose among those there are or make a new one. Every tag there is comes once, for both.
 */
export function TagsField({ value, onChange, hint }: { value: string[]; onChange: (tags: string[]) => void; hint?: string }) {
  const { t } = useI18n();
  const [known, setKnown] = useState<KnownTag[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ tags: KnownTag[] }>('/tags?all=true&limit=300')
      .then((data) => !cancelled && setKnown(data.tags))
      .catch(() => !cancelled && setKnown([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const bySlug = new Map((known ?? []).map((tag) => [tag.slug, tag]));
  return (
    <div className="tags-field">
      {value.length > 0 ? (
        <div className="tags-field-list">
          {value.map((name) => {
            const tag = bySlug.get(tagSlug(name)) ?? { name, slug: tagSlug(name) };
            return (
              <TagChip key={tag.slug} tag={tag} className="is-removable">
                <button type="button" className="tag-pill-remove" aria-label={t('editor.tagRemove', { tag: name })} onClick={() => onChange(value.filter((other) => other !== name))}>
                  <X size={12} />
                </button>
              </TagChip>
            );
          })}
        </div>
      ) : (
        <p className="tags-field-none muted small">{t('editor.tagsNone')}</p>
      )}
      <button type="button" className="btn btn-soft btn-block tags-field-open" onClick={() => setOpen(true)}>
        <Tags size={16} /> {t(value.length ? 'editor.tagsEdit' : 'editor.tagsChoose')}
      </button>
      <span className="field-hint">{hint ?? t('editor.tagsHint')}</span>
      {open && (
        <TagPicker
          value={value}
          onChange={onChange}
          known={known}
          onCreated={(tag) => setKnown((list) => (list?.some((other) => other.slug === tag.slug) ? list : [{ ...tag, posts: 0 }, ...(list ?? [])]))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
