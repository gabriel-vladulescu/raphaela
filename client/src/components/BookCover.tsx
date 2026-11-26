import type { CSSProperties } from 'react';
import { colorsOf, ORNAMENTS } from '@/lib/covers';
import type { CoverDesign } from '@/lib/covers';

interface Props {
  design: CoverDesign;
  title: string;
  subject?: string;
  author?: string;
  /** A list's thumbnail: the colours and the ornament only. */
  mini?: boolean;
  /** Said to screen readers (a cover on its own); without it the cover is decoration beside its title. */
  label?: string;
  className?: string;
}

/**
 * A book's cover, drawn from its design (lib/covers.ts) with the title, subject and author on it. Everything inside
 * is sized from the cover's width (styles/books.css), so the same cover works from a 26 px thumbnail up.
 */
export function BookCover({ design, title, subject = '', author = '', mini = false, label, className = '' }: Props) {
  const colors = colorsOf(design);
  const ornament = ORNAMENTS[design.ornament] ?? ORNAMENTS.lotus;
  const style = { '--c1': colors.c1, '--c2': colors.c2, '--ink': colors.ink, '--orn': colors.orn } as CSSProperties;
  return (
    <div
      className={`cover${mini ? ' is-mini' : ''}${className ? ` ${className}` : ''}`}
      data-layout={design.layout}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <span className="cover-arch" />
      <svg className="cover-orn" viewBox="0 0 100 100" dangerouslySetInnerHTML={{ __html: ornament.svg }} />
      {!mini && (
        <>
          <span className="cover-subject">{subject}</span>
          <span className="cover-foot">
            <span className="cover-title">{title}</span>
            {author && <span className="cover-author">{author}</span>}
          </span>
        </>
      )}
    </div>
  );
}
