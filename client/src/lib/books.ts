// The books' addresses: a book, and its chapters under it (a post is read at /posts/{slug}: lib/paths.ts).
export const bookPath = (slug: string) => `/carti/${slug}`;
export const chapterPath = (bookSlug: string, slug: string) => `/carti/${bookSlug}/${slug}`;
export const subjectPath = (slug: string) => `/subiecte/${slug}`;
export const journalPath = (category?: string) => (category ? `/jurnal?category=${encodeURIComponent(category)}` : '/jurnal');

// The writer's own books (theirs alone, as their journal: the API has them under /api/u/{username}/carti): the
// list, a new book, one to edit, and its chapters in the editor (a new one, one to edit).
export const myBooksPath = () => '/cartile-mele';
export const newBookPath = () => '/cartile-mele/nou';
export const bookEditorPath = (id: number) => `/cartile-mele/${id}`;
export const newChapterPath = (bookId: number) => `/cartile-mele/${bookId}/capitole/nou`;
export const chapterEditorPath = (bookId: number, id: number) => `/cartile-mele/${bookId}/capitole/${id}`;

/** "IV" for 4: chapters read like a printed book's. */
export function roman(n: number) {
  const numerals: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, letters] of numerals) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}
