'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Type, ArrowRightLeft, Workflow } from 'lucide-react';
import WYSIWYGBlock from './WYSIWYGBlock';
import MermaidBlockPreview from './MermaidBlockPreview';
import {
  parseMarkdownBlocks,
  replaceBlockSource,
  insertBlockAfter,
  insertMermaidBlock,
  deleteBlock,
  type TextBlock,
  type DiagramInsertType,
} from '@/lib/markdownBlocks';
import { DiagramViewSelection } from '@/lib/diagramView';

export interface WYSIWYGEditorProps {
  code: string;
  theme: 'default' | 'dark';
  // Monaco edits (no undo) — passed through for API compatibility.
  onCodeChange: (newCode: string) => void;
  // WYSIWYG edits (with undo) — the primary mutation path.
  onMarkdownEdit: (newCode: string) => void;
  onSelectDiagram: (index: number) => void;
  // Per-block view/tag selections for the mermaid preview controls, keyed by
  // the diagram index (the same index onSelectDiagram reports).
  viewStates?: Map<number, DiagramViewSelection>;
  onViewStateChange?: (index: number, selection: DiagramViewSelection) => void;
  // One-shot "scroll to this diagram" request (the diagram editor's Back to
  // markdown button): forwarded to the matching MermaidBlockPreview, which
  // scrolls itself into view once settled and reports back through onScrolled.
  scrollToIndex?: number | null;
  onScrolled?: () => void;
}

// The WYSIWYG document surface: renders the full markdown document as a
// sequence of editable blocks (text blocks via WYSIWYGBlock, mermaid blocks
// via MermaidBlockPreview). Every mutation (edit/insert/delete) computes the
// new full document and emits it through onMarkdownEdit. The document is
// re-parsed whenever `code` changes (external update, undo/redo, file
// switch), so block offsets are always consistent with the current source.
export default function WYSIWYGEditor({
  code,
  theme,
  onMarkdownEdit,
  onSelectDiagram,
  viewStates,
  onViewStateChange,
  scrollToIndex,
  onScrolled,
}: WYSIWYGEditorProps) {
  // Position of a pending (not yet committed) new block, or null.
  const [pendingInsert, setPendingInsert] = useState<number | null>(null);
  // Position of the insert menu currently open (the "+" popover with the
  // block-type choices), or null. At most one menu is open at a time.
  const [openInsertMenu, setOpenInsertMenu] = useState<number | null>(null);
  const isDark = theme === 'dark';

  const blocks = useMemo(() => parseMarkdownBlocks(code), [code]);

  const handleSave = useCallback((blockIndex: number, newSource: string) => {
    const newCode = replaceBlockSource(code, blockIndex, newSource);
    onMarkdownEdit(newCode);
  }, [code, onMarkdownEdit]);

  const handleDelete = useCallback((blockIndex: number) => {
    const newCode = deleteBlock(code, blockIndex);
    onMarkdownEdit(newCode);
  }, [code, onMarkdownEdit]);

  // Start creating a new block at `position` (0 = before the first block,
  // blocks.length = after the last). The block is not committed to the
  // document until the user types and saves.
  const handleInsert = useCallback((position: number) => {
    setOpenInsertMenu(null);
    setPendingInsert(position);
  }, []);

  // Insert a scaffolded mermaid block (sequence diagram / flowchart) at
  // `position` and open it in the diagram editor right away: the scaffold is
  // committed through onMarkdownEdit, then the new diagram is selected.
  const handleInsertDiagram = useCallback((position: number, type: DiagramInsertType) => {
    const { code: newCode, diagramIndex } = insertMermaidBlock(code, position, type);
    setOpenInsertMenu(null);
    onMarkdownEdit(newCode);
    onSelectDiagram(diagramIndex);
  }, [code, onMarkdownEdit, onSelectDiagram]);

  // Commit a pending insert: splice the typed source into the document.
  const handleInsertSave = useCallback((position: number, newSource: string) => {
    const newCode = insertBlockAfter(code, position - 1, newSource);
    setPendingInsert(null);
    onMarkdownEdit(newCode);
  }, [code, onMarkdownEdit]);

  // Cancel a pending insert: discard without modifying the document.
  const handleInsertCancel = useCallback(() => {
    setPendingInsert(null);
  }, []);

  // Clicking the container background (not a block) dismisses a pending
  // insert and closes any open insert menu.
  const handleBackgroundClick = () => {
    setPendingInsert(null);
    setOpenInsertMenu(null);
  };

  // While an insert menu is open, an outside click or Escape closes it.
  useEffect(() => {
    if (openInsertMenu === null) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.wysiwyg-insert-menu, .wysiwyg-insert-btn')) return;
      setOpenInsertMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenInsertMenu(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openInsertMenu]);

  // A synthetic empty text block for a pending insert.
  const pendingBlock: TextBlock = {
    kind: 'text',
    nodeType: 'paragraph',
    startOffset: 0,
    endOffset: 0,
    source: '',
  };

  // Empty document: show a single insert affordance (or a pending insert).
  if (blocks.length === 0) {
    return (
      <div
        data-testid="wysiwyg-editor"
        className={`wysiwyg-editor ${isDark ? 'text-slate-100' : 'text-gray-900'}`}
        onClick={handleBackgroundClick}
      >
        {pendingInsert === 0 ? (
          <WYSIWYGBlock
            block={pendingBlock}
            blockIndex={0}
            theme={theme}
            onSave={(_, source) => handleInsertSave(0, source)}
            onDelete={handleInsertCancel}
            initialEditing
            onCancel={handleInsertCancel}
          />
        ) : (
          <>
            <div
              data-testid="wysiwyg-empty"
              className={`italic ${isDark ? 'text-slate-500' : 'text-gray-400'}`}
            >
              (empty document — click + to add content)
            </div>
            <InsertButton
              position={0}
              isDark={isDark}
              isOpen={openInsertMenu === 0}
              onToggle={() => setOpenInsertMenu(openInsertMenu === 0 ? null : 0)}
              onClose={() => setOpenInsertMenu(null)}
              onInsert={handleInsert}
              onInsertDiagram={handleInsertDiagram}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="wysiwyg-editor"
      className={`wysiwyg-editor ${isDark ? 'text-slate-100' : 'text-gray-900'}`}
      onClick={handleBackgroundClick}
    >
      {/* Insert button (or pending block) before the first block */}
      {pendingInsert === 0 ? (
        <WYSIWYGBlock
          block={pendingBlock}
          blockIndex={0}
          theme={theme}
          onSave={(_, source) => handleInsertSave(0, source)}
          onDelete={handleInsertCancel}
          initialEditing
          onCancel={handleInsertCancel}
        />
      ) : (
        <InsertButton
          position={0}
          isDark={isDark}
          isOpen={openInsertMenu === 0}
          onToggle={() => setOpenInsertMenu(openInsertMenu === 0 ? null : 0)}
          onClose={() => setOpenInsertMenu(null)}
          onInsert={handleInsert}
          onInsertDiagram={handleInsertDiagram}
        />
      )}

      {blocks.map((block, i) => (
        <div key={`block-wrapper-${i}-${block.startOffset}`}>
          {block.kind === 'text' ? (
            <WYSIWYGBlock
              key={`text-${i}-${block.startOffset}`}
              block={block as TextBlock}
              blockIndex={i}
              theme={theme}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ) : (
            <MermaidBlockPreview
              key={`mermaid-${block.index}-${block.startOffset}`}
              content={block.content}
              index={block.index}
              title={block.title}
              startLine={block.startLine}
              endLine={block.endLine}
              theme={theme}
              onSelect={() => onSelectDiagram(block.index)}
              onDelete={() => handleDelete(i)}
              viewState={viewStates?.get(block.index)}
              onViewStateChange={onViewStateChange
                ? (selection) => onViewStateChange(block.index, selection)
                : undefined}
              scrollToMe={scrollToIndex != null && block.index === scrollToIndex}
              onScrolled={onScrolled}
            />
          )}
          {/* Insert button (or pending block) after each block */}
          {pendingInsert === i + 1 ? (
            <WYSIWYGBlock
              block={pendingBlock}
              blockIndex={i + 1}
              theme={theme}
              onSave={(_, source) => handleInsertSave(i + 1, source)}
              onDelete={handleInsertCancel}
              initialEditing
              onCancel={handleInsertCancel}
            />
          ) : (
            <InsertButton
              position={i + 1}
              isDark={isDark}
              isOpen={openInsertMenu === i + 1}
              onToggle={() => setOpenInsertMenu(openInsertMenu === i + 1 ? null : i + 1)}
              onClose={() => setOpenInsertMenu(null)}
              onInsert={handleInsert}
              onInsertDiagram={handleInsertDiagram}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// The "+" button between blocks. Appears on hover of the gap area. Clicking
// it opens a small menu with the block choices: a plain text block (edited
// inline), or a scaffolded mermaid block (sequence diagram / flowchart) that
// is inserted and opened in the diagram editor right away.
function InsertButton({
  position,
  isDark,
  isOpen,
  onToggle,
  onClose,
  onInsert,
  onInsertDiagram,
}: {
  position: number;
  isDark: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onInsert: (position: number) => void;
  onInsertDiagram: (position: number, type: DiagramInsertType) => void;
}) {
  const itemClass = `wysiwyg-insert-menu-item ${isDark ? 'text-slate-200 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'}`;
  return (
    <div className={`wysiwyg-insert-row group/insert${isOpen ? ' wysiwyg-insert-row-open' : ''}`}>
      <button
        data-testid={`wysiwyg-insert-${position}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="Insert block"
        aria-expanded={isOpen}
        className={`wysiwyg-insert-btn ${isDark ? 'text-slate-500 hover:text-blue-400 hover:bg-slate-800' : 'text-gray-400 hover:text-blue-600 hover:bg-gray-100'}`}
      >
        <Plus size={14} />
      </button>
      {isOpen && (
        <div
          data-testid={`wysiwyg-insert-menu-${position}`}
          className={`wysiwyg-insert-menu ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            data-testid={`wysiwyg-insert-text-${position}`}
            className={itemClass}
            onClick={() => {
              onClose();
              onInsert(position);
            }}
          >
            <Type size={12} />
            Text block
          </button>
          <button
            data-testid={`wysiwyg-insert-diagram-sequence-${position}`}
            className={itemClass}
            onClick={() => {
              onClose();
              onInsertDiagram(position, 'sequence');
            }}
          >
            <ArrowRightLeft size={12} />
            Sequence Diagram
          </button>
          <button
            data-testid={`wysiwyg-insert-diagram-flowchart-${position}`}
            className={itemClass}
            onClick={() => {
              onClose();
              onInsertDiagram(position, 'flowchart');
            }}
          >
            <Workflow size={12} />
            Flowchart
          </button>
        </div>
      )}
    </div>
  );
}
