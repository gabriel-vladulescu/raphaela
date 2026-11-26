// The Moon's phase on a date, from the mean synodic month (accurate to a few hours, plenty for "the Moon is
// waxing, 64%").

const SYNODIC_DAYS = 29.530588853;
/** A known new moon: 6 January 2000, 18:14 UTC. */
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export type MoonPhase = 'new' | 'waxingCrescent' | 'firstQuarter' | 'waxingGibbous' | 'full' | 'waningGibbous' | 'lastQuarter' | 'waningCrescent';

export function moonOn(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86_400_000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const fraction = age / SYNODIC_DAYS;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  const eighth = Math.floor(fraction * 8 + 0.5) % 8;
  const phases: MoonPhase[] = ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent'];
  return {
    phase: phases[eighth]!,
    /** 0-100: how much of it is lit. */
    illumination: Math.round(illumination * 100),
    waxing: fraction < 0.5,
    /** 0-1 through the cycle (0: new, 0.5: full). */
    fraction,
  };
}
