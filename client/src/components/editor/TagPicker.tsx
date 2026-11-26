import { useState } from 'react';
import { Check, Hash, Plus, Search, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { TagChip, TagLabel } from '@/components/TagChip';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { TAG_COLOR_IDS, TAG_COLORS, TAG_ICON_IDS, TAG_ICONS, TAG_NAME_MAX, tagName, tagSlug, tagStyle, typingTagName } from '@/lib/tags';
import type { Tag } from '@/lib/types';
import { PHONE, useMediaQuery } from '@/lib/useMediaQuery';

/** Mirrors MAX_TAGS in server/src/lib/tags.ts. */
export const MAX_TAGS = 10;

/** A tag there is, with how many public posts have it. */
export type KnownTag = Tag & { posts?: number };

/** A tag's colour and sign, to choose: none or one of the colours, none (a #) or one of the signs. */
export function TagStyleFields({
  color,
  icon,
  onChange,
}: {
  color: string | null;
  icon: string | null;
  onChange: (next: { color?: string | null; icon?: string | null }) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <>
      <div className="tag-style-field">
        <span className="field-label">{t('tags.color')}</span>
        <div className="tag-colors" role="group" aria-label={t('tags.color')}>
          <button type="button" className="tag-color is-none" aria-pressed={!color} title={t('tags.noColor')} aria-label={t('tags.noColor')} onClick={() => onChange({ color: null })} />
          {TAG_COLOR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="tag-color"
              style={tagStyle(id)}
              aria-pressed={color === id}
              title={TAG_COLORS[id][lang]}
              aria-label={TAG_COLORS[id][lang]}
              onClick={() => onChange({ color: id })}
            />
          ))}
        </div>
      </div>
      <div className="tag-style-field">
        <span className="field-label">{t('tags.icon')}</span>
        <div className="tag-icons" role="group" aria-label={t('tags.icon')} style={tagStyle(color)}>
          <button type="button" className="tag-icon" aria-pressed={!icon} title={t('tags.noIcon')} aria-label={t('tags.noIcon')} onClick={() => onChange({ icon: null })}>
            <Hash size={17} aria-hidden="true" />
          </button>
          {TAG_ICON_IDS.map((id) => {
            const { icon: Icon } = TAG_ICONS[id];
            const name = TAG_ICONS[id][lang];
            return (
              <button key={id} type="button" className="tag-icon" aria-pressed={icon === id} title={name} aria-label={name} onClick={() => onChange({ icon: id })}>
                <Icon size={17} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * A post's tags, to choose: those it has (each can go), every tag there is (a search finds one; a tap adds or takes
 * it away), and a new one (its name, lower case with dashes between the words; a colour; a sign). A dialog on wide
 * screens, the whole screen on phones. What's chosen counts at once; Done closes it.
 */
export function TagPicker({
  value,
  onChange,
  known,
  onCreated,
  onClose,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  /** Every tag there is (null while loading). */
  known: KnownTag[] | null;
  onCreated: (tag: KnownTag) => void;
  onClose: () => void;
}) {
  const { t, errorMessage, formatNumber } = useI18n();
  const phone = useMediaQuery(PHONE);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ name: string; color: string | null; icon: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const all = known ?? [];
  const bySlug = new Map(all.map((tag) => [tag.slug, tag]));
  const chosen = new Set(value.map(tagSlug));
  const chosenTags = value.map((name): KnownTag => bySlug.get(tagSlug(name)) ?? { name, slug: tagSlug(name) });
  const full = value.length >= MAX_TAGS;
  // The search: every word in it, in a tag's address ("cafe" finds "café-noir").
  const words = tagSlug(query).split('-').filter(Boolean);
  const found = all.filter((tag) => words.every((word) => tag.slug.includes(word)));
  const typed = tagName(query);
  const offer = typed && !bySlug.has(tagSlug(typed)) ? typed : '';
  const draftName = draft ? tagName(draft.name) : '';
  const draftExists = Boolean(draftName && bySlug.has(tagSlug(draftName)));

  function toggle(tag: KnownTag) {
    if (chosen.has(tag.slug)) onChange(value.filter((name) => tagSlug(name) !== tag.slug));
    else if (!full) onChange([...value, tag.name]);
  }

  function startNew(name: string) {
    setDraft({ name, color: null, icon: null });
    setError('');
  }

  async function create() {
    if (!draft || !draftName || busy) return;
    setBusy(true);
    setError('');
    try {
      const { tag } = await api<{ tag: Tag; created: boolean }>('/tags', { method: 'POST', body: { name: draftName, color: draft.color, icon: draft.icon } });
      onCreated(tag);
      if (!chosen.has(tag.slug) && !full) onChange([...value, tag.name]);
      setDraft(null);
      setQuery('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = t('editor.tags');
  return (
    <Modal title={title} onClose={onClose} closeOnBackdrop className="tag-picker">
      <div className="tag-picker-body">
        <div className="tag-picker-head">
          <h2>
            {title}{' '}
            <span className="muted">
              · {value.length}/{MAX_TAGS}
            </span>
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="tag-picker-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t('tags.search')}
            aria-label={t('tags.search')}
            // On phones the keyboard would cover the list at once: there, search is a tap away.
            autoFocus={!phone}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const same = bySlug.get(tagSlug(typed));
              if (same) toggle(same);
              else if (offer && !full) startNew(offer);
            }}
          />
        </label>

        <div className="tag-picker-list">
          <section className="tag-picker-section" aria-label={t('tags.chosen')}>
            <span className="studio-label">{t('tags.chosen')}</span>
            {chosenTags.length ? (
              <div className="tag-picker-chips">
                {chosenTags.map((tag) => (
                  <TagChip key={tag.slug} tag={tag} className="is-removable">
                    <button type="button" className="tag-pill-remove" aria-label={t('editor.tagRemove', { tag: tag.name })} onClick={() => toggle(tag)}>
                      <X size={12} />
                    </button>
                  </TagChip>
                ))}
              </div>
            ) : (
              <p className="muted small">{t('editor.tagsNone')}</p>
            )}
            {full && <p className="field-hint">{t('editor.tagsFull', { n: MAX_TAGS })}</p>}
          </section>

          {draft ? (
            <section className="tag-new" aria-label={t('tags.new')}>
              <div className="tag-new-head">
                <strong>{t('tags.new')}</strong>
                <TagChip tag={{ name: draftName || t('tags.namePlaceholder'), color: draft.color, icon: draft.icon }} />
              </div>
              <label className="field">
                <span className="field-label">{t('tags.name')}</span>
                <input
                  className="input"
                  value={draft.name}
                  maxLength={TAG_NAME_MAX}
                  placeholder={t('tags.namePlaceholder')}
                  autoFocus={!phone}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setDraft({ ...draft, name: typingTagName(event.target.value) })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void create();
                    }
                  }}
                />
                <span className="field-hint">{draftExists ? t('tags.exists') : t('tags.nameHint')}</span>
              </label>
              <TagStyleFields color={draft.color} icon={draft.icon} onChange={(next) => setDraft({ ...draft, ...next })} />
              {error && <p className="form-error">{error}</p>}
              <div className="tag-new-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || !draftName || full} onClick={() => void create()}>
                  {busy ? t('common.loading') : draftExists ? t('tags.addExisting') : t('tags.create')}
                </button>
              </div>
            </section>
          ) : offer ? (
            <button type="button" className="tag-new-offer is-named" disabled={full} onClick={() => startNew(offer)}>
              <Plus size={16} aria-hidden="true" />
              <span>{t('tags.createNamed')}</span>
              <TagChip tag={{ name: offer }} />
            </button>
          ) : (
            <button type="button" className="tag-new-offer" disabled={full} onClick={() => startNew('')}>
              <Plus size={16} aria-hidden="true" />
              <span>{t('tags.new')}</span>
            </button>
          )}

          <section className="tag-picker-section" aria-label={t('tags.all')}>
            <span className="studio-label">
              {t('tags.all')} {known && <span className="muted">· {all.length}</span>}
            </span>
            {known === null ? (
              <p className="muted small">{t('common.loading')}</p>
            ) : found.length === 0 ? (
              <p className="muted small">{query.trim() ? t('tags.noneFound', { q: query.trim() }) : t('tags.noneYet')}</p>
            ) : (
              <div className="tag-picker-chips">
                {found.map((tag) => {
                  const on = chosen.has(tag.slug);
                  return (
                    <button
                      key={tag.slug}
                      type="button"
                      className={`tag-pill tag-option${on ? ' is-on' : ''}`}
                      style={tagStyle(tag.color)}
                      aria-pressed={on}
                      disabled={!on && full}
                      onClick={() => toggle(tag)}
                    >
                      <TagLabel tag={tag} />
                      {on ? <Check size={14} className="tag-option-check" aria-hidden="true" /> : tag.posts ? <span className="tag-option-count">{formatNumber(tag.posts)}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* (while a new one is being made, its own buttons are the way on) */}
        {!draft && (
          <div className="tag-picker-foot">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('tags.done')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
