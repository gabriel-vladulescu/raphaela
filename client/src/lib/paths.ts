// A person's pages (the API mirrors them under /api/u/{username}/...).
export const articlesPath = (username: string) => `/${username}/articole`;
export const newArticlePath = (username: string) => `/${username}/articole/nou`;
export const articlePath = (username: string, id: number) => `/${username}/articole/${id}`;
/** A person's saved posts; without a username, the browser's own (guests). */
export const savedPath = (username?: string | null) => (username ? `/${username}/articole-salvate` : '/articole-salvate');
