import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  BetweenHorizontalStart,
  BetweenVerticalStart,
  Bold,
  Code,
  CodeXml,
  Columns3,
  Grid2x2X,
  Highlighter,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableRowsSplit,
  Underline,
  Undo2,
  Unlink,
  Video,
} from 'lucide-react';
import { Popover } from '@/components/Popover';
import { useI18n } from '@/lib/i18n';

// Mid-tone colours that stay readable on the light, dark and midnight themes.
const TEXT_COLORS = ['#7c5cff', '#e5484d', '#f76b15', '#e2a336', '#30a46c', '#0090ff', '#8e4ec6', '#d6409f', '#8b8d98'];
const HIGHLIGHTS = ['#fff3a3', '#ffd6e7', '#d6f5e3', '#d6e9ff', '#eadcff', '#ffe1c7'];
const ALIGNMENTS = [
  { value: 'left', icon: AlignLeft, label: 'toolbar.alignLeft' },
  { value: 'center', icon: AlignCenter, label: 'toolbar.alignCenter' },
  { value: 'right', icon: AlignRight, label: 'toolbar.alignRight' },
  { value: 'justify', icon: AlignJustify, label: 'toolbar.alignJustify' },
] as const;

function ToolButton(props: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`tool-btn${props.active ? ' is-active' : ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()} // keep the editor's selection
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** A one-field form inside a toolbar popover (link / YouTube URL). */
function UrlForm(props: { initial: string; placeholder: string; submitLabel: string; onSubmit: (url: string) => boolean; extra?: ReactNode }) {
  const [value, setValue] = useState(props.initial);
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="url-form"
      onSubmit={(event) => {
        event.preventDefault();
        setInvalid(!props.onSubmit(value.trim()));
      }}
    >
      <input
        className={`input input-sm${invalid ? ' is-invalid' : ''}`}
        value={value}
        placeholder={props.placeholder}
        onChange={(event) => setValue(event.target.value)}
        autoFocus
      />
      <div className="url-form-actions">
        {props.extra}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!value.trim()}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

const withProtocol = (url: string) => (/^(https?:|mailto:|\/|#)/i.test(url) ? url : `https://${url}`);

export function Toolbar({ editor, onPickImages }: { editor: Editor; onPickImages: (files: File[]) => void }) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: ([2, 3, 4] as const).find((level) => e.isActive('heading', { level })) ?? 0,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      subscript: e.isActive('subscript'),
      superscript: e.isActive('superscript'),
      link: e.isActive('link'),
      linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
      color: e.getAttributes('textStyle').color as string | undefined,
      align: ALIGNMENTS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? 'left',
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const AlignIcon = ALIGNMENTS.find((a) => a.value === state.align)!.icon;

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tool-group">
        <ToolButton label={t('toolbar.undo')} disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.redo')} disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 size={17} />
        </ToolButton>
      </div>

      <div className="tool-group">
        <select
          className="tool-select"
          value={state.block}
          aria-label={t('toolbar.paragraph')}
          onChange={(event) => {
            const level = Number(event.target.value) as 0 | 2 | 3 | 4;
            if (level === 0) chain().setParagraph().run();
            else chain().setHeading({ level }).run();
          }}
        >
          <option value={0}>{t('toolbar.paragraph')}</option>
          <option value={2}>{t('toolbar.heading', { n: 1 })}</option>
          <option value={3}>{t('toolbar.heading', { n: 2 })}</option>
          <option value={4}>{t('toolbar.heading', { n: 3 })}</option>
        </select>
      </div>

      <div className="tool-group">
        <ToolButton label={t('toolbar.bold')} active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.italic')} active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.underline')} active={state.underline} onClick={() => chain().toggleUnderline().run()}>
          <Underline size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.strike')} active={state.strike} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.code')} active={state.code} onClick={() => chain().toggleCode().run()}>
          <Code size={17} />
        </ToolButton>

        <Popover
          label={t('toolbar.color')}
          button={<Baseline size={17} style={state.color ? { color: state.color } : undefined} />}
          buttonClassName="tool-btn"
          panelClassName="tool-popover"
          align="start"
          active={Boolean(state.color)}
        >
          {(close) => (
            <div className="swatches">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-label={color}
                  onClick={() => {
                    chain().setColor(color).run();
                    close();
                  }}
                />
              ))}
              <button
                type="button"
                className="swatch-reset"
                onClick={() => {
                  chain().unsetColor().run();
                  close();
                }}
              >
                {t('toolbar.defaultColor')}
              </button>
            </div>
          )}
        </Popover>

        <Popover
          label={t('toolbar.highlight')}
          button={<Highlighter size={17} />}
          buttonClassName="tool-btn"
          panelClassName="tool-popover"
          align="start"
          active={state.highlight}
        >
          {(close) => (
            <div className="swatches">
              {HIGHLIGHTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-label={color}
                  onClick={() => {
                    chain().setHighlight({ color }).run();
                    close();
                  }}
                />
              ))}
              <button
                type="button"
                className="swatch-reset"
                onClick={() => {
                  chain().unsetHighlight().run();
                  close();
                }}
              >
                {t('toolbar.defaultColor')}
              </button>
            </div>
          )}
        </Popover>

        <ToolButton label={t('toolbar.subscript')} active={state.subscript} onClick={() => chain().toggleSubscript().run()}>
          <Subscript size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.superscript')} active={state.superscript} onClick={() => chain().toggleSuperscript().run()}>
          <Superscript size={17} />
        </ToolButton>
      </div>

      <div className="tool-group">
        <Popover label={t('toolbar.alignLeft')} button={<AlignIcon size={17} />} buttonClassName="tool-btn" panelClassName="tool-popover tool-popover-row" align="start">
          {(close) =>
            ALIGNMENTS.map(({ value, icon: Icon, label }) => (
              <ToolButton
                key={value}
                label={t(label)}
                active={state.align === value}
                onClick={() => {
                  chain().setTextAlign(value).run();
                  close();
                }}
              >
                <Icon size={17} />
              </ToolButton>
            ))
          }
        </Popover>
        <ToolButton label={t('toolbar.bulletList')} active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
          <List size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.orderedList')} active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.taskList')} active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
          <ListTodo size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.blockquote')} active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
          <Quote size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.codeBlock')} active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
          <CodeXml size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.hr')} onClick={() => chain().setHorizontalRule().run()}>
          <Minus size={17} />
        </ToolButton>
      </div>

      <div className="tool-group">
        <Popover label={t('toolbar.link')} button={<LinkIcon size={17} />} buttonClassName="tool-btn" panelClassName="tool-popover" align="start" active={state.link}>
          {(close) => (
            <UrlForm
              initial={state.linkHref}
              placeholder={t('toolbar.linkPlaceholder')}
              submitLabel={t('toolbar.apply')}
              onSubmit={(url) => {
                const href = withProtocol(url);
                if (editor.state.selection.empty && !state.link) {
                  chain().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] }).run();
                } else {
                  chain().extendMarkRange('link').setLink({ href }).run();
                }
                close();
                return true;
              }}
              extra={
                state.link && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      chain().extendMarkRange('link').unsetLink().run();
                      close();
                    }}
                  >
                    <Unlink size={15} /> {t('toolbar.removeLink')}
                  </button>
                )
              }
            />
          )}
        </Popover>

        <ToolButton label={t('toolbar.image')} onClick={() => fileInput.current?.click()}>
          <ImagePlus size={17} />
        </ToolButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          multiple
          hidden
          onChange={(event) => {
            onPickImages(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />

        <Popover label={t('toolbar.youtube')} button={<Video size={17} />} buttonClassName="tool-btn" panelClassName="tool-popover" align="start">
          {(close) => (
            <UrlForm
              initial=""
              placeholder={t('toolbar.youtubePlaceholder')}
              submitLabel={t('toolbar.insert')}
              onSubmit={(url) => {
                if (!isValidYoutubeUrl(url)) return false;
                chain().setYoutubeVideo({ src: url }).run();
                close();
                return true;
              }}
            />
          )}
        </Popover>

        <ToolButton label={t('toolbar.table')} active={state.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <Table size={17} />
        </ToolButton>
        <ToolButton label={t('toolbar.clearFormatting')} onClick={() => chain().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting size={17} />
        </ToolButton>
      </div>

      {state.table && (
        <div className="tool-group tool-group-context">
          <ToolButton label={t('toolbar.addRow')} onClick={() => chain().addRowAfter().run()}>
            <BetweenHorizontalStart size={17} />
          </ToolButton>
          <ToolButton label={t('toolbar.addColumn')} onClick={() => chain().addColumnAfter().run()}>
            <BetweenVerticalStart size={17} />
          </ToolButton>
          <ToolButton label={t('toolbar.deleteRow')} onClick={() => chain().deleteRow().run()}>
            <Rows3 size={17} />
          </ToolButton>
          <ToolButton label={t('toolbar.deleteColumn')} onClick={() => chain().deleteColumn().run()}>
            <Columns3 size={17} />
          </ToolButton>
          <ToolButton label={t('toolbar.toggleHeader')} onClick={() => chain().toggleHeaderRow().run()}>
            <TableRowsSplit size={17} />
          </ToolButton>
          <ToolButton label={t('toolbar.deleteTable')} onClick={() => chain().deleteTable().run()}>
            <Grid2x2X size={17} />
          </ToolButton>
        </div>
      )}
    </div>
  );
}
