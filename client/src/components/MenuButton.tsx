import { useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Popover } from '@/components/Popover';
import { useI18n } from '@/lib/i18n';
import { NARROW, PHONE, useMediaQuery } from '@/lib/useMediaQuery';

/**
 * A button that opens a menu: a panel under it on wide screens; on narrower ones (1000px and less) a dialog, from the
 * bottom of the screen on phones, which is easier to use with a finger. The notifications page's filters and the
 * forms' selects (SelectField) open their options this way.
 */
export function MenuButton(props: {
  /** Names the menu (its heading in the dialog). */
  title: string;
  /** The button's accessible name, when its text isn't enough (a select: "Category: Other"). */
  label?: string;
  button: ReactNode;
  buttonClassName: string;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { title, label, button, buttonClassName, panelClassName, children } = props;
  const narrow = useMediaQuery(NARROW);
  const phone = useMediaQuery(PHONE);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!narrow) {
    return (
      <Popover label={label ?? title} button={button} buttonClassName={buttonClassName} panelClassName={panelClassName} align="start">
        {children}
      </Popover>
    );
  }
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={`${buttonClassName}${open ? ' is-active' : ''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {button}
      </button>
      {open && (
        <Modal title={title} onClose={close} closeOnBackdrop sheet={phone} className={`filter-sheet${phone ? '' : ' filter-dialog'}`}>
          <div className="filter-sheet-body">
            <div className="filter-sheet-head">
              <h2>{title}</h2>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
                <X size={18} />
              </button>
            </div>
            {children(close)}
          </div>
        </Modal>
      )}
    </>
  );
}
