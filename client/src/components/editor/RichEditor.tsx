import { useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Typography } from '@tiptap/extension-typography';
import { Youtube } from '@tiptap/extension-youtube';
import { LoaderCircle } from 'lucide-react';
import { Toolbar } from '@/components/editor/Toolbar';
import { uploadImage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const imageFiles = (files: FileList | null | undefined) => Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));

interface RichEditorProps {
  initialHtml: string;
  /** Must be stable (e.g. a state setter): it's captured when the editor is created. */
  onChange: (html: string) => void;
}

export function RichEditor({ initialHtml, onChange }: RichEditorProps) {
  const { t, errorMessage } = useI18n();
  const editorRef = useRef<Editor | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState('');

  /** Uploads images and inserts them at `position` (drop) or at the cursor. */
  async function insertImages(files: File[], position?: number) {
    setUploadError('');
    for (const file of files) {
      setUploading((count) => count + 1);
      try {
        const src = await uploadImage(file);
        const chain = editorRef.current?.chain().focus();
        if (position === undefined) chain?.setImage({ src, alt: '' }).run();
        else chain?.insertContentAt(position, { type: 'image', attrs: { src, alt: '' } }).run();
      } catch (err) {
        setUploadError(errorMessage(err));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] }, // the post title is the page's h1
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder: t('editor.placeholder') }),
      CharacterCount,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Subscript,
      Superscript,
      Typography,
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Youtube.configure({ nocookie: true, modestBranding: true }),
    ],
    content: initialHtml,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    editorProps: {
      attributes: { class: 'prose editor-content' },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        void insertImages(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || files.length === 0) return false;
        event.preventDefault();
        void insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
  });
  editorRef.current = editor;

  // Storage is gone on an editor that's being destroyed (e.g. StrictMode's remount in development).
  const words = useEditorState({ editor, selector: ({ editor: current }) => current.storage.characterCount?.words() ?? 0 });

  return (
    <div className="rich-editor">
      <Toolbar editor={editor} onPickImages={(files) => void insertImages(files)} />
      <EditorContent editor={editor} />
      <div className="editor-footer">
        <span>
          {t('editor.words', { n: words })} · {t('post.readingTime', { n: Math.max(1, Math.round(words / 200)) })}
        </span>
        {uploading > 0 && (
          <span className="uploading">
            <LoaderCircle size={14} className="spin" /> {t('editor.uploading')}
          </span>
        )}
        {uploadError && <span className="form-error">{uploadError}</span>}
      </div>
    </div>
  );
}
