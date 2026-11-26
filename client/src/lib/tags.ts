import type { CSSProperties } from 'react';
import {
  Bell,
  Bird,
  BookOpen,
  Brain,
  Camera,
  Cat,
  Cloud,
  Clover,
  Coffee,
  Compass,
  Crown,
  Droplet,
  Eye,
  Feather,
  Flame,
  Flower2,
  Gem,
  Gift,
  HandHeart,
  Heart,
  Hourglass,
  House,
  Infinity as InfinityIcon,
  Key,
  Leaf,
  Lightbulb,
  Moon,
  Mountain,
  Music,
  Orbit,
  Palette,
  PenLine,
  Quote,
  Rainbow,
  Shell,
  Smile,
  Snowflake,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Telescope,
  TreePine,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TAG_COLORS } from '../../../tagStyles';
import type { TagColor, TagIcon } from '../../../tagStyles';

export { TAG_COLOR_IDS, TAG_COLORS, TAG_ICON_IDS, TAG_NAME_MAX, tagName, tagSlug, typingTagName } from '../../../tagStyles';
export type { TagColor, TagIcon } from '../../../tagStyles';

/** Each sign: its drawing, and its name (for those who can't see it, and as its tooltip). */
export const TAG_ICONS: Record<TagIcon, { icon: LucideIcon; ro: string; en: string }> = {
  moon: { icon: Moon, ro: 'Lună', en: 'Moon' },
  sun: { icon: Sun, ro: 'Soare', en: 'Sun' },
  star: { icon: Star, ro: 'Stea', en: 'Star' },
  sparkles: { icon: Sparkles, ro: 'Scântei', en: 'Sparkles' },
  orbit: { icon: Orbit, ro: 'Orbită', en: 'Orbit' },
  telescope: { icon: Telescope, ro: 'Telescop', en: 'Telescope' },
  heart: { icon: Heart, ro: 'Inimă', en: 'Heart' },
  'hand-heart': { icon: HandHeart, ro: 'Grijă', en: 'Care' },
  smile: { icon: Smile, ro: 'Zâmbet', en: 'Smile' },
  brain: { icon: Brain, ro: 'Minte', en: 'Mind' },
  eye: { icon: Eye, ro: 'Ochi', en: 'Eye' },
  infinity: { icon: InfinityIcon, ro: 'Infinit', en: 'Infinity' },
  flame: { icon: Flame, ro: 'Flacără', en: 'Flame' },
  zap: { icon: Zap, ro: 'Fulger', en: 'Lightning' },
  droplet: { icon: Droplet, ro: 'Picătură', en: 'Drop' },
  wind: { icon: Wind, ro: 'Vânt', en: 'Wind' },
  cloud: { icon: Cloud, ro: 'Nor', en: 'Cloud' },
  snowflake: { icon: Snowflake, ro: 'Fulg', en: 'Snowflake' },
  leaf: { icon: Leaf, ro: 'Frunză', en: 'Leaf' },
  sprout: { icon: Sprout, ro: 'Lăstar', en: 'Sprout' },
  flower: { icon: Flower2, ro: 'Floare', en: 'Flower' },
  clover: { icon: Clover, ro: 'Trifoi', en: 'Clover' },
  tree: { icon: TreePine, ro: 'Brad', en: 'Tree' },
  mountain: { icon: Mountain, ro: 'Munte', en: 'Mountain' },
  waves: { icon: Waves, ro: 'Valuri', en: 'Waves' },
  shell: { icon: Shell, ro: 'Scoică', en: 'Shell' },
  feather: { icon: Feather, ro: 'Pană', en: 'Feather' },
  bird: { icon: Bird, ro: 'Pasăre', en: 'Bird' },
  cat: { icon: Cat, ro: 'Pisică', en: 'Cat' },
  gem: { icon: Gem, ro: 'Cristal', en: 'Gem' },
  key: { icon: Key, ro: 'Cheie', en: 'Key' },
  compass: { icon: Compass, ro: 'Busolă', en: 'Compass' },
  hourglass: { icon: Hourglass, ro: 'Clepsidră', en: 'Hourglass' },
  book: { icon: BookOpen, ro: 'Carte', en: 'Book' },
  pen: { icon: PenLine, ro: 'Condei', en: 'Pen' },
  quote: { icon: Quote, ro: 'Citat', en: 'Quote' },
  music: { icon: Music, ro: 'Muzică', en: 'Music' },
  palette: { icon: Palette, ro: 'Paletă', en: 'Palette' },
  camera: { icon: Camera, ro: 'Aparat foto', en: 'Camera' },
  coffee: { icon: Coffee, ro: 'Cafea', en: 'Coffee' },
  house: { icon: House, ro: 'Casă', en: 'Home' },
  gift: { icon: Gift, ro: 'Dar', en: 'Gift' },
  lightbulb: { icon: Lightbulb, ro: 'Idee', en: 'Idea' },
  crown: { icon: Crown, ro: 'Coroană', en: 'Crown' },
  bell: { icon: Bell, ro: 'Clopoțel', en: 'Bell' },
  rainbow: { icon: Rainbow, ro: 'Curcubeu', en: 'Rainbow' },
};

/** A tag's colour, for its chip (`--tag`); none: the chip keeps the site's own. */
export function tagStyle(color: string | null | undefined): CSSProperties | undefined {
  const known = color ? TAG_COLORS[color as TagColor] : undefined;
  return known ? ({ '--tag': known.hex } as CSSProperties) : undefined;
}

/** A tag's sign, if it has one of those there are. */
export const tagIcon = (icon: string | null | undefined): LucideIcon | null => (icon && TAG_ICONS[icon as TagIcon]?.icon) || null;
