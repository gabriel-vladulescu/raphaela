// Procedural SVG banners for seed posts: a starry sky with a moon, planet, sun, eclipse or constellation.

export interface BannerStyle {
  sky: [string, string, string]; // gradient stops, top-left -> bottom-right
  glow: string; // nebula colour
  motif: 'moon' | 'planet' | 'ringed' | 'sun' | 'eclipse' | 'constellation';
  body?: [string, string]; // light and shadow colour of the moon/planet/sun
  glyph?: string; // big faint zodiac symbol
  hills?: string; // silhouette colour along the bottom
}

/** Small deterministic PRNG so the same seed always draws the same banner. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 900;
const n = (value: number) => value.toFixed(1);

const SHAPES: [number, number][][] = [
  [[0, 0.6], [0.18, 0.42], [0.36, 0.5], [0.55, 0.28], [0.78, 0.36], [1, 0.12]],
  [[0, 0.2], [0.22, 0.38], [0.4, 0.3], [0.52, 0.62], [0.74, 0.7], [0.92, 0.5]],
  [[0.1, 0.8], [0.3, 0.55], [0.48, 0.62], [0.6, 0.35], [0.84, 0.28], [0.7, 0.08]],
];

export function bannerSvg(style: BannerStyle, seed: number): string {
  const rand = mulberry32(seed);
  const [light, shade] = style.body ?? ['#fff6dc', '#c9b98f'];
  const cx = W * (0.6 + rand() * 0.2);
  const cy = H * (0.28 + rand() * 0.16);
  const r = 110 + rand() * 60;
  const parts: string[] = [];

  // Nebula glows and star field
  for (let i = 0; i < 3; i++) {
    parts.push(`<ellipse cx="${n(rand() * W)}" cy="${n(rand() * H * 0.7)}" rx="${n(300 + rand() * 380)}" ry="${n(160 + rand() * 200)}" fill="url(#nebula)" opacity="${(0.35 + rand() * 0.4).toFixed(2)}"/>`);
  }
  for (let i = 0; i < 170; i++) {
    const big = rand() > 0.93;
    parts.push(`<circle cx="${n(rand() * W)}" cy="${n(rand() * H * 0.88)}" r="${(big ? 1.6 + rand() * 1.4 : 0.5 + rand() * 1.1).toFixed(2)}" fill="#fff" opacity="${(0.3 + rand() * 0.7).toFixed(2)}"/>`);
  }
  for (let i = 0; i < 7; i++) {
    parts.push(`<circle cx="${n(rand() * W)}" cy="${n(rand() * H * 0.7)}" r="${n(9 + rand() * 13)}" fill="url(#twinkle)"/>`);
  }

  if (style.glyph) {
    parts.push(`<text x="${n(W * 0.06)}" y="${n(H * 0.86)}" font-size="430" fill="#fff" opacity="0.07" font-family="'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','DejaVu Sans',sans-serif">${style.glyph}&#xFE0E;</text>`);
  }

  switch (style.motif) {
    case 'moon':
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 2.1)}" fill="url(#halo)"/>`);
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#body)"/>`);
      for (let i = 0; i < 6; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * r * 0.7;
        parts.push(`<circle cx="${n(cx + Math.cos(angle) * dist)}" cy="${n(cy + Math.sin(angle) * dist)}" r="${n(r * (0.06 + rand() * 0.12))}" fill="${shade}" opacity="0.35"/>`);
      }
      break;
    case 'planet':
    case 'ringed': {
      const tilt = -14 - rand() * 12;
      const ring = (sweep: 0 | 1) =>
        `<path d="M${n(cx - r * 1.95)} ${n(cy)} A${n(r * 1.95)} ${n(r * 0.48)} 0 0 ${sweep} ${n(cx + r * 1.95)} ${n(cy)}" fill="none" stroke="${light}" stroke-width="${n(r * 0.09)}" stroke-opacity="0.55" transform="rotate(${n(tilt)} ${n(cx)} ${n(cy)})"/>`;
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.8)}" fill="url(#halo)" opacity="0.6"/>`);
      if (style.motif === 'ringed') parts.push(ring(1)); // back half of the ring
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#body)"/>`);
      parts.push(`<g clip-path="url(#planet-clip)" opacity="0.18">`);
      for (let i = -3; i <= 3; i++) {
        parts.push(`<rect x="${n(cx - r * 1.5)}" y="${n(cy + i * r * 0.28)}" width="${n(r * 3)}" height="${n(r * (0.06 + rand() * 0.1))}" fill="${shade}" transform="rotate(${n(tilt)} ${n(cx)} ${n(cy)})"/>`);
      }
      parts.push('</g>');
      if (style.motif === 'ringed') parts.push(ring(0)); // front half, over the planet
      break;
    }
    case 'sun':
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 3)}" fill="url(#halo)"/>`);
      for (let i = 0; i < 28; i++) {
        const angle = (i / 28) * Math.PI * 2;
        const inner = r * 1.15;
        const outer = r * (1.6 + rand() * 0.7);
        parts.push(`<line x1="${n(cx + Math.cos(angle) * inner)}" y1="${n(cy + Math.sin(angle) * inner)}" x2="${n(cx + Math.cos(angle) * outer)}" y2="${n(cy + Math.sin(angle) * outer)}" stroke="${light}" stroke-width="3" stroke-linecap="round" opacity="0.35"/>`);
      }
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#body)"/>`);
      break;
    case 'eclipse':
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 2.4)}" fill="url(#halo)"/>`);
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.04)}" fill="${light}" opacity="0.9"/>`);
      parts.push(`<circle cx="${n(cx + r * 0.05)}" cy="${n(cy - r * 0.03)}" r="${n(r)}" fill="${style.sky[0]}"/>`);
      parts.push(`<circle cx="${n(cx - r * 0.72)}" cy="${n(cy - r * 0.7)}" r="${n(r * 0.16)}" fill="url(#twinkle)"/>`);
      break;
    case 'constellation': {
      const shape = SHAPES[Math.floor(rand() * SHAPES.length)]!;
      const box = { x: W * 0.5, y: H * 0.12, w: W * 0.42, h: H * 0.5 };
      const points = shape.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h] as const);
      parts.push(`<polyline points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none" stroke="${light}" stroke-width="2.5" stroke-opacity="0.55" stroke-linejoin="round"/>`);
      for (const [x, y] of points) {
        parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(18 + rand() * 10)}" fill="url(#twinkle)"/>`);
        parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="#fff"/>`);
      }
      break;
    }
  }

  if (style.hills) {
    for (const [base, opacity] of [[0.78, 0.55], [0.86, 1]] as const) {
      const y = H * base;
      let d = `M0 ${n(y)}`;
      for (let x = 0; x < W; x += 400) {
        d += ` Q${n(x + 200)} ${n(y - 40 - rand() * 90)} ${n(x + 400)} ${n(y + (rand() - 0.5) * 40)}`;
      }
      parts.push(`<path d="${d} L${W} ${H} L0 ${H} Z" fill="${style.hills}" opacity="${opacity}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${style.sky[0]}"/><stop offset="0.55" stop-color="${style.sky[1]}"/><stop offset="1" stop-color="${style.sky[2]}"/></linearGradient>
<radialGradient id="nebula"><stop offset="0" stop-color="${style.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${style.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="twinkle"><stop offset="0" stop-color="#fff"/><stop offset="0.25" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="halo"><stop offset="0.35" stop-color="${light}" stop-opacity="0.45"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
<radialGradient id="body" cx="0.35" cy="0.35" r="0.75"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${shade}"/></radialGradient>
<clipPath id="planet-clip"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${parts.join('\n')}
</svg>`;
}
