// Tags: the colours and signs one can have, and the shape of their names: lower case, the words joined by dashes
// ("full-moon", "like-this-one"). Shared by the client (the editor's tag picker, the tags shown on the site) and
// the server, which keeps names to that shape and checks a tag's colour and sign are these.

/** One strong shade each: the chips take a light wash of it, and it for their sign and writing. */
export const TAG_COLORS = {
  rose: { hex: '#d45d79', ro: 'Trandafir', en: 'Rose' },
  coral: { hex: '#df6f4d', ro: 'Coral', en: 'Coral' },
  amber: { hex: '#c98d1f', ro: 'Chihlimbar', en: 'Amber' },
  olive: { hex: '#83932f', ro: 'Măslin', en: 'Olive' },
  sage: { hex: '#4c9670', ro: 'Salvie', en: 'Sage' },
  teal: { hex: '#1f8e8b', ro: 'Turcoaz', en: 'Teal' },
  sky: { hex: '#3b84cb', ro: 'Cer', en: 'Sky' },
  indigo: { hex: '#5b66d2', ro: 'Indigo', en: 'Indigo' },
  lavender: { hex: '#8761d0', ro: 'Lavandă', en: 'Lavender' },
  plum: { hex: '#a65197', ro: 'Prună', en: 'Plum' },
  sand: { hex: '#a2825a', ro: 'Nisip', en: 'Sand' },
  slate: { hex: '#647589', ro: 'Ardezie', en: 'Slate' },
} as const;

export type TagColor = keyof typeof TAG_COLORS;
export const TAG_COLOR_IDS = Object.keys(TAG_COLORS) as TagColor[];

/** The signs (drawn by the client: client/src/lib/tags.ts). */
export const TAG_ICON_IDS = [
  'moon', 'sun', 'star', 'sparkles', 'orbit', 'telescope',
  'heart', 'hand-heart', 'smile', 'brain', 'eye', 'infinity',
  'flame', 'zap', 'droplet', 'wind', 'cloud', 'snowflake',
  'leaf', 'sprout', 'flower', 'clover', 'tree', 'mountain',
  'waves', 'shell', 'feather', 'bird', 'cat', 'gem',
  'key', 'compass', 'hourglass', 'book', 'pen', 'quote',
  'music', 'palette', 'camera', 'coffee', 'house', 'gift',
  'lightbulb', 'crown', 'bell', 'rainbow',
] as const;

export type TagIcon = (typeof TAG_ICON_IDS)[number];

export const TAG_NAME_MAX = 40;

/**
 * A name as it's being typed: lower case, anything but letters and digits (a space, a comma) turns into one dash, and
 * none leads. One may end it, the next word being on its way.
 */
export function typingTagName(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+/, '')
    .slice(0, TAG_NAME_MAX);
}

/** A tag's name: "Full Moon" -> "full-moon", "#UX / UI" -> "ux-ui". Empty when nothing's left of it. */
export function tagName(raw: string): string {
  return typingTagName(raw).replace(/-+$/, '');
}

/** Its address, as the server makes it (server/src/lib/slug.ts): "café-noir" -> "cafe-noir". Two names with the same
 *  slug are one tag. */
export function tagSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
