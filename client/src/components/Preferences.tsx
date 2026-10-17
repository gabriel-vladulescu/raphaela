import { Check, Moon, Sparkles, Sun } from 'lucide-react';
import { LANGS, useI18n } from '@/lib/i18n';
import { applyTheme, THEMES, useTheme } from '@/lib/theme';
import type { Theme } from '@/lib/theme';

const THEME_ICONS = { light: Sun, dark: Moon, midnight: Sparkles } satisfies Record<Theme, unknown>;

/** The site's themes, each with its swatch: a list (the settings menu), or just the swatches side by side
 *  (`swatches`, the phone's account sheet, which names the current theme beside them). */
export function ThemePicker({ swatches = false }: { swatches?: boolean }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <div className={`theme-options${swatches ? ' theme-swatches' : ''}`} role="group" aria-label={t('settings.theme')}>
      {THEMES.map((option) => {
        const Icon = THEME_ICONS[option];
        const name = t(`theme.${option}`);
        return (
          <button
            key={option}
            type="button"
            className={`theme-option${theme === option ? ' is-selected' : ''}`}
            aria-pressed={theme === option}
            aria-label={swatches ? name : undefined}
            title={swatches ? name : undefined}
            onClick={() => applyTheme(option)}
          >
            <span className={`theme-swatch theme-swatch-${option}`}>
              <Icon size={16} />
            </span>
            {!swatches && <span>{name}</span>}
            {theme === option && !swatches && <Check size={15} className="theme-check" />}
          </button>
        );
      })}
    </div>
  );
}

export function LanguagePicker() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="segmented" role="group" aria-label={t('settings.language')}>
      {LANGS.map((option) => (
        <button
          key={option.code}
          type="button"
          className={lang === option.code ? 'is-selected' : ''}
          aria-pressed={lang === option.code}
          onClick={() => setLang(option.code)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
