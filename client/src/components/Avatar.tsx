import { useState } from 'react';

const GRADIENTS = [
  ['#7c5cff', '#c06cff'],
  ['#ff7a9a', '#ffb36b'],
  ['#3fb8ff', '#6c7bff'],
  ['#2fc6a6', '#3f8cff'],
  ['#f2b84b', '#ff7a59'],
];

/** Profile picture, or initials on a gradient picked from the name. `size: null` leaves the size to the stylesheet. */
export function Avatar({ name, picture, size = 32 }: { name: string; picture: string | null; size?: number | null }) {
  const [broken, setBroken] = useState(false);
  const style = size === null ? undefined : { width: size, height: size, fontSize: size * 0.4 };

  if (picture && !broken) {
    return (
      <img
        className="avatar"
        src={picture}
        alt=""
        style={style}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  const [from, to] = GRADIENTS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % GRADIENTS.length]!;
  return (
    <span className="avatar avatar-initials" style={{ ...style, background: `linear-gradient(135deg, ${from}, ${to})` }} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}
