import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, History, RotateCcw, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface VersionSummary {
  id: number;
  savedAt: string;
  title: string;
  size: number;
  savedBy: string | null;
}

export interface Version {
  id: number;
  savedAt: string;
  savedBy: string | null;
  title: string;
  excerpt: string;
  contentHtml: string;
  bannerUrl: string | null;
}

/** The text's blocks (paragraphs, headings, list items…) as plain lines, to compare. */
function blocksOf(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: string[] = [];
  doc.body.querySelectorAll('p, h2, h3, h4, li, blockquote, pre, td, th, figcaption').forEach((el) => {
    // A list item or a quote holding paragraphs counts once, by its paragraphs.
    if (el.querySelector('p, li')) return;
    const text = el.textContent?.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  });
  doc.body.querySelectorAll('img').forEach((img) => lines.push(`🖼 ${img.getAttribute('alt') || img.getAttribute('src')?.split('/').pop() || ''}`));
  return lines;
}

type Line = { kind: 'same' | 'removed' | 'added'; text: string };

/** A line diff (longest common subsequence): what the version had that's gone now, and what's new since. */
function diff(before: string[], after: string[]): Line[] {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) lines.push({ kind: 'removed', text: before[i++] });
    else lines.push({ kind: 'added', text: after[j++] });
  }
  while (i < n) lines.push({ kind: 'removed', text: before[i++] });
  while (j < m) lines.push({ kind: 'added', text: after[j++] });
  return lines;
}

/** Long runs of unchanged lines fold to their ends and a count, so the changes stand out. */
function folded(lines: Line[]): (Line | { kind: 'skip'; count: number })[] {
  const out: (Line | { kind: 'skip'; count: number })[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind !== 'same') {
      out.push(lines[i++]);
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].kind === 'same') end++;
    const run = lines.slice(i, end);
    if (run.length > 3) out.push(...(i > 0 ? [run[0]] : []), { kind: 'skip', count: run.length - (i > 0 ? 1 : 0) - (end < lines.length ? 1 : 0) }, ...(end < lines.length ? [run[run.length - 1]] : []));
    else out.push(...run);
    i = end;
  }
  return out;
}

/**
 * The post's earlier versions (one per editing session, server/src/lib/revisions.ts): each compared with the text in
 * the editor now, or read as it was, and brought back into the editor (saving it makes it the post again).
 */
export function VersionsDialog(props: {
  base: string;
  current: { title: string; contentHtml: string };
  onRestore: (version: Version) => void;
  onClose: () => void;
}) {
  const { t, formatDateTime, errorMessage } = useI18n();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [open, setOpen] = useState<Version | null>(null);
  const [view, setView] = useState<'changes' | 'text'>('changes');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ versions: VersionSummary[] }>(`${props.base}/versions`)
      .then((data) => setVersions(data.versions))
      .catch((err) => setError(errorMessage(err)));
    // Once, when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function show(id: number) {
    setError('');
    try {
      const { version } = await api<{ version: Version }>(`${props.base}/versions/${id}`);
      setOpen(version);
      setView('changes');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const lines = useMemo(() => (open ? diff(blocksOf(open.contentHtml), blocksOf(props.current.contentHtml)) : []), [open, props.current.contentHtml]);
  const changes = lines.filter((line) => line.kind !== 'same').length;

  return (
    <Modal title={t('versions.title')} onClose={props.onClose} closeOnBackdrop className="versions-dialog">
      <div className="modal-body versions-body">
        <div className="versions-head">
          {open ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
              <ArrowLeft size={15} /> {t('versions.all')}
            </button>
          ) : (
            <h2>
              <History size={18} /> {t('versions.title')}
            </h2>
          )}
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}

        {!open && (
          <>
            <p className="muted small">{t('versions.intro')}</p>
            {versions === null ? (
              !error && <p className="muted">{t('common.loading')}</p>
            ) : versions.length === 0 ? (
              <p className="versions-empty muted">{t('versions.empty')}</p>
            ) : (
              <ul className="versions-list">
                {versions.map((version) => (
                  <li key={version.id}>
                    <button type="button" onClick={() => void show(version.id)}>
                      <span className="versions-when">{formatDateTime(version.savedAt)}</span>
                      <span className="versions-title">{version.title || t('editor.titlePlaceholder')}</span>
                      <span className="versions-by muted small">{version.savedBy ? t('versions.by', { name: version.savedBy }) : t('comments.deletedAccount')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {open && (
          <>
            <div className="versions-meta">
              <strong>{formatDateTime(open.savedAt)}</strong>
              {open.savedBy && <span className="muted small">{t('versions.by', { name: open.savedBy })}</span>}
              <div className="segmented">
                {(['changes', 'text'] as const).map((value) => (
                  <button key={value} type="button" className={view === value ? 'is-selected' : ''} aria-pressed={view === value} onClick={() => setView(value)}>
                    {t(`versions.view.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            {open.title !== props.current.title && (
              <p className="versions-title-change small">
                <span className="diff-removed">{open.title}</span> → <span className="diff-added">{props.current.title}</span>
              </p>
            )}
            {view === 'changes' ? (
              <div className="versions-diff" aria-label={t('versions.view.changes')}>
                {changes === 0 ? (
                  <p className="muted">{t('versions.same')}</p>
                ) : (
                  <>
                    <p className="muted small">{t('versions.legend')}</p>
                    {folded(lines).map((line, index) =>
                      line.kind === 'skip' ? (
                        <p key={index} className="diff-skip muted small">
                          {t('versions.unchanged', { n: line.count })}
                        </p>
                      ) : (
                        <p key={index} className={`diff-line diff-${line.kind}`}>
                          {line.text}
                        </p>
                      ),
                    )}
                  </>
                )}
              </div>
            ) : (
              // Sanitized on the server when it was saved.
              <div className="prose versions-text" dangerouslySetInnerHTML={{ __html: open.contentHtml }} />
            )}
            <div className="modal-actions">
              <span className="muted small">{t('versions.restoreHint')}</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  props.onRestore(open);
                  props.onClose();
                }}
              >
                <RotateCcw size={15} /> {t('versions.restore')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
