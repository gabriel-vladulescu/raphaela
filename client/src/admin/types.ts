// What the admin API answers (server/src/routes/admin.ts, support.ts, stats.ts).

/** One of an account's sign-ins (the account's panel): still on, ran out, or ended (and why). */
export interface Login {
  startedAt: string;
  /** The browser ("Chrome · Windows"). */
  device: string | null;
  expiresAt: string;
  endedAt: string | null;
  /** server/src/lib/sessionEnd.ts, SessionEnd. */
  endReason: string | null;
}

/** A sign-in attempt (the account's panel, Logs → Sign-ins): how, how it went, the browser. */
export interface SignInAttempt {
  at: string;
  email: string | null;
  method: 'password' | 'google' | 'signup' | 'reset' | 'invite';
  outcome: 'ok' | 'wrong_password' | 'unknown_email' | 'google_only' | 'suspended' | 'deleted' | 'failed';
  device: string | null;
}

/** A device with push on an account. */
export interface PushDevice {
  id: number;
  device: string | null;
  since: string;
  lastSentAt: string | null;
  /** The account's notifications go there. */
  activity: boolean;
  /** Books whose new chapters it waits for. */
  books: number;
}

/** An earlier address, name or username of an account (the account's panel). */
export interface AccountChange {
  field: 'email' | 'name' | 'username';
  from: string | null;
  to: string | null;
  via: 'profile' | 'email_link' | 'google' | 'admin';
  at: string;
}

/** A link sent to an account by email, and what became of it (the account's panel). */
/** A new address waiting for its link to be opened (the address changes then). */
export interface PendingEmail {
  email: string;
  sentAt: string;
  expiresAt: string;
}

export interface EmailLink {
  purpose: 'verify' | 'reset' | 'change';
  email: string;
  sentAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  /** Why it stopped before being used (server/src/lib/accounts.ts, LinkEnd). */
  revokedReason: string | null;
}

export interface Overview {
  /** Rows past the time the Terms promise to keep them, waiting for an administrator to delete them. */
  cleanup: number;
  tickets: { total: number; unseen: number; open: number };
  /** The server's errors: not looked at yet, and in the last 24 hours. */
  errors: { unseen: number; day: number };
  signIns: { failedDay: number };
  pushes: { day: number };
  books: { total: number; public: number };
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
  mail: { configured: boolean; sentToday: number; failed24h: number; dailyLimit: number };
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
  followers: number;
  following: number;
  /** Failed sign-in attempts in the last 24 hours. */
  failedSignIns: number;
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
  /** Where it's read (a chapter: under its book). */
  path: string;
  /** A chapter: its book and its number there. */
  book: { id: number; title: string; slug: string; chapter: number } | null;
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
  status: TicketStatus;
  replies: number;
  /** Sent signed in: the answers reach their account too. */
  account: boolean;
  updatedAt: string;
}

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface TicketReply {
  id: number;
  /** An administrator's (else the sender's). */
  staff: boolean;
  author: { id: number | null; name: string; picture: string | null };
  body: string;
  createdAt: string;
  emailed: boolean;
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
  status: TicketStatus;
  replies: TicketReply[];
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
  /** Every new post (else only the chapters of `books`). */
  allPosts: boolean;
  /** The books it follows, their titles joined (" · "), or null. */
  books: string | null;
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
  color: string | null;
  icon: string | null;
  posts: number;
}

export interface EmailLog {
  emails: { id: number; createdAt: string; to: string; kind: string; subject: string; status: 'sent' | 'failed'; error: string | null }[];
  hasMore: boolean;
  usage: { sentToday: number; failedToday: number; failed24h: number; dailyLimit: number };
  counts: Record<'all' | 'sent' | 'failed', number>;
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

/** A book, as the admin panel lists it (server/src/routes/adminContent.ts). */
export interface AdminBook {
  id: number;
  slug: string;
  title: string;
  description: string;
  cover: unknown;
  planned: number | null;
  complete: boolean;
  published: boolean;
  chapters: number;
  allChapters: number;
  drafts: number;
  scheduled: number;
  lastChapterAt: string | null;
  nextChapterAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  subject: { id: number; name: string; slug: string } | null;
  author: { id: number; name: string; username: string; picture: string | null };
  views: number;
  likes: number;
  comments: number;
  readers: number;
  followers: { email: number; devices: number };
}

export type BookFilter = 'all' | 'public' | 'hidden' | 'ongoing' | 'complete' | 'deleted';

export interface BookList {
  books: AdminBook[];
  hasMore: boolean;
  counts: Record<BookFilter, number>;
}

/** The server's errors (Logs → Errors). */
export interface ErrorEntry {
  id: number;
  createdAt: string;
  lastAt: string;
  times: number;
  source: string;
  context: string;
  message: string;
  detail: string | null;
  user: { id: number; name: string } | null;
  seen: boolean;
}

export interface ErrorPage {
  errors: ErrorEntry[];
  hasMore: boolean;
  counts: { all: number; unseen: number; day: number };
  sources: { source: string; count: number }[];
}

/** A push sent (Logs → Push). */
export interface PushEntry {
  id: number;
  createdAt: string;
  kind: string;
  title: string;
  url: string | null;
  user: { id: number; name: string } | null;
  devices: number;
  sent: number;
  failed: number;
  gone: number;
  error: string | null;
}

export interface PushPage {
  pushes: PushEntry[];
  hasMore: boolean;
  devices: { total: number; guests: number; accounts: number; newPosts: number; activity: number; bookDevices: number; bookFollows: number };
  day: { pushes: number; sent: number; failed: number; gone: number };
  kinds: { kind: string; count: number }[];
}

export interface AuthEntry {
  id: number;
  createdAt: string;
  email: string | null;
  method: SignInAttempt['method'];
  outcome: SignInAttempt['outcome'];
  device: string | null;
  user: { id: number; name: string; picture: string | null } | null;
}

export interface AuthPage {
  attempts: AuthEntry[];
  hasMore: boolean;
  counts: { all: number; ok: number; failed: number };
  failedDay: number;
}

/** A comment's earlier version (Logs → Comment edits). */
export interface EditEntry {
  id: number;
  commentId: number;
  before: string;
  now: string;
  replacedAt: string;
  deleted: boolean;
  author: { id: number; name: string; picture: string | null };
  post: { title: string; path: string };
}

export interface EditPage {
  edits: EditEntry[];
  hasMore: boolean;
}

/** What a kind of log holds (Logs → Clean up). */
export interface HistoryKind {
  key: 'adminLog' | 'authLog' | 'sessions' | 'emailLog' | 'emailLinks' | 'pushLog' | 'errorLog' | 'commentEdits';
  /** In the period chosen. */
  count: number;
  total: number;
  oldest: string | null;
}
