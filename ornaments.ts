// The ornaments of the books' covers: line art on a 100 × 100 grid, drawn in the palette's ornament colour (strokes;
// a few small dots and shades filled). Shared by the client (which draws them: client/src/lib/covers.ts) and the
// server (which checks that a cover's ornament is one of them: server/src/lib/books.ts). Each has a group (the
// picker's sections) and words to find it by (Romanian and English; the search ignores diacritics).

export type OrnamentGroup = 'classic' | 'sky' | 'zodiac' | 'chinese' | 'life' | 'nature' | 'symbols';

export const ORNAMENT_GROUPS: Record<OrnamentGroup, { ro: string; en: string }> = {
  classic: { ro: 'Clasice', en: 'Classic' },
  sky: { ro: 'Lună și cer', en: 'Moon and sky' },
  zodiac: { ro: 'Zodii', en: 'Star signs' },
  chinese: { ro: 'Zodiacul chinezesc', en: 'Chinese zodiac' },
  life: { ro: 'Viață și suflet', en: 'Life and soul' },
  nature: { ro: 'Natură', en: 'Nature' },
  symbols: { ro: 'Simboluri', en: 'Symbols' },
};

export interface Ornament {
  ro: string;
  en: string;
  group: OrnamentGroup;
  /** More words to find it by. */
  tags?: string;
  svg: string;
}

// ---------- Drawing helpers ----------

const n = (value: number) => Math.round(value * 100) / 100;
/** A point at a distance and an angle (degrees, clockwise from the top) from the middle. */
const at = (r: number, deg: number, cx = 50, cy = 50) => [n(cx + r * Math.sin((deg * Math.PI) / 180)), n(cy - r * Math.cos((deg * Math.PI) / 180))] as const;
const circle = (cx: number, cy: number, r: number, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}"${extra}/>`;
const dotted = ' stroke-dasharray="1 3"';
const dashed = ' stroke-dasharray="2 4"';
const shade = ' fill="currentColor" fill-opacity="0.35"';
const path = (d: string, extra = '') => `<path d="${d}"${extra}/>`;
/** Small filled dots: [x, y, r]. */
const dots = (list: [number, number, number][]) => `<g fill="currentColor">${list.map(([x, y, r]) => circle(x, y, r)).join('')}</g>`;
/** A four-pointed star (the covers' sparkle), around (cx, cy). */
const spark = (cx: number, cy: number, r = 5.5) => {
  const a = n(r * 0.27);
  const b = n(r - r * 0.27);
  return `M${cx} ${n(cy - r)}l${a} ${b} ${b} ${a}-${b} ${a}-${a} ${b}-${a}-${b}-${b}-${a} ${b}-${a}z`;
};
const sparks = (...list: [number, number, number?][]) => path(list.map(([x, y, r]) => spark(x, y, r)).join(''));
/** A shape and its mirror image across the middle (x = 50): draw half of anything symmetric. */
const sym = (d: string, extra = '') => `${path(d, extra)}${path(d, `${extra} transform="matrix(-1 0 0 1 100 0)"`)}`;
/** Something repeated around the middle, `count` times. */
const around = (count: number, inner: string, offset = 0) =>
  Array.from({ length: count }, (_, i) => `<g transform="rotate(${n(offset + (360 / count) * i)} 50 50)">${inner}</g>`).join('');
/** Straight rays between two distances from the middle. */
const rays = (count: number, from: number, to: number, offset = 0) =>
  path(
    Array.from({ length: count }, (_, i) => {
      const [x1, y1] = at(from, offset + (360 / count) * i);
      const [x2, y2] = at(to, offset + (360 / count) * i);
      return `M${x1} ${y1}L${x2} ${y2}`;
    }).join(''),
  );

/** A star sign's frame: a ring and a dotted ring inside it. */
const signFrame = circle(50, 50, 43) + circle(50, 50, 37, dotted);
/** The Chinese zodiac's frame: a ring with four beads on it. */
const sealFrame = circle(50, 50, 44) + dots([[50, 6, 1.8], [94, 50, 1.8], [50, 94, 1.8], [6, 50, 1.8]]);
const sign = (glyph: string) => signFrame + path(glyph);
const animal = (drawing: string) => sealFrame + drawing;

/** A heart, its point at the bottom (x 18–82, y 22–80). */
const HEART = 'M50 80C30 66 18 54 18 40c0-10 8-18 17-18 7 0 12 4 15 10 3-6 8-10 15-10 9 0 17 8 17 18 0 14-12 26-32 40z';
/** A cloud (x 20–80, y 34–66). */
const CLOUD = 'M27 66a10 10 0 0 1-1-20 14 14 0 0 1 26-9 12 12 0 0 1 21 7 11 11 0 0 1 0 22z';

// ---------- The ornaments ----------

export const ORNAMENTS = {
  // The first ones: the designs the site began with (the editor shows these first).
  spiral: {
    ro: 'Spirală',
    en: 'Spiral',
    group: 'classic',
    svg: '<circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="38" stroke-dasharray="1 3"/><path d="M50 50c0-3 3-5 6-4 5 1 6 8 2 12-6 5-16 3-19-4-4-9 2-20 12-23 12-4 25 3 28 15 4 15-6 30-21 32-18 3-34-9-36-27"/><path d="M20 18l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5zM82 74l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
  },
  lotus: {
    ro: 'Lotus',
    en: 'Lotus',
    group: 'classic',
    tags: 'floare flower meditatie',
    svg: '<path d="M50 78C38 66 36 48 50 30c14 18 12 36 0 48z"/><path d="M50 78C36 74 24 62 22 44c14 2 26 14 28 34"/><path d="M50 78c14-4 26-16 28-34-14 2-26 14-28 34"/><path d="M50 78C34 80 18 72 10 58c14-4 30 4 40 20"/><path d="M50 78c16 2 32-6 40-20-14-4-30 4-40 20"/><path d="M28 86h44"/><circle cx="50" cy="16" r="4"/>',
  },
  wheel: {
    ro: 'Roata',
    en: 'Wheel',
    group: 'classic',
    tags: 'zodiac case houses astrologie',
    svg: '<circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="33"/><circle cx="50" cy="50" r="12"/><path d="M50 6v11M50 83v11M6 50h11M83 50h11M18.9 18.9l7.8 7.8M73.3 73.3l7.8 7.8M18.9 81.1l7.8-7.8M73.3 26.7l7.8-7.8M27.8 11.6l4.2 10.2M68 78.2l4.2 10.2M11.6 72.2l10.2-4.2M78.2 32l10.2-4.2M72.2 11.6 68 21.8M32 78.2l-4.2 10.2M88.4 72.2l-10.2-4.2M21.8 32 11.6 27.8"/>',
  },
  moons: {
    ro: 'Fazele',
    en: 'Phases',
    group: 'classic',
    tags: 'luna moon faze',
    svg: '<circle cx="50" cy="50" r="16"/><circle cx="18" cy="50" r="7"/><path d="M18 43a7 7 0 0 1 0 14"/><circle cx="82" cy="50" r="7"/><path d="M82 43a7 7 0 0 0 0 14"/><circle cx="50" cy="16" r="5"/><circle cx="50" cy="84" r="5"/><path d="M50 21v13M50 66v13M25 50h9M66 50h9"/><path d="M50 34a16 16 0 0 0 0 32"/>',
  },
  halfmoon: {
    ro: 'Umbră',
    en: 'Shadow',
    group: 'classic',
    tags: 'umbra lumina shadow light',
    svg: '<circle cx="50" cy="50" r="24"/><path d="M50 26a24 24 0 0 0 0 48z" fill="currentColor" fill-opacity="0.35"/><path d="M50 8v10M50 82v10M8 50h10M82 50h10M20.3 20.3l7 7M72.7 72.7l7 7M20.3 79.7l7-7M72.7 27.3l7-7"/>',
  },
  candle: {
    ro: 'Lumânare',
    en: 'Candle',
    group: 'classic',
    tags: 'lumina flacara rugaciune light prayer',
    svg: '<path d="M42 48h16v38H42z"/><path d="M50 40c-5-5-4-12 0-18 4 6 5 13 0 18z"/><path d="M50 40v8"/><path d="M30 86h40"/><path d="M50 10v5M30 18l3 4M70 18l-3 4M22 34l5 2M78 34l-5 2"/>',
  },
  stars: {
    ro: 'Constelație',
    en: 'Constellation',
    group: 'classic',
    tags: 'stele stars cer',
    svg: '<circle cx="50" cy="50" r="44" stroke-dasharray="2 4"/><path d="M16 62 31 47l15 6 14-19 20-7M60 34l6 22 18 8"/><g fill="currentColor"><circle cx="16" cy="62" r="2.2"/><circle cx="31" cy="47" r="2.8"/><circle cx="46" cy="53" r="2"/><circle cx="60" cy="34" r="3.2"/><circle cx="80" cy="27" r="2.4"/><circle cx="66" cy="56" r="2"/><circle cx="84" cy="64" r="2.6"/></g><path d="M26 20l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM74 80l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
  },
  mandala: {
    ro: 'Mandala',
    en: 'Mandala',
    group: 'classic',
    svg:
      '<circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="9"/>' +
      [0, 45, 90, 135, 180, 225, 270, 315]
        .map((a) => `<ellipse cx="50" cy="29" rx="6" ry="13" transform="rotate(${a} 50 50)"/><circle cx="50" cy="10" r="2" transform="rotate(${a + 22.5} 50 50)"/>`)
        .join(''),
  },
  waves: {
    ro: 'Valuri',
    en: 'Waves',
    group: 'classic',
    tags: 'mare apa sea water soare',
    svg: '<circle cx="50" cy="38" r="15"/><path d="M50 14v5M30 22l3 4M70 22l-3 4M24 38h5M71 38h5"/><path d="M8 60c7-5 14-5 21 0s14 5 21 0 14-5 21 0 14 5 21 0"/><path d="M14 71c6-4 12-4 18 0s12 4 18 0 12-4 18 0 12 4 18 0"/><path d="M22 82c5-3 10-3 15 0s10 3 15 0 10-3 15 0"/>',
  },
  tree: {
    ro: 'Arbore',
    en: 'Tree',
    group: 'classic',
    tags: 'copac viata life',
    svg: '<circle cx="50" cy="42" r="32"/><path d="M50 90V48"/><path d="M50 90c-6-3-13-3-20-1M50 90c6-3 13-3 20-1"/><path d="M50 66 34 52M50 60l16-14M50 52 40 36M50 50l10-16M34 52l-8 2M66 46l8-1M40 36l-2-8M60 34l3-8"/><g fill="currentColor"><circle cx="26" cy="54" r="2"/><circle cx="74" cy="45" r="2"/><circle cx="38" cy="28" r="2"/><circle cx="63" cy="26" r="2"/><circle cx="50" cy="18" r="2"/></g>',
  },

  // ---------- The Moon and the sky ----------
  crescent: {
    ro: 'Semilună',
    en: 'Crescent',
    group: 'sky',
    tags: 'luna moon noapte night',
    svg: circle(50, 50, 44, dotted) + path('M64 20a32 32 0 1 0 0 60a34 34 0 0 1 0-60z') + sparks([76, 32, 5.5], [82, 60, 3.5]) + dots([[70, 46, 1.6]]),
  },
  'full-moon': {
    ro: 'Lună plină',
    en: 'Full moon',
    group: 'sky',
    tags: 'luna moon noapte night',
    svg: circle(50, 50, 26) + circle(42, 43, 5) + circle(59, 58, 4) + circle(57, 39, 2.5) + circle(40, 60, 2) + circle(50, 50, 34, dotted) + rays(8, 39, 45, 22.5),
  },
  'new-moon': {
    ro: 'Lună nouă',
    en: 'New moon',
    group: 'sky',
    tags: 'luna moon inceput beginning',
    svg: circle(50, 50, 26, dashed) + path('M56 24.7a26 26 0 0 1 0 50.6a30 30 0 0 0 0-50.6z', shade) + sparks([18, 22, 4.5], [82, 26, 3.5], [22, 80, 3.5], [80, 78, 4.5]),
  },
  eclipse: {
    ro: 'Eclipsă',
    en: 'Eclipse',
    group: 'sky',
    tags: 'soare luna sun moon',
    svg: circle(50, 50, 22) + circle(57, 46, 19, shade) + rays(12, 28, 40) + rays(12, 28, 34, 15),
  },
  sun: {
    ro: 'Soare',
    en: 'Sun',
    group: 'sky',
    tags: 'lumina zi light day vara summer',
    svg:
      circle(50, 50, 16) +
      circle(50, 50, 10, dotted) +
      path(
        Array.from({ length: 12 }, (_, i) => {
          const [x1, y1] = at(22, i * 30 - 6);
          const [x2, y2] = at(42, i * 30);
          const [x3, y3] = at(22, i * 30 + 6);
          return `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}`;
        }).join(''),
      ) +
      rays(12, 24, 31, 15),
  },
  'sun-moon': {
    ro: 'Soare și Lună',
    en: 'Sun and Moon',
    group: 'sky',
    tags: 'zi noapte day night echilibru balance',
    svg:
      circle(50, 50, 20) +
      path('M50 30a20 20 0 0 1 0 40a12 20 0 0 0 0-40z', shade) +
      path(
        [200, 225, 250, 275, 300, 325]
          .map((deg) => {
            const [x1, y1] = at(26, deg);
            const [x2, y2] = at(deg % 50 === 0 ? 38 : 34, deg);
            return `M${x1} ${y1}L${x2} ${y2}`;
          })
          .join(''),
      ) +
      sparks([76, 26, 4.5], [82, 70, 3.5], [70, 84, 2.5]),
  },
  'north-star': {
    ro: 'Steaua Nordului',
    en: 'North Star',
    group: 'sky',
    tags: 'stea star busola drum',
    svg:
      path(
        Array.from({ length: 16 }, (_, i) => {
          const r = i % 2 ? 7 : i % 4 === 0 ? 40 : 18;
          const [x, y] = at(r, i * 22.5);
          return `${i ? 'L' : 'M'}${x} ${y}`;
        }).join('') + 'z',
      ) +
      path('M50 10v80M10 50h80M50 50', ' stroke-opacity="0.5"') +
      circle(50, 50, 28, dotted),
  },
  comet: {
    ro: 'Cometă',
    en: 'Comet',
    group: 'sky',
    tags: 'stea cazatoare shooting star dorinta wish',
    svg: circle(68, 32, 9) + path('M61 38C48 52 32 60 14 64M64 42C54 58 40 70 22 78M60 34C46 42 30 46 14 46') + sparks([30, 22, 4.5], [84, 66, 3.5]) + dots([[44, 80, 1.6], [80, 14, 1.6]]),
  },
  planet: {
    ro: 'Planetă',
    en: 'Planet',
    group: 'sky',
    tags: 'saturn cosmos spatiu space',
    svg:
      `<g transform="rotate(-18 50 50)">${circle(50, 50, 20)}${path('M10 50a40 11 0 0 0 80 0M10 50A40 11 0 0 1 32.6 40.1M67.4 40.1A40 11 0 0 1 90 50')}</g>` +
      circle(82, 22, 3) +
      sparks([20, 22, 4.5], [78, 80, 3.5]),
  },
  orbits: {
    ro: 'Orbite',
    en: 'Orbits',
    group: 'sky',
    tags: 'sistem solar solar system planete planets cosmos',
    svg: circle(50, 50, 7) + circle(50, 50, 18) + circle(50, 50, 30, dotted) + circle(50, 50, 42) + dots([[...at(18, 120), 2.6] as [number, number, number], [...at(30, 300), 3.2] as [number, number, number], [...at(42, 40), 2.4] as [number, number, number]]),
  },
  'cloud-moon': {
    ro: 'Nor și lună',
    en: 'Cloud and moon',
    group: 'sky',
    tags: 'noapte night vis dream',
    svg: path('M62 14a18 18 0 1 0 22 26a14 14 0 1 1-22-26z') + path(CLOUD, ' transform="translate(-6 16)"') + sparks([26, 24, 4.5], [86, 72, 3]),
  },

  // ---------- The star signs ----------
  aries: { ro: 'Berbec', en: 'Aries', group: 'zodiac', tags: 'zodie sign martie aprilie', svg: sign('M50 72V44M50 44c0-10-6-16-13-16s-11 5-11 10 3 9 8 9M50 44c0-10 6-16 13-16s11 5 11 10-3 9-8 9') },
  taurus: { ro: 'Taur', en: 'Taurus', group: 'zodiac', tags: 'zodie sign aprilie mai', svg: sign('M28 28c2 9 11 16 22 16s20-7 22-16') + circle(50, 59, 14) },
  gemini: { ro: 'Gemeni', en: 'Gemini', group: 'zodiac', tags: 'zodie sign mai iunie', svg: sign('M40 34v32M60 34v32M28 28c14 7 30 7 44 0M28 72c14-7 30-7 44 0') },
  cancer: { ro: 'Rac', en: 'Cancer', group: 'zodiac', tags: 'zodie sign iunie iulie', svg: sign('M36 36c10-6 25-6 36 3M64 64c-10 6-25 6-36-3') + circle(36, 43, 7) + circle(64, 57, 7) },
  leo: { ro: 'Leu', en: 'Leo', group: 'zodiac', tags: 'zodie sign iulie august', svg: sign('M45 52c-2-4-4-9-4-14 0-8 6-13 13-13s13 5 13 13c0 8-6 13-8 22-1 6 2 12 8 12 4 0 6-3 6-6') + circle(37, 56, 8) },
  virgo: { ro: 'Fecioară', en: 'Virgo', group: 'zodiac', tags: 'zodie sign august septembrie', svg: sign('M26 34v30M26 41c0-5 3-7 7-7s7 2 7 7v23M40 41c0-5 3-7 7-7s7 2 7 7v23M54 41c0-5 3-7 7-7s7 2 7 7v12c0 9-5 15-12 18M58 74c-6-1-8-6-5-10 3-4 10-3 13 2') },
  libra: { ro: 'Balanță', en: 'Libra', group: 'zodiac', tags: 'zodie sign septembrie octombrie echilibru', svg: sign('M26 72h48M26 62h15c-4-4-6-9-6-14 0-9 7-15 15-15s15 6 15 15c0 5-2 10-6 14h15') },
  scorpio: { ro: 'Scorpion', en: 'Scorpio', group: 'zodiac', tags: 'zodie sign octombrie noiembrie', svg: sign('M26 34v30M26 41c0-5 3-7 7-7s7 2 7 7v23M40 41c0-5 3-7 7-7s7 2 7 7v20c0 6 3 8 8 8h10M68 63l7 6-7 6') },
  sagittarius: { ro: 'Săgetător', en: 'Sagittarius', group: 'zodiac', tags: 'zodie sign noiembrie decembrie sageata', svg: sign('M28 72 72 28M52 28h20v20M36 50l14 14') },
  capricorn: {
    ro: 'Capricorn',
    en: 'Capricorn',
    group: 'zodiac',
    tags: 'zodie sign decembrie ianuarie',
    svg: sign('M24 32l10 34 9-28c2-6 7-8 11-5 4 4 2 11-1 16-3 6-2 14 5 15 6 1 10-4 9-9-1-6-8-8-12-4M54 56c-3 7-8 14-16 18'),
  },
  aquarius: { ro: 'Vărsător', en: 'Aquarius', group: 'zodiac', tags: 'zodie sign ianuarie februarie apa', svg: sign('M24 43l9-7 9 7 9-7 9 7 9-7M24 63l9-7 9 7 9-7 9 7 9-7') },
  pisces: { ro: 'Pești', en: 'Pisces', group: 'zodiac', tags: 'zodie sign februarie martie', svg: sign('M32 27c10 9 10 37 0 46M68 27c-10 9-10 37 0 46M28 50h44') },

  // ---------- The Chinese zodiac, the five elements, the fire bird ----------
  rat: {
    ro: 'Șobolan',
    en: 'Rat',
    group: 'chinese',
    tags: 'soarece mouse zodiac chinezesc',
    svg: animal(
      circle(33, 31, 9) + circle(67, 31, 9) + circle(33, 31, 4.5) + circle(67, 31, 4.5) +
        sym('M50 34c-12 0-20 8-20 18 0 10 9 19 20 28') +
        sym('M45 72l-17-4M45 75l-16 4') +
        dots([[43, 50, 2], [57, 50, 2], [50, 76, 2.4]]),
    ),
  },
  ox: {
    ro: 'Bivol',
    en: 'Ox',
    group: 'chinese',
    tags: 'bou taur ox zodiac chinezesc',
    svg: animal(
      sym('M40 33c-10 0-19-6-23-17 6 6 14 8 22 6') +
        sym('M50 30H40c-5 0-8 4-8 9v13c0 7 3 13 6 17') +
        sym('M33 42c-6-1-12 1-16 5 6 2 12 2 16-1') +
        `<ellipse cx="50" cy="71" rx="13" ry="9"/>` +
        dots([[42, 50, 2], [58, 50, 2], [45.5, 72, 1.8], [54.5, 72, 1.8]]),
    ),
  },
  tiger: {
    ro: 'Tigru',
    en: 'Tiger',
    group: 'chinese',
    tags: 'zodiac chinezesc curaj courage',
    svg: animal(
      sym('M50 28c-14 0-24 10-24 24 0 10 4 18 12 22 4 2 8 4 12 4') +
        sym('M31 37c-4-6-2-12 4-12s9 4 10 8') +
        path('M44 34h12M43 40h14M45 46h10M50 34v12') +
        sym('M37 55c3-3 7-3 9 0') +
        path('M46 62h8l-4 4z') +
        sym('M50 66c-2 4-6 5-8 3') +
        sym('M27 54l7 2M27 60l7 0') +
        dots([[42, 55, 1.6], [58, 55, 1.6]]),
    ),
  },
  rabbit: {
    ro: 'Iepure',
    en: 'Rabbit',
    group: 'chinese',
    tags: 'zodiac chinezesc lun',
    svg: animal(
      sym('M43 42c-6-6-9-18-7-26 2-5 6-5 8-1 3 8 3 18 1 27') +
        circle(50, 59, 18) +
        path('M48 65h4l-2 2.4z') +
        sym('M50 67c-1 3-4 4-6 3') +
        sym('M45 66l-14-2M45 69l-13 3') +
        dots([[43, 56, 1.9], [57, 56, 1.9]]),
    ),
  },
  dragon: {
    ro: 'Dragon',
    en: 'Dragon',
    group: 'chinese',
    tags: 'zodiac chinezesc putere power',
    svg: animal(
      // the head in profile, facing left: snout, open jaw, eye, antlers, whiskers, a flaming mane
      path('M58 34C46 34 34 38 24 42c-4 2-4 6 0 7h10') +
        path('M34 52c-6 1-10 4-10 8 4 2 12 0 20-4') +
        path('M44 56c6 4 10 12 12 22M58 34c8 0 14 6 16 14 2 10 0 20-4 30') +
        path('M43 40c3-3 7-3 10 0-3 3-7 3-10 0z') +
        path('M56 34c4-8 10-14 18-18M65 25c2-4 6-6 10-6M61 29c6-2 12-2 16 2') +
        path('M23 43c-8-6-9-14-3-20M26 50c-6 6-6 14 2 18') +
        path('M74 48c6 2 10 8 10 14-4-4-8-4-12-2M72 62c6 2 8 8 8 13-3-3-7-3-10-2') +
        dots([[48, 40, 1.6], [28, 44, 1.3]]),
    ),
  },
  snake: {
    ro: 'Șarpe',
    en: 'Snake',
    group: 'chinese',
    tags: 'zodiac chinezesc intelepciune wisdom',
    svg: animal(
      // coiled, its head raised from the outer coil
      path('M56 68a10 4 0 0 0-20 0a14 6 0 0 0 28 0a18 8 0 0 0-36 0a22 10 0 0 0 44 0c3-8 4-18-1-26-4-6-3-14 3-18') +
        `<ellipse cx="76" cy="20" rx="7" ry="5" transform="rotate(-12 76 20)"/>` +
        path('M69 21l-5 1M64 22l-3-2M64 22l-3 2') +
        dots([[74, 18, 1.3]]),
    ),
  },
  horse: {
    ro: 'Cal',
    en: 'Horse',
    group: 'chinese',
    tags: 'zodiac chinezesc libertate freedom',
    svg: animal(
      path('M60 15l-6 12c-10 6-20 16-28 28-3 4-2 9 2 10 4 1 7-1 10-3l6-4c6-2 10-4 14-8 0 10 2 22 0 32h22c2-16 2-30-2-42-2-8-6-16-12-22l2-6z') +
        path('M66 22c7 4 11 11 13 20M70 33c5 5 7 11 8 18M72 46c3 5 4 10 4 16') +
        dots([[50, 32, 2], [30, 58, 1.6]]),
    ),
  },
  goat: {
    ro: 'Capră',
    en: 'Goat',
    group: 'chinese',
    tags: 'oaie sheep berbec zodiac chinezesc',
    svg: animal(
      sym('M44 31c-6-10-18-12-24-4-4 6 0 14 6 12 4-1 4-6 1-7') +
        sym('M38 40c-6 0-12-2-16-6 4 6 10 10 16 10') +
        sym('M50 30c-8 0-12 4-12 10v18c0 8 4 14 8 18l4 4') +
        path('M46 79c0 6 2 9 4 13 2-4 4-7 4-13') +
        dots([[43, 47, 2], [57, 47, 2], [47, 70, 1.6], [53, 70, 1.6]]),
    ),
  },
  monkey: {
    ro: 'Maimuță',
    en: 'Monkey',
    group: 'chinese',
    tags: 'zodiac chinezesc joaca play',
    svg: animal(
      circle(50, 50, 26) +
        circle(22, 52, 7) + circle(78, 52, 7) + circle(22, 52, 3.5) + circle(78, 52, 3.5) +
        path('M50 44c-4-8-17-8-17 3 0 11 8 21 17 23 9-2 17-12 17-23 0-11-13-11-17-3z') +
        path('M44 62c4 3 8 3 12 0') +
        path('M44 26c2-4 6-6 10-4') +
        dots([[43, 50, 2], [57, 50, 2], [48, 57, 1.4], [52, 57, 1.4]]),
    ),
  },
  rooster: {
    ro: 'Cocoș',
    en: 'Rooster',
    group: 'chinese',
    tags: 'zodiac chinezesc dimineata morning',
    svg: animal(
      // in profile, facing left: comb, beak, wattle, a round body, the tail's arching feathers, legs
      path('M35 25c-1-5 3-8 6-6 1-5 7-6 9-2 3-4 8-2 7 3') +
        path('M36 26c-5 1-8 6-7 11l-6 3 6 2c1 4 4 6 6 7') +
        path('M31 44c-2 4 0 8 3 8 2-2 2-5 0-8') +
        path('M50 23c4 6 4 13 0 19') +
        path('M38 49c-4 10-4 21 6 28 10 6 24 4 32-4 6-6 8-14 6-22') +
        path('M66 50c2-12 0-24-8-32M70 52c6-10 8-22 4-32M74 56c8-8 12-18 10-28') +
        path('M46 58c8-2 16 2 20 10-8 2-16 0-20-10z') +
        path('M50 80v8M58 80v8M46 88h8M54 88h8') +
        dots([[37, 32, 1.8]]),
    ),
  },
  dog: {
    ro: 'Câine',
    en: 'Dog',
    group: 'chinese',
    tags: 'caine zodiac chinezesc prietenie loyalty',
    svg: animal(
      sym('M50 30c-10 0-16 6-16 16v10c0 10 6 18 16 20') +
        sym('M36 35c-8-2-14 4-14 14 0 8 2 14 6 16 4-2 6-8 6-14') +
        path('M42 62c0-4 4-6 8-6s8 2 8 6') +
        `<ellipse cx="50" cy="58" rx="4" ry="3" fill="currentColor"/>` +
        path('M50 61v5') +
        sym('M50 66c-2 3-6 3-7 1') +
        dots([[43, 46, 2], [57, 46, 2]]),
    ),
  },
  pig: {
    ro: 'Porc',
    en: 'Pig',
    group: 'chinese',
    tags: 'mistret boar zodiac chinezesc abundenta',
    svg: animal(
      circle(50, 54, 24) + sym('M33 37l-7-13 15 6') + `<ellipse cx="50" cy="62" rx="10" ry="7"/>` + dots([[46.5, 62, 1.7], [53.5, 62, 1.7], [41, 48, 2], [59, 48, 2]]),
    ),
  },
  phoenix: {
    ro: 'Pasărea de foc',
    en: 'Fire bird',
    group: 'chinese',
    tags: 'phoenix fenix foc fire renastere rebirth',
    svg:
      // wings raised like flames, the head turned left, three long tail feathers sweeping out, each ending in an eye
      path('M50 42c-4 6-4 14 0 22 4-8 4-16 0-22z') +
      path('M52 40c0-5-3-8-7-8-3 0-5 2-6 4l-5 1 5 2c1 1 2 2 4 2') +
      path('M51 33c2-5 7-7 12-5M50 32c1-6 5-9 10-9M52 35c4-3 9-3 13 0') +
      sym('M46 48c-8-6-15-14-19-26 0 8 2 14 6 18-6-2-12-6-16-12 2 10 8 18 16 22-6 0-10-2-14-4 7 8 17 10 27 8') +
      path('M50 64c-4 10-12 14-20 16-6 2-8 8-2 10M50 64c0 10 4 16 0 24M50 64c4 10 12 14 20 16 6 2 8 8 2 10') +
      `<ellipse cx="29" cy="90" rx="3" ry="2"/><ellipse cx="50" cy="90" rx="2" ry="3"/><ellipse cx="71" cy="90" rx="3" ry="2"/>` +
      dots([[46, 35, 1]]) +
      sparks([20, 70, 3.5], [80, 70, 3.5]),
  },
  lantern: {
    ro: 'Felinar',
    en: 'Lantern',
    group: 'chinese',
    tags: 'lampion lumina light anul nou new year',
    svg:
      path('M50 8v10M40 18h20M40 82h20') +
      `<ellipse cx="50" cy="50" rx="26" ry="32"/>` +
      `<ellipse cx="50" cy="50" rx="13" ry="32"/>` +
      path('M50 18v64M26 50h48') +
      path('M50 82v8M46 90l-2 6M50 90v6M54 90l2 6'),
  },
  fire: {
    ro: 'Foc',
    en: 'Fire',
    group: 'chinese',
    tags: 'element flacara flame pasiune',
    svg:
      path('M50 86c-14 0-22-10-22-22 0-12 8-18 12-30 4 6 4 12 2 18 6-4 10-12 10-24 10 8 20 20 20 36 0 12-8 22-22 22z') +
      path('M50 86c-6 0-10-4-10-10 0-6 6-10 8-16 4 4 12 10 12 16 0 6-4 10-10 10z') +
      sparks([24, 22, 3.5], [78, 30, 4.5]),
  },
  water: {
    ro: 'Apă',
    en: 'Water',
    group: 'chinese',
    tags: 'element picatura drop lacrima',
    svg: path('M50 14c-12 18-22 31-22 44a22 22 0 0 0 44 0c0-13-10-26-22-44z') + path('M37 62c4 3 9 3 13 0s9-3 13 0M40 70c3 2 7 2 10 0s7-2 10 0') + path('M38 52c0-5 3-10 6-14'),
  },
  wood: {
    ro: 'Lemn',
    en: 'Wood',
    group: 'chinese',
    tags: 'element bambus bamboo',
    svg:
      path('M42 90V16M56 90V30M38 34h8M38 54h8M38 74h8M52 48h8M52 68h8') +
      path('M42 34c6-8 16-10 26-8-6 6-16 8-26 8zM56 48c8-4 16-4 24 0-8 3-16 3-24 0zM42 54c-6-6-14-8-22-6 6 5 14 7 22 6z'),
  },
  metal: {
    ro: 'Metal',
    en: 'Metal',
    group: 'chinese',
    tags: 'element moneda coin noroc luck',
    svg: circle(50, 50, 32) + circle(50, 50, 26) + path('M41 41h18v18H41z') + dots([[50, 30, 1.8], [70, 50, 1.8], [50, 70, 1.8], [30, 50, 1.8]]),
  },
  earth: {
    ro: 'Pământ',
    en: 'Earth',
    group: 'chinese',
    tags: 'element munte mountain',
    svg: path('M12 76l22-30 12 14 10-16 32 32z') + path('M28 54l6-8 6 8') + circle(70, 28, 7) + path('M8 82h84M18 88h64'),
  },
  'yin-yang': {
    ro: 'Yin și Yang',
    en: 'Yin and Yang',
    group: 'chinese',
    tags: 'echilibru balance tao',
    svg: circle(50, 50, 36) + path('M50 14a36 36 0 0 1 0 72a18 18 0 0 1 0-36a18 18 0 0 0 0-36z', shade) + path('M50 14a18 18 0 0 1 0 36a18 18 0 0 0 0 36') + `<circle cx="50" cy="32" r="5" fill="currentColor"/>` + circle(50, 68, 5),
  },

  // ---------- Life and the soul ----------
  heart: {
    ro: 'Inimă',
    en: 'Heart',
    group: 'life',
    tags: 'iubire dragoste love',
    svg: path(HEART) + path(HEART, `${dotted} transform="translate(50 50) scale(0.72) translate(-50 -50)"`) + sparks([82, 18, 4.5], [16, 76, 3.5]),
  },
  'two-hearts': {
    ro: 'Iubire',
    en: 'Love',
    group: 'life',
    tags: 'inimi hearts dragoste cuplu couple',
    svg: path(HEART, ' transform="translate(30 30) scale(0.62) translate(-38 -40)"') + path(HEART, ' transform="translate(62 58) scale(0.62) translate(-50 -50)"') + sparks([80, 22, 4.5], [20, 80, 3.5]),
  },
  'broken-heart': {
    ro: 'Inimă frântă',
    en: 'Broken heart',
    group: 'life',
    tags: 'tristete sadness durere pain despartire',
    svg:
      path('M48 80C28 66 16 54 16 40c0-10 8-18 17-18 7 0 12 4 15 10l-5 10 7 8-6 10 4 8z') +
      path('M54 80c20-14 30-26 30-40 0-10-8-18-17-18-7 0-12 4-15 10l-4 10 7 8-6 10z') +
      dots([[50, 88, 1.4], [44, 92, 1]]),
  },
  tear: {
    ro: 'Lacrimă',
    en: 'Tear',
    group: 'life',
    tags: 'tristete sadness plans crying dor',
    svg: path('M22 42c8 9 18 13 28 13s20-4 28-13') + path('M28 50l-4 6M38 54l-2 7M50 56v7M62 54l2 7M72 50l4 6') + path('M58 66c-4 6-6 9-6 12a6 6 0 0 0 12 0c0-3-2-6-6-12z') + path('M30 30c6-4 13-6 20-6s14 2 20 6', dotted),
  },
  rain: {
    ro: 'Nor cu ploaie',
    en: 'Rain cloud',
    group: 'life',
    tags: 'melancolie melancholy tristete sadness ploaie',
    svg: path(CLOUD, ' transform="translate(0 -10)"') + path('M32 66l-4 8M44 66l-4 8M56 66l-4 8M68 66l-4 8M38 80l-3 6M50 80l-3 6M62 80l-3 6'),
  },
  joy: {
    ro: 'Bucurie',
    en: 'Joy',
    group: 'life',
    tags: 'fericire happiness zambet smile soare',
    svg: circle(50, 50, 20) + path('M40 54c5 7 15 7 20 0') + dots([[43, 45, 2], [57, 45, 2]]) + rays(16, 26, 34) + rays(8, 37, 43, 22.5),
  },
  hope: {
    ro: 'Speranță',
    en: 'Hope',
    group: 'life',
    tags: 'ancora anchor credinta',
    svg: circle(50, 16, 6) + path('M50 22v64M38 34h24') + path('M20 60c0 15 13 26 30 26s30-11 30-26') + path('M20 60l-4 7M20 60l7 4M80 60l4 7M80 60l-7 4'),
  },
  peace: {
    ro: 'Porumbel',
    en: 'Dove',
    group: 'life',
    tags: 'pace peace liniste credinta spirit',
    svg:
      // flying left, wings up, an olive twig in its beak
      circle(28, 44, 6) +
      path('M22 44l-7 2 7 1') +
      path('M32 49c6 10 16 16 30 16 8 0 14-2 20-6l10 4-4-8c-6-6-16-8-26-6') +
      path('M38 52c-2-12 4-24 18-32 2 10 0 18-4 24 8-6 18-8 28-6-6 8-16 14-28 16') +
      path('M15 46c-4 4-6 8-6 12M11 52c-3-1-5 0-6 2M9 57c-2 0-4 2-4 3') +
      dots([[27, 43, 1.3]]) +
      sparks([76, 24, 4], [70, 84, 3]),
  },
  butterfly: {
    ro: 'Fluture',
    en: 'Butterfly',
    group: 'life',
    tags: 'transformare transformation schimbare change',
    svg:
      sym('M48 48c-6-14-18-24-28-22-6 2-6 12 0 18 6 6 16 6 28 4z') +
      sym('M48 54c-10 0-20 4-22 12-1 6 4 10 10 8 6-2 10-10 12-20z') +
      `<ellipse cx="50" cy="53" rx="2.5" ry="15"/>` +
      sym('M49 38c-2-6-6-10-10-12') +
      dots([[39, 26, 1.6], [61, 26, 1.6]]),
  },
  feather: {
    ro: 'Pană',
    en: 'Feather',
    group: 'life',
    tags: 'usurinta lightness scris writing',
    svg:
      path('M72 14C50 22 34 42 30 70l-4 16') +
      path('M72 14c-2 14-10 28-22 38-6 6-12 12-20 18') +
      path('M72 14C66 20 50 26 40 40c-6 8-8 18-10 30') +
      path('M62 26l-10 4M58 36l-12 4M52 46l-12 4') +
      sparks([24, 26, 4], [80, 70, 3.5]),
  },
  hourglass: {
    ro: 'Clepsidră',
    en: 'Hourglass',
    group: 'life',
    tags: 'timp time rabdare patience',
    svg:
      path('M30 14h40M30 86h40M36 14c0 18 14 24 14 36s-14 18-14 36M64 14c0 18-14 24-14 36s14 18 14 36') +
      path('M41 80c2-5 6-8 9-8s7 3 9 8z', shade) +
      path('M42 30h16l-8 12z', shade) +
      dots([[50, 56, 1], [50, 62, 1], [50, 68, 1]]),
  },
  infinity: {
    ro: 'Infinit',
    en: 'Infinity',
    group: 'life',
    tags: 'vesnicie eternity',
    svg: path('M50 50c-6-8-12-12-18-12a12 12 0 0 0 0 24c6 0 12-4 18-12s12-12 18-12a12 12 0 0 1 0 24c-6 0-12-4-18-12z') + sparks([50, 22, 5], [50, 80, 3.5]) + circle(50, 50, 44, dotted),
  },
  key: {
    ro: 'Cheie',
    en: 'Key',
    group: 'life',
    tags: 'secret raspuns answer usa door',
    svg: circle(50, 24, 13) + circle(50, 24, 6) + path('M50 37v51M50 72h10v6M50 82h8') + sparks([78, 20, 4], [24, 60, 3.5]),
  },
  compass: {
    ro: 'Busolă',
    en: 'Compass',
    group: 'life',
    tags: 'drum way directie direction orientare',
    svg: circle(50, 50, 36) + circle(50, 50, 29, dotted) + path('M50 20l7 30-7 30-7-30z') + path('M50 20l7 30H43z', shade) + rays(4, 36, 42, 45) + circle(50, 50, 2.5),
  },
  sprout: {
    ro: 'Mugur',
    en: 'Sprout',
    group: 'life',
    tags: 'inceput beginning viata noua new life crestere growth',
    svg: path('M50 84V48M50 60c-4-10-14-16-26-14 2 10 12 16 26 14zM50 52c4-12 14-18 26-16-2 12-12 18-26 16z') + path('M28 84h44') + sparks([30, 24, 4], [72, 18, 3]),
  },
  book: {
    ro: 'Carte deschisă',
    en: 'Open book',
    group: 'life',
    tags: 'cunoastere knowledge poveste story scris',
    svg:
      path('M50 32c-10-6-24-8-36-6v46c12-2 26 0 36 6 10-6 24-8 36-6V26c-12-2-26 0-36 6zM50 32v46') +
      path('M22 38c8-1 16 0 22 3M22 48c8-1 16 0 22 3M22 58c8-1 16 0 22 3M78 38c-8-1-16 0-22 3M78 48c-8-1-16 0-22 3M78 58c-8-1-16 0-22 3') +
      sparks([50, 14, 4.5]),
  },
  eye: {
    ro: 'Ochi',
    en: 'Eye',
    group: 'life',
    tags: 'intuitie intuition al treilea ochi third eye',
    svg:
      path('M14 54c10-14 22-20 36-20s26 6 36 20c-10 14-22 20-36 20S24 68 14 54z') +
      circle(50, 54, 12) +
      `<circle cx="50" cy="54" r="5" fill="currentColor"/>` +
      // rays above it
      path(
        [-60, -30, 0, 30, 60]
          .map((deg) => {
            const [x1, y1] = at(26, deg, 50, 54);
            const [x2, y2] = at(36, deg, 50, 54);
            return `M${x1} ${y1}L${x2} ${y2}`;
          })
          .join(''),
      ),
  },

  // ---------- Nature ----------
  mountain: {
    ro: 'Munte',
    en: 'Mountain',
    group: 'nature',
    tags: 'varf peak drum',
    svg: path('M8 80l28-42 12 16 14-24 30 50z') + path('M30 47l6 5 5-5M56 36l6 6 5-5') + circle(76, 24, 6) + path('M4 86h92', dotted),
  },
  leaf: {
    ro: 'Frunză',
    en: 'Leaf',
    group: 'nature',
    tags: 'toamna autumn natura',
    svg: path('M50 12C28 30 24 58 50 88 76 58 72 30 50 12z') + path('M50 24v70M50 40l-10-8M50 52l-14-10M50 64l-14-10M50 40l10-8M50 52l14-10M50 64l14-10'),
  },
  rose: {
    ro: 'Trandafir',
    en: 'Rose',
    group: 'nature',
    tags: 'floare flower iubire love',
    svg:
      path('M50 22c-12 0-20 8-20 18s8 16 20 16 20-6 20-16-8-18-20-18z') +
      path('M50 32c-6 0-9 4-8 8s6 6 10 4 4-7 0-9c-3-1-6 0-6 3M30 40c4 6 10 8 16 8M70 40c-4 6-10 8-16 8') +
      path('M50 56v32M50 70c-6-6-14-8-20-6 4 6 12 8 20 6zM50 76c6-6 14-8 20-6-4 6-12 8-20 6z'),
  },
  flower: {
    ro: 'Floare',
    en: 'Flower',
    group: 'nature',
    tags: 'margareta daisy primavara spring',
    svg: around(8, `<ellipse cx="50" cy="30" rx="5.5" ry="13"/>`) + circle(50, 50, 8) + dots([[50, 50, 2.5]]),
  },
  snowflake: {
    ro: 'Fulg de nea',
    en: 'Snowflake',
    group: 'nature',
    tags: 'iarna winter zapada snow',
    svg: around(6, path('M50 50V12M50 22l-6-6M50 22l6-6M50 34l-9-6M50 34l9-6')) + circle(50, 50, 5),
  },
  wheat: {
    ro: 'Spic de grâu',
    en: 'Wheat',
    group: 'nature',
    tags: 'recolta harvest paine bread vara',
    svg:
      path('M50 90V22') +
      [26, 36, 46, 56].map((y) => `<ellipse cx="43" cy="${y}" rx="4" ry="8" transform="rotate(-30 43 ${y})"/><ellipse cx="57" cy="${y}" rx="4" ry="8" transform="rotate(30 57 ${y})"/>`).join('') +
      `<ellipse cx="50" cy="16" rx="3.5" ry="7"/>` +
      path('M50 72c-6-6-14-6-20-2M50 80c6-6 14-6 20-2'),
  },
  pines: {
    ro: 'Pădure',
    en: 'Forest',
    group: 'nature',
    tags: 'brad pine copaci trees munte',
    svg: path('M50 14 34 40h8L28 60h10L24 80h52L62 60h10L58 40h8z') + path('M50 80v8') + path('M22 50 14 64h5l-7 12h20M78 50l8 14h-5l7 12H68') + path('M6 88h88'),
  },
  owl: {
    ro: 'Bufniță',
    en: 'Owl',
    group: 'nature',
    tags: 'intelepciune wisdom noapte night',
    svg:
      path('M30 30l6 6M70 30l-6 6') +
      path('M30 30c0 0 0 24 0 34 0 12 9 20 20 20s20-8 20-20V30c-6 6-14 8-20 8s-14-2-20-8z') +
      circle(41, 48, 7) + circle(59, 48, 7) +
      path('M47 56l3 5 3-5z') +
      path('M38 66c4 3 8 3 12 0 4 3 8 3 12 0M40 74c3 2 7 2 10 0 3 2 7 2 10 0') +
      path('M20 86h60M42 84v4M58 84v4') +
      dots([[41, 48, 2.5], [59, 48, 2.5]]),
  },
  cat: {
    ro: 'Pisică',
    en: 'Cat',
    group: 'nature',
    tags: 'motan casa home',
    svg:
      sym('M50 34c-8 0-14 2-18 5l-4-15 14 8') +
      sym('M32 39c-6 6-8 14-6 22 2 10 12 16 24 16') +
      path('M47 60h6l-3 3z') +
      sym('M50 63c-1 3-4 4-6 3') +
      sym('M44 62l-18-3M44 65l-17 2') +
      sym('M38 52c2-2 5-2 7 0') +
      dots([[41, 53, 1.4], [59, 53, 1.4]]),
  },
  crystal: {
    ro: 'Cristal',
    en: 'Crystal',
    group: 'nature',
    tags: 'piatra stone energie energy',
    svg: path('M50 14l12 18v36L50 86 38 68V32z') + path('M38 32h24M50 14v72M38 68h24') + sym('M30 50l-8 10v16l8 8 8-8V60zM22 60h16') + sparks([22, 26, 4], [78, 22, 3.5]),
  },

  // ---------- Symbols ----------
  'flower-of-life': {
    ro: 'Floarea vieții',
    en: 'Flower of life',
    group: 'symbols',
    tags: 'geometrie sacra sacred geometry',
    svg: circle(50, 50, 13) + around(6, circle(50, 37, 13)) + circle(50, 50, 28) + circle(50, 50, 40, dotted),
  },
  triquetra: {
    ro: 'Nod celtic',
    en: 'Celtic knot',
    group: 'symbols',
    tags: 'triquetra trinitate trinity',
    svg: around(3, path('M50 58C40 46 38 28 50 14c12 14 10 32 0 44z')) + circle(50, 50, 22),
  },
  ankh: {
    ro: 'Ankh',
    en: 'Ankh',
    group: 'symbols',
    tags: 'viata life egipt egypt',
    svg: path('M50 46c-8-6-12-14-12-20 0-8 6-12 12-12s12 4 12 12c0 6-4 14-12 20z') + path('M28 46h44M50 46v42') + sparks([22, 22, 4], [80, 76, 3.5]),
  },
  cross: {
    ro: 'Cruce',
    en: 'Cross',
    group: 'symbols',
    tags: 'credinta faith rugaciune prayer',
    svg: path('M45 18h10v20h18v10H55v38H45V48H27V38h18z') + rays(12, 38, 46, 15).replace('<path', '<path stroke-opacity="0.6"'),
  },
  dreamcatcher: {
    ro: 'Prinzător de vise',
    en: 'Dreamcatcher',
    group: 'symbols',
    tags: 'vise dreams somn sleep',
    svg:
      circle(50, 36, 26) +
      path(
        Array.from({ length: 8 }, (_, i) => {
          const [x, y] = at(26, i * 135, 50, 36);
          return `${i ? 'L' : 'M'}${x} ${y}`;
        }).join('') + 'z',
      ) +
      circle(50, 36, 3) +
      path('M30 52v18M50 62v22M70 52v18') +
      path('M30 70c-3 4-3 10 0 14 3-4 3-10 0-14zM50 84c-3 4-3 8 0 12 3-4 3-8 0-12zM70 70c-3 4-3 10 0 14 3-4 3-10 0-14z'),
  },
  triskele: {
    ro: 'Triskele',
    en: 'Triskele',
    group: 'symbols',
    tags: 'spirala tripla triple spiral celtic',
    svg: around(3, path('M50 50c0-10 6-18 16-18 8 0 14 6 14 13s-5 12-11 12-9-4-9-8 3-6 6-6')) + circle(50, 50, 42, dotted),
  },
  labyrinth: {
    ro: 'Labirint',
    en: 'Labyrinth',
    group: 'symbols',
    tags: 'cautare search drum path meditatie',
    svg:
      [40, 31, 22, 13]
        .map((r, i) => {
          const gap = [0, 180, 0, 180][i]!;
          const [x1, y1] = at(r, gap + 14);
          const [x2, y2] = at(r, gap - 14);
          return path(`M${x1} ${y1}A${r} ${r} 0 1 1 ${x2} ${y2}`);
        })
        .join('') +
      path('M50 10v9M50 81v-9M50 28v-9M50 72v9') +
      circle(50, 50, 3, ' fill="currentColor"'),
  },
} as const satisfies Record<string, Ornament>;

export type OrnamentId = keyof typeof ORNAMENTS;

/** Every ornament's id, by group. */
export const ORNAMENT_IDS = Object.keys(ORNAMENTS) as OrnamentId[];

/** What the book editor shows first: the first designs, then a few of the others, from every group (phones show the
 *  first ten; the rest are in "See more"). */
export const ORNAMENT_PICKS: OrnamentId[] = [
  ...ORNAMENT_IDS.filter((id) => ORNAMENTS[id].group === 'classic'),
  'crescent',
  'sun',
  'heart',
  'butterfly',
  'phoenix',
  'flower-of-life',
  'feather',
  'yin-yang',
];
