'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { renderMarkdownSegment, isInternalLink } from '@/lib/markdownRender';
import { convertBlockType, type TextBlock, type BlockType } from '@/lib/markdownBlocks';

export interface WYSIWYGBlockProps {
  block: TextBlock;
  blockIndex: number;
  theme: 'default' | 'dark';
  onSave: (blockIndex: number, newSource: string) => void;
  onDelete: (blockIndex: number) => void;
  // Start in edit mode immediately (used for newly inserted blocks).
  initialEditing?: boolean;
  // Called when the user cancels editing. When provided, the block calls
  // onCancel instead of reverting internally (the parent unmounts it).
  onCancel?: () => void;
}

// Human-readable label for a block type (shown in the toolbar).
function blockTypeLabel(block: TextBlock): string {
  switch (block.nodeType) {
    case 'heading': return `H${block.headingDepth ?? 1}`;
    case 'paragraph': return 'Text';
    case 'list': return 'List';
    case 'code': return 'Code';
    case 'blockquote': return 'Quote';
    case 'table': return 'Table';
    case 'thematicBreak': return 'Divider';
    case 'html': return 'HTML';
    default: return block.nodeType;
  }
}

// Detect the current BlockType of a source string (for the type switcher).
function detectBlockType(source: string): BlockType {
  const firstLine = source.split('\n')[0];
  const headingMatch = firstLine.match(/^(#{1,6})\s/);
  if (headingMatch) {
    return `heading${headingMatch[1].length}` as BlockType;
  }
  if (firstLine.startsWith('>')) return 'quote';
  if (firstLine.match(/^[-*+]\s/)) return 'bulletList';
  if (firstLine.match(/^\d+\.\s/)) return 'numberedList';
  if (firstLine.startsWith('```')) return 'code';
  return 'paragraph';
}

// Wrap the textarea's current selection with prefix/suffix. If there is no
// selection, insert the prefix/suffix at the cursor with the cursor placed
// between them.
function wrapSelection(
  textarea: HTMLTextAreaElement,
  prefix: string,
  suffix: string,
): { value: string; cursorStart: number; cursorEnd: number } {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);

  if (selected) {
    // Check if already wrapped — unwrap instead.
    if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
      const unwrapped = selected.slice(prefix.length, selected.length - suffix.length);
      const newValue = value.slice(0, start) + unwrapped + value.slice(end);
      return { value: newValue, cursorStart: start, cursorEnd: start + unwrapped.length };
    }
    const wrapped = prefix + selected + suffix;
    const newValue = value.slice(0, start) + wrapped + value.slice(end);
    return { value: newValue, cursorStart: start + prefix.length, cursorEnd: start + prefix.length + selected.length };
  }

  // No selection: insert prefix + suffix with cursor in between.
  const newValue = value.slice(0, start) + prefix + suffix + value.slice(end);
  return { value: newValue, cursorStart: start + prefix.length, cursorEnd: start + prefix.length };
}

// Renders one text block of the WYSIWYG markdown editor. In read mode the
// block shows its rendered HTML (via marked); clicking it swaps to an inline
// textarea with the block's markdown source. Save (click, Cmd/Ctrl+Enter, or
// blur) splices the edited source back into the full document through
// onSave; Cancel (click or Escape) reverts without saving.
export default function WYSIWYGBlock({
  block,
  blockIndex,
  theme,
  onSave,
  onDelete,
  initialEditing = false,
  onCancel,
}: WYSIWYGBlockProps) {
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(block.source);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';
  const isEmpty = !block.source.trim();

  // Focus and auto-size the textarea when entering edit mode.
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      autoSize(textareaRef.current);
    }
  }, [isEditing]);

  const autoSize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSave = () => {
    // For a pending insert (onCancel provided), saving an empty draft is a
    // no-op — cancel instead so no empty block is inserted.
    if (onCancel && !draft.trim()) {
      onCancel();
      return;
    }
    setIsEditing(false);
    if (draft !== block.source) {
      onSave(blockIndex, draft);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      setDraft(block.source);
      setIsEditing(false);
    }
  };

  // Blur saves the draft — but only when focus leaves the block entirely.
  // Clicking a toolbar control (type select, save, cancel) moves focus out of
  // the textarea; exiting edit mode there would unmount the control mid-click.
  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && blockRef.current?.contains(next)) return;
    handleSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      applyWrap('**', '**');
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      applyWrap('*', '*');
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      applyWrap('[', '](url)');
    }
  };

  // Wrap the textarea selection with prefix/suffix (bold, italic, link).
  const applyWrap = (prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const result = wrapSelection(ta, prefix, suffix);
    setDraft(result.value);
    // Restore cursor/selection after React re-renders the textarea.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.cursorStart, result.cursorEnd);
      autoSize(ta);
    });
  };

  // Convert the block to a different type (source manipulation).
  const handleTypeChange = (newType: BlockType) => {
    const converted = convertBlockType(draft, newType);
    setDraft(converted);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        autoSize(textareaRef.current);
      }
    });
  };

  // Intercept clicks on rendered links: in-document fragment links scroll to
  // the target heading (no page navigation); everything else opens in a new
  // tab. stopPropagation keeps the block from entering edit mode on link click.
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    if (isInternalLink(href)) {
      const id = href.slice(1);
      // Search within the markdown preview so we don't jump to an element
      // outside the document surface.
      const preview = blockRef.current?.closest('[data-testid="markdown-preview"]');
      const target = preview
        ? preview.querySelector(`[id="${CSS.escape(id)}"]`)
        : document.getElementById(id);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  const renderedHtml = renderMarkdownSegment(block.source);

  return (
    <div
      ref={blockRef}
      data-testid={`wysiwyg-block-${blockIndex}`}
      className={`wysiwyg-block group ${isEditing ? 'wysiwyg-active' : ''} ${
        isDark ? 'text-slate-100' : 'text-gray-900'
      }`}
      onClick={() => {
        if (!isEditing) {
          setDraft(block.source);
          setIsEditing(true);
        }
      }}
    >
      {/* Toolbar (visible on hover, or always when editing) */}
      <div
        className={`wysiwyg-block-toolbar ${isEditing ? 'visible' : ''} ${
          isDark ? 'text-slate-400' : 'text-gray-500'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="wysiwyg-block-type-label">{blockTypeLabel(block)}</span>
        {isEditing ? (
          <>
            <select
              data-testid={`wysiwyg-block-type-${blockIndex}`}
              value={detectBlockType(draft)}
              onChange={(e) => handleTypeChange(e.target.value as BlockType)}
              title="Change block type"
              className={`text-xs border rounded px-1 py-0.5 ${
                isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-gray-300 text-gray-700'
              }`}
            >
              <option value="paragraph">Text</option>
              <option value="heading1">Heading 1</option>
              <option value="heading2">Heading 2</option>
              <option value="heading3">Heading 3</option>
              <option value="heading4">Heading 4</option>
              <option value="heading5">Heading 5</option>
              <option value="heading6">Heading 6</option>
              <option value="bulletList">Bullet list</option>
              <option value="numberedList">Numbered list</option>
              <option value="quote">Quote</option>
              <option value="code">Code</option>
            </select>
            <button
              data-testid={`wysiwyg-block-save-${blockIndex}`}
              onClick={handleSave}
              title="Save (Cmd/Ctrl+Enter)"
              className={`wysiwyg-block-btn ${isDark ? 'hover:bg-slate-700 text-green-400' : 'hover:bg-gray-200 text-green-600'}`}
            >
              <Check size={14} />
            </button>
            <button
              data-testid={`wysiwyg-block-cancel-${blockIndex}`}
              onClick={handleCancel}
              title="Cancel (Escape)"
              className={`wysiwyg-block-btn ${isDark ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-gray-200 text-gray-600'}`}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            data-testid={`wysiwyg-block-delete-${blockIndex}`}
            onClick={() => onDelete(blockIndex)}
            title="Delete block"
            className={`wysiwyg-block-btn ${isDark ? 'hover:bg-slate-700 text-red-400' : 'hover:bg-gray-200 text-red-500'}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Content */}
      {isEditing ? (
        <textarea
          ref={textareaRef}
          data-testid={`wysiwyg-block-editor-${blockIndex}`}
          className={`wysiwyg-block-editor ${isDark ? 'bg-slate-900 text-slate-100 border-slate-700' : 'bg-white text-gray-900 border-gray-300'}`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoSize(e.target);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Type markdown…"
          rows={1}
        />
      ) : isEmpty ? (
        <div
          data-testid={`wysiwyg-block-empty-${blockIndex}`}
          className={`italic ${isDark ? 'text-slate-500' : 'text-gray-400'}`}
        >
          Empty block — click to edit
        </div>
      ) : (
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
          onClick={handleContentClick}
        />
      )}
    </div>
  );
}
