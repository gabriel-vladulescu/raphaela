import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CONSTELLATIONS } from '@/lib/constellations';
import { useI18n } from '@/lib/i18n';

const SHOW_MS = 8000; // how long a constellation stays up
const FADE_MS = 1400; // must match .constellation's opacity transition

const METEORS = [
  { delay: 1.2, duration: 9 },
  { delay: 4.6, duration: 12 },
  { delay: 7.9, duration: 14 },
  { delay: 11.3, duration: 10 },
];

type Pick = (previous: number | null) => number;

/** Picks a random constellation that isn't already on screen. */
function usePicker(): Pick {
  const onScreen = useRef(new Set<number>());
  return (previous) => {
    if (previous !== null) onScreen.current.delete(previous);
    const free = CONSTELLATIONS.map((_, i) => i).filter((i) => i !== previous && !onScreen.current.has(i));
    const next = free[Math.floor(Math.random() * free.length)]!;
    onScreen.current.add(next);
    return next;
  };
}

function ConstellationSlot({ slot, startDelay, pick, animate }: { slot: string; startDelay: number; pick: Pick; animate: boolean }) {
  const { lang } = useI18n();
  const [index, setIndex] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const glowId = `glow-${useId().replace(/[^\w-]/g, '')}`;

  // Cycle: draw in, hold, fade out, swap for another constellation.
  useEffect(() => {
    const timers: number[] = [];
    let current: number | null = null;
    const show = () => {
      current = pick(current);
      setIndex(current);
      setVisible(true);
      if (!animate) return;
      timers.push(
        window.setTimeout(() => {
          setVisible(false);
          timers.push(window.setTimeout(show, FADE_MS));
        }, SHOW_MS),
      );
    };
    timers.push(window.setTimeout(show, animate ? startDelay : 0));
    return () => timers.forEach(clearTimeout);
    // Runs once: `pick` reads a ref, and `animate` doesn't change while mounted.
  }, []);

  if (index === null) return null;
  const constellation = CONSTELLATIONS[index]!;

  return (
    <div className={`constellation constellation-${slot}${visible ? ' is-visible' : ''}`}>
      <svg key={constellation.id} viewBox="-6 -6 112 112">
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="constellation-lines">
          {constellation.lines.map(([from, to], i) => {
            const [x1, y1] = constellation.stars[from]!;
            const [x2, y2] = constellation.stars[to]!;
            const style = { '--len': Math.hypot(x2 - x1, y2 - y1), '--delay': `${0.4 + i * 0.16}s` } as CSSProperties;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} style={style} />;
          })}
        </g>
        <g className="constellation-stars" filter={`url(#${glowId})`}>
          {constellation.stars.map(([x, y, size], i) => {
            const style = { '--delay': `${i * 0.07}s`, '--twinkle': `${2.2 + (i % 4) * 0.8}s` } as CSSProperties;
            return <circle key={i} cx={x} cy={y} r={0.8 + size * 0.9} style={style} />;
          })}
        </g>
      </svg>
      <span className="constellation-name" key={`${constellation.id}-name`}>
        {constellation.glyph && <span className="constellation-glyph">{constellation.glyph}{'︎'}</span>}
        {constellation.name[lang]}
      </span>
    </div>
  );
}

/** A shooting star that jumps to a new random spot on every pass. */
function Meteor({ delay, duration }: { delay: number; duration: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const place = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--x', `${20 + Math.random() * 78}vw`);
    el.style.setProperty('--y', `${-4 + Math.random() * 42}vh`);
    el.style.setProperty('--length', `${90 + Math.random() * 130}px`);
  };
  useLayoutEffect(place, []);
  return (
    <span
      ref={ref}
      className="meteor"
      style={{ animationDelay: `${delay}s`, animationDuration: `${duration}s` }}
      onAnimationIteration={place}
    />
  );
}

/** Background for the midnight theme: drifting constellations and falling stars. */
export function MidnightSky() {
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pick = usePicker();

  return (
    <div className="midnight-sky" aria-hidden="true">
      <ConstellationSlot slot="a" startDelay={300} pick={pick} animate={!reducedMotion} />
      <ConstellationSlot slot="b" startDelay={3200} pick={pick} animate={!reducedMotion} />
      <ConstellationSlot slot="c" startDelay={6100} pick={pick} animate={!reducedMotion} />
      {!reducedMotion && METEORS.map((meteor, i) => <Meteor key={i} {...meteor} />)}
    </div>
  );
}
