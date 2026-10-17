/** Members comment and react; authors also write (and edit their own) posts; owners manage everything. */
export type Role = 'member' | 'author' | 'owner';

export interface User {
  id: number;
  email: string;
  name: string;
  /** In their addresses: /{username}/articole, /{username}/articole-salvate. */
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
  publicSaved: boolean;
  /** Signs in with Google too; its address is always the account's email. */
  google: boolean;
  /** Has a password (accounts made with Google don't, until they set one). */
  hasPassword: boolean;
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

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  bannerUrl: string | null;
  status: PostStatus;
  publishedAt: string | null;
  updatedAt: string;
  /** Soft-deleted: only owners ever receive these. */
  deleted: boolean;
  readingMinutes: number;
  likeCount: number;
  /** Views: each visitor counts once a day. */
  viewCount: number;
  commentsEnabled: boolean;
  /** 0 while comments are off. */
  commentCount: number;
  /** The image link previews show: the banner with the title over it (1200 x 630). */
  shareImage: string;
  category: { id: number; name: string; slug: string; icon: string | null } | null;
  /** The series it belongs to, and its part in it. */
  series: { id: number; title: string; slug: string; part: number } | null;
  author: Author;
}

/** A series' parts the viewer can see, in order. */
export interface SeriesPart {
  id: number;
  title: string;
  slug: string;
  part: number;
}

/** The public post page. */
export interface Post extends PostSummary {
  contentHtml: string;
  author: PostAuthor;
  series: (NonNullable<PostSummary['series']> & { parts: SeriesPart[] }) | null;
}

/** A post as the editor loads it. */
export interface EditablePost extends PostSummary {
  contentHtml: string;
  /** Comments that exist even while they're turned off (for the "they'll be hidden" warning). */
  existingComments: number;
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
  author: Author;
  /** Reaction counts by emoji, in the order they were first used. */
  reactions: Record<string, number>;
  /** The emojis the viewer added. */
  mine: string[];
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
