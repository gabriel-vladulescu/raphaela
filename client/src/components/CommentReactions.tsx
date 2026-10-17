import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { SmilePlus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { COMMENT_EMOJI } from '@/lib/types';

const EMOJI_NAMES = { '❤️': 'love', '✨': 'magic', '🌙': 'moon', '🔥': 'fire', '😂': 'haha', '🙏': 'thanks' } as const;
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 250;

/** Closes a floating panel on a click outside `root` or on Escape. */
function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, root, close]);
}

/**
 * A comment's reactions: a "React" button that opens a dock of emoji (on hover with a mouse, or a tap),
 * then the comment's other actions (`children`), then a summary chip on the right (the most used emoji
 * and the total) that opens the breakdown.
 */
export function CommentReactions(props: {
  reactions: Record<string, number>;
  mine: string[];
  /** Signed in, and the comment isn't deleted. */
  canReact: boolean;
  onToggle: (emoji: string) => void;
  children?: ReactNode;
}) {
  const { reactions, mine, canReact, onToggle, children } = props;
  const { t } = useI18n();
  const [dockOpen, setDockOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const closeDock = useRef(() => setDockOpen(false)).current;
  const closeDetails = useRef(() => setDetailsOpen(false)).current;
  useDismiss(dockOpen, dockRef, closeDock);
  useDismiss(detailsOpen, detailsRef, closeDetails);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const entries = Object.entries(reactions);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  // Most used first; ties keep the order they were first used in.
  const top = [...entries].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([emoji]) => emoji);
  const name = (emoji: string) => t(`reaction.${EMOJI_NAMES[emoji as keyof typeof EMOJI_NAMES] ?? 'love'}`);

  // With a mouse, hovering opens the dock (after a short pause) and leaving closes it.
  const hover = (open: boolean) => (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setDockOpen(open), open ? HOVER_OPEN_MS : HOVER_CLOSE_MS);
  };

  return (
    <>
      {canReact && (
        <div className="rx-dock-root" ref={dockRef} onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
          <button
            type="button"
            className={`text-btn rx-trigger${mine.length ? ' is-mine' : ''}`}
            aria-label={t('comments.react')}
            aria-expanded={dockOpen}
            onClick={() => {
              window.clearTimeout(hoverTimer.current);
              setDockOpen((open) => !open);
            }}
          >
            {mine.length ? <span className="emoji rx-trigger-emoji">{mine[mine.length - 1]}</span> : <SmilePlus size={15} />}
            {/* Phones show the icon only. */}
            <span className="rx-trigger-label">{t('comments.react')}</span>
          </button>
          {dockOpen && (
            <div className="rx-dock" role="group" aria-label={t('comments.addReaction')}>
              {COMMENT_EMOJI.map((emoji, index) => (
                <button
                  key={emoji}
                  type="button"
                  className="rx-dock-btn"
                  style={{ '--i': index } as CSSProperties}
                  aria-pressed={mine.includes(emoji)}
                  aria-label={name(emoji)}
                  data-label={name(emoji)}
                  onClick={() => {
                    onToggle(emoji);
                    setDockOpen(false);
                  }}
                >
                  <span className="emoji">{emoji}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {children}

      {total > 0 && (
        <div className="rx-summary-root" ref={detailsRef}>
          <button
            type="button"
            className={`rx-summary${mine.length ? ' is-mine' : ''}`}
            aria-expanded={detailsOpen}
            aria-label={t('comments.reactionsTotal', { n: total })}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <span className="rx-stack" aria-hidden="true">
              {top.map((emoji) => (
                <span key={emoji} className="rx-bubble emoji">
                  {emoji}
                </span>
              ))}
            </span>
            <span key={total} className="rx-total">
              {total}
            </span>
          </button>
          {detailsOpen && (
            <div className="rx-details" role="dialog" aria-label={t('comments.reactionsTotal', { n: total })}>
              {entries.map(([emoji, n]) =>
                canReact ? (
                  <button key={emoji} type="button" className="rx-row" aria-pressed={mine.includes(emoji)} onClick={() => onToggle(emoji)}>
                    <span className="emoji">{emoji}</span>
                    <span className="rx-row-name">{name(emoji)}</span>
                    <span className="rx-row-count">{n}</span>
                  </button>
                ) : (
                  <div key={emoji} className="rx-row">
                    <span className="emoji">{emoji}</span>
                    <span className="rx-row-name">{name(emoji)}</span>
                    <span className="rx-row-count">{n}</span>
                  </div>
                ),
              )}
              {!canReact && <p className="muted small rx-hint">{t('comments.reactHint')}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
