import type { CoverDesign } from '@/lib/covers';
/** Members comment and react; authors also write (and edit their own) posts; owners manage everything. */
export type Role = 'member' | 'author' | 'owner';

export interface User {
  id: number;
  email: string;
  name: string;
  /** In their public pages' addresses: /{username}/jurnal, /{username}/carti, /{username}/salvate. */
  username: string;
  /** The uploaded profile picture, else the Google one. */
  picture: string | null;
  /** Whether `picture` was uploaded (and can be removed). */
  hasAvatar: boolean;
  role: Role;
  nameConfirmed: boolean;
  /** Agreed to the Terms and Conditions (when signing up, or at the first sign-in with Google). */
  termsAccepted: boolean;
  /** Shown instead of "Author" on their posts. */
  occupation: string | null;
  /** Shown under their name at the end of their posts. */
  quote: string | null;
  /** Anyone may see their articles / their saved ones (Settings). */
  publicArticles: boolean;
  publicBooks: boolean;
  publicSaved: boolean;
  /** Signs in with Google too; its address is always the account's email. */
  google: boolean;
  /** Has a password (accounts made with Google don't, until they set one). */
  hasPassword: boolean;
  /** The address was confirmed (the link emailed to it, a new password through it, or Google). */
  emailVerified: boolean;
  /** A new address waiting for its confirmation link; the email stays the old one until then. */
  pendingEmail: string | null;
}

export interface Author {
  id: number;
  name: string;
  username: string;
  picture: string | null;
}

export interface PostAuthor extends Author {
  occupation: string | null;
  quote: string | null;
}

export type PostStatus = 'draft' | 'scheduled' | 'published';

/** A post (the journal's articles), or a chapter of a book (`book`): one shape, read at different addresses. */
export interface PostSummary {
  id: number;
  slug: string;
  /** Where it's read: /posts/{slug}, or a chapter under its book, /carti/{book}/{slug}. */
  path: string;
  title: string;
  excerpt: string;
  bannerUrl: string | null;
  /** Who made the banner and its licence, when it came from an image library (shown under it), and its page. */
  bannerCredit: { text: string; url: string | null } | null;
  status: PostStatus;
  publishedAt: string | null;
  updatedAt: string;
  /** Soft-deleted: only owners ever receive these. */
  deleted: boolean;
  /** Picked by an administrator for the top of the home page. */
  featured: boolean;
  readingMinutes: number;
  likeCount: number;
  /** Views: each visitor counts once a day. */
  viewCount: number;
  commentsEnabled: boolean;
  /** 0 while comments are off. */
  commentCount: number;
  /** The image link previews show: the banner with the title over it (1200 x 630). */
  shareImage: string;
  /** A post's category (a chapter has none: its book has one). */
  category: { id: number; name: string; slug: string; icon: string | null } | null;
  /** A chapter: its book, and which chapter it is (a post has none). */
  book: { id: number; title: string; slug: string; chapter: number } | null;
  author: Author;
}

/** A tag: its name (lower case, words joined by dashes), its address, maybe a colour and a sign (lib/tags.ts). */
export interface Tag {
  name: string;
  slug: string;
  color?: string | null;
  icon?: string | null;
}

/** The public post page. */
export interface Post extends Omit<PostSummary, 'book'> {
  contentHtml: string;
  author: PostAuthor & { followers: number };
  /** A chapter: its book and the contents this reader can see. */
  book: (Book & { contents: Chapter[] }) | null;
  tags: Tag[];
}

// ---------- Books (lib/books.ts) ----------

export interface Book {
  id: number;
  slug: string;
  title: string;
  description: string;
  cover: CoverDesign;
  /** Chapters the author plans (null: not said). */
  planned: number | null;
  /** On the site; unpublished, only its author and administrators see it (and its chapters). */
  published: boolean;
  /** Finished (else still being written). */
  complete: boolean;
  /** Chapters on the site; all of them, drafts too, for whoever may edit it. */
  chapters: number;
  allChapters: number;
  minutes: number;
  lastChapterAt: string | null;
  /** The next scheduled chapter's date. */
  nextChapterAt: string | null;
  /** Where reading starts (its slug). */
  firstChapter: string | null;
  updatedAt: string;
  subject: { id: number; name: string; slug: string; icon: string | null } | null;
  author: Author;
}

export type ChapterState = 'published' | 'scheduled' | 'draft';

export interface Chapter {
  id: number;
  /** Null: not open yet (scheduled: its title and date show what's coming). */
  slug: string | null;
  no: number;
  title: string;
  excerpt: string;
  minutes: number;
  publishedAt: string | null;
  state: ChapterState;
}

/** A reader's place in a book: its chapters (read or not), the one to read now and how far into it. */
export interface Journey {
  book: Book;
  chapters: (Chapter & { done: boolean; current: boolean })[];
  current: (Chapter & { progress: number; minutesLeft: number }) | null;
  read: number;
  /** Null for a book not started yet (the home page's suggestions). */
  lastReadAt: string | null;
}

export interface StreakDay {
  day: string;
  read: boolean;
  today: boolean;
  future: boolean;
}

export interface ReadingSummary {
  current: { book: Book; chapter: Chapter & { progress: number; minutesLeft: number }; read: number } | null;
  journeys: Journey[];
  streak: { days: number; readToday: boolean; week: StreakDay[] };
}

/** A top-level category with what it holds. */
export interface Subject {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  books: number;
  articles: number;
  cover: { cover: CoverDesign; title: string; subject: string } | null;
}

export interface Thought {
  text: string;
  post: { id: number; slug: string; title: string };
  book: { slug: string; title: string; chapter: number } | null;
}

/** A post as the editor loads it. */
export interface EditablePost extends PostSummary {
  contentHtml: string;
  /** Comments that exist even while they're turned off (for the "they'll be hidden" warning). */
  existingComments: number;
  /** For search engines and link previews instead of the title and summary (empty: those). */
  seoTitle: string;
  seoDescription: string;
  /** The link previews' image instead of the one made from the banner. */
  socialImageUrl: string | null;
  tags: string[];
  /** The secret preview link's token (/previzualizare/{token}), if one was made. */
  previewToken: string | null;
}

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  postCount: number;
}

export interface CategoryLimits {
  maxDepth: number;
  maxChildren: number;
}

export interface Comment {
  id: number;
  parentId: number | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Deleted comments only reach owners, who see them greyed out. */
  deletedAt: string | null;
  /** Who deleted it (owners only). */
  deletedBy: string | null;
  /** Waits for an administrator's approval (the comment filters): only its writer sees it. */
  held?: boolean;
  /** `deleted`: the account was deleted (no name or picture then). */
  author: Pick<Author, 'id' | 'name' | 'picture'> & { deleted?: boolean };
  /** Reaction counts by emoji, in the order they were first used. */
  reactions: Record<string, number>;
  /** The emojis the viewer added. */
  mine: string[];
  /** How many replies it has (direct ones, as the viewer sees them); only the first few come with it. */
  replyCount: number;
}

/** Reactions available on comments (the server accepts only these). */
export const COMMENT_EMOJI = ['❤️', '✨', '🌙', '🔥', '😂', '🙏'] as const;

/** A row of the owners' Users page. */
export interface AdminUser {
  id: number;
  name: string;
  email: string;
  picture: string | null;
  role: Role;
  createdAt: string;
  postCount: number;
}
