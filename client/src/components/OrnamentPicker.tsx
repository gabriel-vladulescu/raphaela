import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ORNAMENT_GROUPS, ORNAMENT_IDS, ORNAMENTS } from '@/lib/covers';
import type { OrnamentGroup, OrnamentId } from '@/lib/covers';
import { useI18n } from '@/lib/i18n';
import { PHONE, useMediaQuery } from '@/lib/useMediaQuery';

/** Lower case, without diacritics: "Café" is found by "cafe". */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** The words an ornament is found by: its names, its group's and its own (a search word matches their start: "moo"
 *  finds "moon", "cat" finds "cat" but not "wildcat"). */
const wordsOf = Object.fromEntries(
  ORNAMENT_IDS.map((id) => {
    const ornament = ORNAMENTS[id] as { ro: string; en: string; group: OrnamentGroup; tags?: string };
    const group = ORNAMENT_GROUPS[ornament.group];
    return [id, plain(`${ornament.ro} ${ornament.en} ${ornament.tags ?? ''} ${group.ro} ${group.en} ${id}`).split(/[\s-]+/)];
  }),
) as Record<OrnamentId, string[]>;

/** One ornament to pick: its drawing and its name. */
export function OrnamentChoice({ id, selected, onPick }: { id: OrnamentId; selected: boolean; onPick: (id: OrnamentId) => void }) {
  const { lang } = useI18n();
  const name = ORNAMENTS[id][lang];
  return (
    <button type="button" aria-pressed={selected} title={name} onClick={() => onPick(id)}>
      <svg viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ORNAMENTS[id].svg }} />
      <span>{name}</span>
    </button>
  );
}

/**
 * Every ornament, by group, with a search (names, groups, words: "luna", "cal", "zodie", "foc"). A dialog on wide
 * screens, the whole screen on phones. Picking one closes it.
 */
export function OrnamentPicker({ value, onPick, onClose }: { value: OrnamentId; onPick: (id: OrnamentId) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const phone = useMediaQuery(PHONE);
  const [query, setQuery] = useState('');
  const words = plain(query).split(/\s+/).filter(Boolean);
  const found = ORNAMENT_IDS.filter((id) => words.every((word) => wordsOf[id].some((own) => own.startsWith(word))));
  const groups = (Object.keys(ORNAMENT_GROUPS) as OrnamentGroup[])
    .map((group) => ({ group, ids: found.filter((id) => ORNAMENTS[id].group === group) }))
    .filter((entry) => entry.ids.length > 0);
  const title = t('books.ornamentsAll');

  return (
    <Modal title={title} onClose={onClose} closeOnBackdrop className="ornament-picker">
      <div className="ornament-picker-body">
        <div className="ornament-picker-head">
          <h2>
            {title} <span className="muted">· {ORNAMENT_IDS.length}</span>
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="ornament-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t('books.ornamentsSearch')}
            aria-label={t('books.ornamentsSearch')}
            // On phones the keyboard would cover most of them at once: there, search is a tap away.
            autoFocus={!phone}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="ornament-picker-list">
          {groups.length === 0 ? (
            <p className="ornament-none muted">{t('books.ornamentsNone', { q: query.trim() })}</p>
          ) : (
            groups.map(({ group, ids }) => (
              <section key={group} aria-label={ORNAMENT_GROUPS[group][lang]}>
                <h3 className="studio-label">
                  {ORNAMENT_GROUPS[group][lang]} <span className="muted">· {ids.length}</span>
                </h3>
                <div className="ornament-grid">
                  {ids.map((id) => (
                    <OrnamentChoice key={id} id={id} selected={id === value} onPick={onPick} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
