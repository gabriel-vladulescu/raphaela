// Book covers aren't images: a design, drawn with the book's title and subject on it (components/BookCover.tsx). A
// design is an arrangement (where the title, subject and author sit), an ornament (line art) and colours (a palette,
// or the writer's own). Templates are named designs: built-in ones here, and the ones writers save (shared, in the
// database). The server checks a design against these ids (server/src/lib/books.ts).

export const LAYOUTS = {
  clasic: { ro: 'Clasic', en: 'Classic' },
  centrat: { ro: 'Centrat', en: 'Centred' },
  banda: { ro: 'Bandă', en: 'Band' },
  arc: { ro: 'Arcadă', en: 'Arch' },
  rasarit: { ro: 'Răsărit', en: 'Sunrise' },
  eticheta: { ro: 'Etichetă', en: 'Label' },
  tipografic: { ro: 'Tipografic', en: 'Type' },
  medalion: { ro: 'Medalion', en: 'Medallion' },
} as const;

export type LayoutId = keyof typeof LAYOUTS;

// The ornaments (line art): a library shared with the server, at the project's root.
export { ORNAMENT_GROUPS, ORNAMENT_IDS, ORNAMENT_PICKS, ORNAMENTS } from '../../../ornaments';
export type { Ornament, OrnamentGroup, OrnamentId } from '../../../ornaments';
import type { OrnamentId } from '../../../ornaments';

export interface Colors {
  /** The top's light, the bottom, the writing. */
  c1: string;
  c2: string;
  ink: string;
}

// The palettes: shared with the server, at the project's root. Looked up by any id here (one stored with a book).
import { PALETTES as SHARED_PALETTES } from '../../../palettes';
import type { Palette } from '../../../palettes';
export { PALETTE_IDS } from '../../../palettes';
export type { Palette, PaletteId } from '../../../palettes';
export const PALETTES: Record<string, Palette> = SHARED_PALETTES;

export interface CoverDesign {
  /** The template it started from: a built-in one's id, or "sablon-{id}" for a saved one. */
  template?: string;
  layout: LayoutId;
  ornament: OrnamentId;
  palette: string;
  /** The writer's own colours instead of the palette's. */
  colors?: Colors;
}

export interface CoverTemplate {
  id: string;
  name: string;
  design: CoverDesign;
  /** A saved one (the database): who made it, and whether this writer may delete it. */
  saved?: { id: number; creator: string | null; canDelete: boolean };
}

/** The built-in templates: one design, for any book. */
export const TEMPLATES: CoverTemplate[] = [
  { id: 'spirala', name: 'Spirala', design: { layout: 'clasic', ornament: 'spiral', palette: 'adanc' } },
  { id: 'lotus', name: 'Lotus', design: { layout: 'clasic', ornament: 'lotus', palette: 'pergament' } },
  { id: 'roata', name: 'Roata', design: { layout: 'clasic', ornament: 'wheel', palette: 'noapte' } },
  { id: 'faze', name: 'Faze', design: { layout: 'clasic', ornament: 'moons', palette: 'ardezie' } },
  { id: 'semiluna', name: 'Semilună', design: { layout: 'clasic', ornament: 'halfmoon', palette: 'teracota' } },
  { id: 'lumanare', name: 'Lumânare', design: { layout: 'clasic', ornament: 'candle', palette: 'ceata' } },
  { id: 'constelatie', name: 'Constelație', design: { layout: 'centrat', ornament: 'stars', palette: 'carbune' } },
  { id: 'mandala', name: 'Mandala', design: { layout: 'arc', ornament: 'mandala', palette: 'lavanda' } },
  { id: 'valuri', name: 'Valuri', design: { layout: 'banda', ornament: 'waves', palette: 'smarald' } },
  { id: 'arbore', name: 'Arborele', design: { layout: 'arc', ornament: 'tree', palette: 'salvie' } },
];

export const DEFAULT_COVER: CoverDesign = { template: 'lotus', ...TEMPLATES[1]!.design };

/** The ornament takes the writing's colour, see-through. */
export function ornamentColor(ink: string) {
  const n = parseInt(ink.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / 0.4)`;
}

/** A design's four colours: its own, else its palette's. */
export function colorsOf(design: CoverDesign): Colors & { orn: string } {
  if (design.colors) return { ...design.colors, orn: ornamentColor(design.colors.ink) };
  const palette = PALETTES[design.palette] ?? PALETTES.pergament!;
  return { c1: palette.c1, c2: palette.c2, ink: palette.ink, orn: palette.orn };
}
