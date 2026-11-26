// The writer's own pages (theirs alone; no username in them: the API has their articles at
// /api/u/{username}/articole): their journal, a new article, one to edit.
export const articlesPath = () => '/jurnalul-meu';
export const newArticlePath = () => '/jurnalul-meu/nou';
export const articlePath = (id: number) => `/jurnalul-meu/${id}`;
/** Where a post is read, or a chapter (under its book): the server's `path`, else from its slug (and its book's). */
export const postPath = (post: { slug: string; path?: string; book?: { slug: string } | null }) =>
  post.path ?? (post.book ? `/carti/${post.book.slug}/${post.slug}` : `/posts/${post.slug}`);
/** One's own saved posts (a guest's, kept in the browser). */
export const savedPath = () => '/salvate';
/** A person's public lists (each public by their choice: Settings): their journal, their books, their saved posts. */
export type PersonList = 'jurnal' | 'carti' | 'salvate';
export const personListPath = (username: string, list: PersonList) => `/${username}/${list}`;
