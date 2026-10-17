import sanitizeHtml from 'sanitize-html';

const colorValue = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^inherit$/];

// Everything the post editor can produce, and nothing else.
const postOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'span',
    'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'label', 'input', 'div', 'hr', 'a', 'img',
    'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td', 'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    mark: ['data-color', 'style'],
    span: ['style'],
    p: ['style'],
    h2: ['style'],
    h3: ['style'],
    h4: ['style'],
    ol: ['start', 'type'],
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
    input: ['type', 'checked', 'disabled'],
    div: ['data-youtube-video'],
    iframe: ['src', 'width', 'height', 'allowfullscreen', 'allow', 'frameborder'],
    table: ['style'],
    col: ['style'],
    th: ['colspan', 'rowspan', 'colwidth', 'style'],
    td: ['colspan', 'rowspan', 'colwidth', 'style'],
  },
  allowedClasses: { code: ['language-*'] },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      color: colorValue,
      'background-color': colorValue,
      width: [/^\d+(\.\d+)?px$/],
      'min-width': [/^\d+(\.\d+)?px$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com'],
  // Drops iframes whose src was rejected above instead of leaving empty frames.
  exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
    // Task-list checkboxes are display-only outside the editor.
    input: (tagName, attribs) => ({
      tagName,
      attribs: { type: 'checkbox', disabled: 'disabled', ...('checked' in attribs ? { checked: 'checked' } : {}) },
    }),
  },
};

export function sanitizePostHtml(html: string): string {
  return sanitizeHtml(html, postOptions);
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  const spaced = html.replace(/<\/(p|h\d|li|blockquote|pre|td|th|div)>|<br\s*\/?>/gi, '$& ');
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => entities[name])
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeExcerpt(text: string, maxLength = 220): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : maxLength)}…`;
}

export function readingMinutes(text: string): number {
  const words = text ? text.split(' ').length : 0;
  return Math.max(1, Math.round(words / 200));
}
