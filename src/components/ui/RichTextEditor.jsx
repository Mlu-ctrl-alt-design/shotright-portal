import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { clsx } from '../../utils/clsx'

/**
 * Rich-text editor for long-form venue and menu copy.
 *
 * Built on TipTap (ProseMirror). The toolbar sits *below* the content area and
 * carries exactly the controls in the designs: bold, italic, underline,
 * strikethrough, sub- and superscript, clear formatting, four alignments,
 * highlight and text colour. Headings come from StarterKit — the sample copy in
 * `venue details filled.png` uses them ("At Your Service", "55 Years").
 *
 * StarterKit v3 already bundles underline and link, so neither is added again
 * here; doing so triggers a duplicate-extension warning and breaks the schema.
 *
 * ⚠️ This component produces raw HTML. It is safe to *edit* here — ProseMirror
 * only ever emits nodes its schema allows — but the customer app renders this
 * copy, so the value MUST be sanitised server-side on save. Trusting
 * client-side schema restriction alone is not enough: the API accepts whatever
 * is posted to it, not only what this editor can produce.
 */
function ToolbarButton({ onClick, active, disabled, label, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the selection while clicking
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={clsx(
        'grid size-8 place-items-center rounded-lg text-sm transition',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-brand-500 text-ink-900' : 'text-ink-700 hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-brand-200" />
}

const SWATCHES = ['#2d2d2d', '#e2941f', '#fbab29', '#16a34a', '#dc2626', '#2563eb']

function ColourControl({ label, value, onPick, onClear, glyph }) {
  return (
    <span className="group relative inline-flex">
      <span className="flex items-center gap-0.5 rounded-lg px-1 py-1 text-ink-700 hover:bg-brand-50">
        <span className="grid size-5 place-items-center text-sm font-bold" aria-hidden="true">
          {glyph}
        </span>
        <span className="h-1 w-4 rounded-sm" style={{ background: value || '#2d2d2d' }} />
        <svg viewBox="0 0 10 6" className="size-2 fill-none stroke-current stroke-2">
          <path d="M1 1l4 4 4-4" strokeLinecap="round" />
        </svg>
      </span>
      {/* Hover/focus popover — no portal needed, the toolbar is the last row. */}
      <span className="invisible absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-xl border-2 border-brand-edge bg-white p-2 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label}: ${c}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className="size-5 rounded-full ring-1 ring-black/15"
            style={{ background: c }}
          />
        ))}
        <button
          type="button"
          aria-label={`${label}: none`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          className="grid size-5 place-items-center rounded-full text-[10px] font-bold text-ink-500 ring-1 ring-black/15"
        >
          ✕
        </button>
      </span>
    </span>
  )
}

export default function RichTextEditor({ value, onChange, placeholder, ariaLabel = 'Description' }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Subscript,
      Superscript,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
        class:
          'prose-editor min-h-56 max-h-[28rem] overflow-y-auto px-5 py-4 text-sm text-ink-900 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      if (editor.isDestroyed) return
      onChange(editor.getHTML())
    },
  })

  // Re-sync only when the value genuinely diverges — e.g. stepping back into
  // this wizard step. Without the divergence check every keystroke would reset
  // the cursor.
  //
  // The isDestroyed guard is load-bearing, not defensive noise: mounting this
  // editor inside a Suspense boundary produces a mount → unmount → mount cycle,
  // and the effect from the first pass runs against the torn-down instance.
  // TipTap nulls the schema on destroy, so getHTML() then throws inside
  // ProseMirror's DOMSerializer rather than returning anything.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === undefined) return
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [value, editor])

  if (!editor) return null

  const is = (name, attrs) => editor.isActive(name, attrs)
  const chain = () => editor.chain().focus()

  return (
    <div className="overflow-hidden rounded-3xl border-2 border-brand-edge bg-white focus-within:ring-2 focus-within:ring-brand-300">
      {editor.isEmpty && placeholder && (
        <p className="px-5 pt-4 text-sm text-ink-500 italic">{placeholder}</p>
      )}

      <EditorContent editor={editor} />

      <div className="flex flex-wrap items-center gap-0.5 border-t border-brand-200 px-3 py-2">
        <ToolbarButton label="Bold" active={is('bold')} onClick={() => chain().toggleBold().run()}>
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={is('italic')}
          onClick={() => chain().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={is('underline')}
          onClick={() => chain().toggleUnderline().run()}
        >
          <span className="underline">U</span>
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={is('strike')}
          onClick={() => chain().toggleStrike().run()}
        >
          <span className="line-through">S</span>
        </ToolbarButton>
        <ToolbarButton
          label="Subscript"
          active={is('subscript')}
          onClick={() => chain().toggleSubscript().run()}
        >
          <span>
            x<sub>2</sub>
          </span>
        </ToolbarButton>
        <ToolbarButton
          label="Superscript"
          active={is('superscript')}
          onClick={() => chain().toggleSuperscript().run()}
        >
          <span>
            x<sup>2</sup>
          </span>
        </ToolbarButton>
        <ToolbarButton
          label="Clear formatting"
          onClick={() => chain().unsetAllMarks().clearNodes().run()}
        >
          <span className="italic">
            I<sub>x</sub>
          </span>
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          label="Heading"
          active={is('heading', { level: 3 })}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <span className="text-xs font-bold">H</span>
        </ToolbarButton>

        <Divider />

        {[
          ['left', 'Align left'],
          ['center', 'Align centre'],
          ['right', 'Align right'],
          ['justify', 'Justify'],
        ].map(([align, label]) => (
          <ToolbarButton
            key={align}
            label={label}
            active={is({ textAlign: align })}
            onClick={() => chain().setTextAlign(align).run()}
          >
            <svg viewBox="0 0 16 16" className="size-4 stroke-current stroke-[1.5]">
              <path d="M2 4h12" strokeLinecap="round" />
              <path
                d={
                  align === 'center'
                    ? 'M4 8h8'
                    : align === 'right'
                      ? 'M6 8h8'
                      : align === 'justify'
                        ? 'M2 8h12'
                        : 'M2 8h8'
                }
                strokeLinecap="round"
              />
              <path
                d={
                  align === 'center'
                    ? 'M4 12h8'
                    : align === 'right'
                      ? 'M6 12h8'
                      : align === 'justify'
                        ? 'M2 12h12'
                        : 'M2 12h8'
                }
                strokeLinecap="round"
              />
            </svg>
          </ToolbarButton>
        ))}

        <Divider />

        <ColourControl
          label="Highlight"
          glyph="A"
          value={editor.getAttributes('highlight').color}
          onPick={(c) => chain().setHighlight({ color: c }).run()}
          onClear={() => chain().unsetHighlight().run()}
        />
        <ColourControl
          label="Text colour"
          glyph="A"
          value={editor.getAttributes('textStyle').color}
          onPick={(c) => chain().setColor(c).run()}
          onClear={() => chain().unsetColor().run()}
        />
      </div>
    </div>
  )
}
