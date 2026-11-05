// What the admin API answers (server/src/routes/admin.ts, support.ts, stats.ts).

export interface Overview {
  tickets: { total: number; unseen: number };
  reports: { open: number };
  posts: { published: number; scheduled: number; drafts: number };
  categories: { total: number; top: number };
  users: { total: number; authors: number; week: number; suspended: number; deletedPending: number; deletionDue: number; unverified: number };
  comments: { total: number; week: number };
  /** Comments waiting for approval. */
  held: number;
  newsletter: { subscribers: number };
  invites: { pending: number };
  maintenance: boolean;
  week: { views: number; visitors: number };
  mail: { configured: boolean; production: boolean; sentToday: number; failed24h: number; dailyLimit: number };
}

export interface Suspension {
  since: string;
  until: string | null;
  reason: string | null;
  by?: string | null;
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  username: string | null;
  picture: string | null;
  role: 'member' | 'author' | 'owner';
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
  google: boolean;
  hasPassword: boolean;
  deletedAt: string | null;
  /** From this day it can be deleted for good. */
  purgeOn: string | null;
  /** Deleted: what they chose, and whether it can be deleted for good now. */
  deletion: { comments: 'keep' | 'delete'; posts: 'keep' | 'delete' | null; due: boolean; postsTotal: number } | null;
  suspension: Suspension | null;
  postCount: number;
  commentCount: number;
}

export interface AdminUserDetail extends AdminUser {
  occupation: string | null;
  quote: string | null;
  termsAcceptedAt: string | null;
  likeCount: number;
  reportsMade: number;
  reportsReceived: number;
  sessions: number;
  /** What the account's deletion took away, as they chose (restored with it, or deleted for good with it). */
  deletedWithAccount: { comments: number; posts: number };
}

export type UserStatus = 'all' | 'active' | 'suspended' | 'deleted' | 'due' | 'unverified';

export interface UserList {
  users: AdminUser[];
  hasMore: boolean;
  counts: Record<UserStatus, number>;
}

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'inappropriate' | 'other';

export interface AdminComment {
  id: number;
  body: string;
  isReply: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  post: { id: number; title: string; slug: string };
  author: { id: number; name: string; picture: string | null; role: string; deleted: boolean; suspended: boolean };
  replies: number;
  /** Waiting for approval, and why (a filtered word, a link, or the author's first comment); null: it's public. */
  held: 'words' | 'links' | 'first' | null;
  reports: { reason: ReportReason; details: string | null; createdAt: string; reporter: { id: number; name: string } | null }[];
}

export type CommentFilter = 'all' | 'held' | 'reported' | 'deleted';

export interface CommentList {
  comments: AdminComment[];
  hasMore: boolean;
  counts: Record<CommentFilter, number>;
}

export type PostFilter = 'all' | 'featured' | 'published' | 'scheduled' | 'draft' | 'deleted';

export interface AdminPost {
  id: number;
  slug: string;
  title: string;
  status: Exclude<PostFilter, 'all' | 'featured'>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bannerUrl: string | null;
  category: string | null;
  commentsEnabled: boolean;
  /** Pinned to the top of the home page. */
  featured: boolean;
  author: { id: number; name: string; username: string | null; picture: string | null; deleted: boolean };
  views: number;
  likes: number;
  comments: number;
}

export interface PostList {
  posts: AdminPost[];
  hasMore: boolean;
  counts: Record<PostFilter, number>;
}

export interface TicketSummary {
  id: number;
  name: string | null;
  email: string;
  category: string;
  title: string;
  preview: string;
  createdAt: string;
  seen: boolean;
  files: number;
}

export interface Ticket {
  id: number;
  name: string | null;
  email: string;
  category: string;
  title: string;
  body: string;
  createdAt: string;
  user: { id: number; name: string; role: string } | null;
  /** The account with the sender's address (also when it's deleted or suspended and they wrote signed out). */
  account: { id: number; name: string; role: string; deletedAt: string | null; purgeOn: string | null; suspended: boolean } | null;
  files: { id: number; name: string; mime: string; size: number }[];
}

export interface Totals {
  pageViews: number;
  postViews: number;
  visitors: number;
  avgSeconds: number;
  /** Visits to articles read to the end, in % (0–100). */
  readThrough: number;
  likes: number;
  comments: number;
  replies: number;
  shares: number;
  saves: number;
  secondsToLike: number | null;
  secondsToComment: number | null;
}

export interface Stats {
  days: 7 | 30 | 90;
  from: string;
  to: string;
  mine: boolean;
  author: { id: number; name: string } | null;
  authors: { id: number; name: string; posts: number }[] | null;
  totals: Totals;
  previous: Totals;
  daily: { day: string; views: number; visitors: number }[];
  posts: {
    id: number;
    title: string;
    slug: string;
    views: number;
    visitors: number;
    avgSeconds: number;
    readThrough: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }[];
  actions: { action: string; times: number; visitors: number }[];
  referrers: { host: string | null; views: number }[];
  devices: { device: string; views: number }[];
  pages: { path: string; views: number; visitors: number }[];
  community: {
    accounts: number;
    writers: number;
    newAccounts: number;
    pushReaders: number;
    pushWriters: number;
    reactions: number;
    likesTakenBack: number;
    commentsDeleted: number;
    commentEdits: number;
  } | null;
}

export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface MailSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  fromEmail: string;
  fromName: string;
  /** The SMTP server's limit a day (0: not set). */
  dailyLimit: number;
  hasPassword: boolean;
}

export type Tone = 'info' | 'success' | 'warning';

export interface SiteSettings {
  commentsRequireVerifiedEmail: boolean;
  /** A new account's first comment waits for an administrator. */
  firstCommentApproval: boolean;
  blockedWords: string[];
  blockedWordsAction: 'hold' | 'block';
  links: 'allow' | 'hold' | 'block';
  announcement: { enabled: boolean; text: string; linkUrl: string; linkLabel: string; tone: Tone };
  newsletterEnabled: boolean;
  maintenance: boolean;
  maintenanceMessage: string;
}

export const SOCIAL = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'pinterest', 'linkedin'] as const;
export type Social = (typeof SOCIAL)[number];

export interface SiteIdentity {
  name: string;
  company: string;
  description: string;
  language: string;
  locale: string;
  timeZone: string;
  defaultLanguage: 'ro' | 'en';
  contactEmail: string;
  social: Record<Social, string>;
}

export interface Subscriber {
  id: number;
  email: string;
  frequency: 'instant' | 'weekly';
  lang: string;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  /** The account with that address, by name. */
  account: string | null;
  /** Emails it got (posts and digests). */
  received: number;
}

export interface Invite {
  id: number;
  email: string;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
  accepted: { id: number; name: string } | null;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

export interface MediaItem {
  name: string;
  url: string;
  size: number;
  modifiedAt: string;
  posts: { id: number; title: string; slug: string; deleted: boolean }[];
  inVersions: boolean;
  /** Uploaded in the last day: maybe in an editor not saved yet, so not "unused" yet. */
  recent: boolean;
}

export interface AdminTag {
  id: number;
  name: string;
  slug: string;
  posts: number;
}

export interface EmailLog {
  emails: { id: number; createdAt: string; to: string; kind: string; subject: string; status: 'sent' | 'failed' | 'logged'; error: string | null }[];
  hasMore: boolean;
  usage: { sentToday: number; failedToday: number; failed24h: number; dailyLimit: number };
  counts: Record<'all' | 'sent' | 'failed' | 'logged', number>;
}

export interface LogEntry {
  id: number;
  createdAt: string;
  admin: { id: number | null; name: string; picture: string | null };
  action: string;
  target: { type: string; id: number | null; label: string };
  details: Record<string, unknown> | null;
}

export interface LogPage {
  entries: LogEntry[];
  hasMore: boolean;
}
