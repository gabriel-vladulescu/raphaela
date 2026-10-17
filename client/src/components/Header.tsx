import { AccountButton } from '@/components/AccountSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { SettingsPopover } from '@/components/SettingsPopover';
import { UserMenu } from '@/components/UserMenu';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';

/**
 * The top bar, without a bar behind it: room on the left for a page's own control (the home page's search, on
 * narrow screens; see headerSlot.ts), then the notifications bell (authors and owners), the settings cog and the
 * account menu. On narrow screens (phones and tablets) the last two are one button, opening the account sheet.
 */
export function Header({ slotRef }: { slotRef?: (element: HTMLDivElement | null) => void }) {
  const narrow = useMediaQuery(NARROW);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="header-slot" ref={slotRef} />
        <NotificationBell />
        {narrow ? (
          <AccountButton />
        ) : (
          <>
            <SettingsPopover />
            <UserMenu />
          </>
        )}
      </div>
    </header>
  );
}
