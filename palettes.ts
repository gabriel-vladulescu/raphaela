// The books' covers' palettes: the top's light (c1), the bottom (c2), the writing (ink), the ornament (orn, see-
// through) and a strong shade of them (strong: a book's colour elsewhere, e.g. its reader's journey). Shared by the
// client (client/src/lib/covers.ts) and the server, which checks that a cover's palette is one of them
// (server/src/lib/books.ts).

export interface Palette {
  ro: string;
  en: string;
  c1: string;
  c2: string;
  ink: string;
  orn: string;
  strong: string;
}

export const PALETTES = {
  noapte: { ro: 'Indigo și aur', en: 'Indigo and gold', c1: '#2a1c70', c2: '#0a1034', ink: '#f2c46d', orn: 'rgb(242 196 109 / 0.42)', strong: '#4b3cb0' },
  adanc: { ro: 'Ape adânci', en: 'Deep water', c1: '#14525c', c2: '#071f26', ink: '#f2d7a6', orn: 'rgb(226 165 92 / 0.5)', strong: '#1f6a6f' },
  pergament: { ro: 'Pergament', en: 'Parchment', c1: '#f2e8d8', c2: '#d8c4a4', ink: '#3a2817', orn: 'rgb(150 98 52 / 0.38)', strong: '#9a6a3a' },
  ardezie: { ro: 'Ardezie', en: 'Slate', c1: '#40567e', c2: '#18203a', ink: '#eef1ff', orn: 'rgb(220 228 255 / 0.4)', strong: '#3f5b8c' },
  teracota: { ro: 'Teracotă', en: 'Terracotta', c1: '#9a4a2c', c2: '#3a160d', ink: '#f8e6d2', orn: 'rgb(255 214 170 / 0.4)', strong: '#a4502a' },
  ceata: { ro: 'Ceață', en: 'Mist', c1: '#eef2f2', c2: '#c3d3d6', ink: '#173a42', orn: 'rgb(23 58 66 / 0.3)', strong: '#2f6470' },
  salvie: { ro: 'Salvie', en: 'Sage', c1: '#a7bdaf', c2: '#4f6b5d', ink: '#f6f2e8', orn: 'rgb(246 242 232 / 0.42)', strong: '#557a6f' },
  lavanda: { ro: 'Lavandă', en: 'Lavender', c1: '#ece5fb', c2: '#b7a6e6', ink: '#2e2350', orn: 'rgb(46 35 80 / 0.32)', strong: '#6d5bd0' },
  trandafir: { ro: 'Trandafir', en: 'Rose', c1: '#f8e1da', c2: '#d99b8c', ink: '#4a1f1a', orn: 'rgb(74 31 26 / 0.3)', strong: '#b25a4c' },
  carbune: { ro: 'Cărbune', en: 'Charcoal', c1: '#3c3c43', c2: '#141417', ink: '#eadcc4', orn: 'rgb(234 220 196 / 0.35)', strong: '#5b5b66' },
  smarald: { ro: 'Smarald', en: 'Emerald', c1: '#1f6b57', c2: '#0b2e25', ink: '#f3e2b8', orn: 'rgb(243 226 184 / 0.42)', strong: '#24785f' },
  nisip: { ro: 'Nisip', en: 'Sand', c1: '#f1dcb4', c2: '#c99d5f', ink: '#2f2213', orn: 'rgb(47 34 19 / 0.3)', strong: '#a8782f' },

  // Twelve more: dark ones with warm or silver writing, and light ones with dark writing.
  bordo: { ro: 'Vin de Bordeaux', en: 'Bordeaux', c1: '#6e1f33', c2: '#2a0912', ink: '#f3d9b1', orn: 'rgb(243 217 177 / 0.4)', strong: '#8a2a43' },
  'miez-noptii': { ro: 'Miez de noapte', en: 'Midnight', c1: '#1c2a4a', c2: '#070b18', ink: '#d9e2f2', orn: 'rgb(200 214 240 / 0.38)', strong: '#3a4f7a' },
  aurora: { ro: 'Auroră', en: 'Aurora', c1: '#2e7d7a', c2: '#2b1d5c', ink: '#e8f6ef', orn: 'rgb(190 240 220 / 0.4)', strong: '#2e7d7a' },
  chihlimbar: { ro: 'Chihlimbar', en: 'Amber', c1: '#c9801f', c2: '#5a2c08', ink: '#fff1d6', orn: 'rgb(255 236 200 / 0.42)', strong: '#b06d14' },
  prun: { ro: 'Prună', en: 'Plum', c1: '#5a2a5e', c2: '#1f0c24', ink: '#f1d7ef', orn: 'rgb(241 200 236 / 0.38)', strong: '#7a3a80' },
  masline: { ro: 'Măsline', en: 'Olive', c1: '#6b6d2e', c2: '#262710', ink: '#f1ecc8', orn: 'rgb(241 236 200 / 0.4)', strong: '#6b6d2e' },
  ocean: { ro: 'Ocean', en: 'Ocean', c1: '#1f5f8b', c2: '#0a2238', ink: '#e6f3ff', orn: 'rgb(200 228 255 / 0.4)', strong: '#1f5f8b' },
  ametist: { ro: 'Ametist', en: 'Amethyst', c1: '#8a63c9', c2: '#3b2270', ink: '#f5edff', orn: 'rgb(245 237 255 / 0.4)', strong: '#7a52bf' },
  piersica: { ro: 'Piersică', en: 'Peach', c1: '#fde3d0', c2: '#f0a982', ink: '#4a2414', orn: 'rgb(74 36 20 / 0.3)', strong: '#c8694a' },
  menta: { ro: 'Mentă', en: 'Mint', c1: '#e3f4ec', c2: '#a9d6c1', ink: '#123c30', orn: 'rgb(18 60 48 / 0.3)', strong: '#2f7a5e' },
  senin: { ro: 'Cer senin', en: 'Clear sky', c1: '#e4eefc', c2: '#a9c4ee', ink: '#1b2f55', orn: 'rgb(27 47 85 / 0.3)', strong: '#3d63a8' },
  zapada: { ro: 'Zăpadă', en: 'Snow', c1: '#fbfbfd', c2: '#dfe2ea', ink: '#2b2f3a', orn: 'rgb(43 47 58 / 0.28)', strong: '#5b6275' },
} as const satisfies Record<string, Palette>;

export type PaletteId = keyof typeof PALETTES;

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
