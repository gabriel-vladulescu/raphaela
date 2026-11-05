import { shrinkIfTooBig } from '@/lib/images';

/** An API failure; `code` is the server's error code (translated by the UI), or "network". */
export class ApiError extends Error {
  code: string;
  status: number;
  /** The rest of the server's answer (e.g. when a deleted account will be gone: `purgeOn`). */
  data: Record<string, unknown>;

  constructor(code: string, status: number, data: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

async function parse<T>(responsePromise: Promise<Response>): Promise<T> {
  let response: Response;
  try {
    response = await responsePromise;
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? 'request_failed', response.status, data);
  return data as T;
}

export function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  return parse<T>(
    fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    }),
  );
}

/** Uploads a post image (authors and owners) and returns its URL. The server stores it as WebP. */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', await shrinkIfTooBig(file));
  const { url } = await parse<{ url: string }>(fetch('/api/uploads', { method: 'POST', body: form }));
  return url;
}

/** Sends the support form (its fields and up to 3 files). */
export function sendSupport(form: FormData) {
  return parse<{ ok: true; id?: number }>(fetch('/api/support', { method: 'POST', body: form }));
}

/** Uploads the signed-in user's profile picture and returns their updated profile. */
export function uploadAvatar<T>(image: Blob): Promise<T> {
  const form = new FormData();
  form.append('file', image, image.type === 'image/webp' ? 'avatar.webp' : image.type === 'image/png' ? 'avatar.png' : 'avatar.jpg');
  return parse<T>(fetch('/api/me/avatar', { method: 'POST', body: form }));
}

/**
 * Google sign-in is a full-page redirect; `next` is where to come back to. `terms`: the page asked for (or stated)
 * agreement to the Terms, so an account created now records it.
 */
export function googleSignInUrl(next = window.location.pathname + window.location.search, { terms = false } = {}) {
  return `/api/auth/google?next=${encodeURIComponent(next)}${terms ? '&terms=1' : ''}`;
}

/** Connecting a Google account to the signed-in one (the profile page): Google sends the browser back to /profil. */
export const googleLinkUrl = () => '/api/auth/google?link=1';
