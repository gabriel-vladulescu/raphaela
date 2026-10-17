import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MenuButton } from '@/components/MenuButton';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/**
 * A form's choice among a few options: a field like the form's others (its label above it, the choice in it), whose
 * options open as the filters' do (MenuButton), instead of the browser's own select.
 */
export function SelectField<T extends string>(props: { label: string; value: T; options: SelectOption<T>[]; onChange: (value: T) => void }) {
  const { label, value, options, onChange } = props;
  const selected = options.find((option) => option.value === value) ?? options[0]!;
  const SelectedIcon = selected.icon;
  return (
    <div className="field">
      <span className="field-label" aria-hidden="true">
        {label}
      </span>
      <MenuButton
        title={label}
        label={`${label}: ${selected.label}`}
        buttonClassName="input select-field"
        panelClassName="select-popover"
        button={
          <>
            {SelectedIcon && <SelectedIcon size={18} className="select-field-icon" aria-hidden="true" />}
            <span className="select-field-value">{selected.label}</span>
            <ChevronDown size={18} className="select-field-chevron" aria-hidden="true" />
          </>
        }
      >
        {(close) => (
          <div className="filter-options" role="listbox" aria-label={label}>
            {options.map((option) => {
              const Icon = option.icon;
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`filter-option${isSelected ? ' is-selected' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                >
                  {Icon && <Icon size={18} aria-hidden="true" />}
                  {option.label}
                  {isSelected && <Check size={16} className="filter-option-check" />}
                </button>
              );
            })}
          </div>
        )}
      </MenuButton>
    </div>
  );
}
