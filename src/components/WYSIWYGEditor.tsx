'use client';

import { useMemo, useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import WYSIWYGBlock from './WYSIWYGBlock';
import MermaidBlockPreview from './MermaidBlockPreview';
import {
  parseMarkdownBlocks,
  replaceBlockSource,
  insertBlockAfter,
  deleteBlock,
  type TextBlock,
} from '@/lib/markdownBlocks';

export interface WYSIWYGEditorProps {
  code: string;
  theme: 'default' | 'dark';
  // Monaco edits (no undo) — passed through for API compatibility.
  onCodeChange: (newCode: string) => void;
  // WYSIWYG edits (with undo) — the primary mutation path.
  onMarkdownEdit: (newCode: string) => void;
  onSelectDiagram: (index: number) => void;
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
}: WYSIWYGEditorProps) {
  // Position of a pending (not yet committed) new block, or null.
  const [pendingInsert, setPendingInsert] = useState<number | null>(null);
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
    setPendingInsert(position);
  }, []);

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

  // Clicking the container background (not a block) dismisses a pending insert.
  const handleBackgroundClick = () => {
    setPendingInsert(null);
  };

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
            <InsertButton position={0} isDark={isDark} onInsert={handleInsert} />
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
        <InsertButton position={0} isDark={isDark} onInsert={handleInsert} />
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
            <InsertButton position={i + 1} isDark={isDark} onInsert={handleInsert} />
          )}
        </div>
      ))}
    </div>
  );
}

// The "+" button between blocks. Appears on hover of the gap area.
function InsertButton({
  position,
  isDark,
  onInsert,
}: {
  position: number;
  isDark: boolean;
  onInsert: (position: number) => void;
}) {
  return (
    <div className="wysiwyg-insert-row group/insert">
      <button
        data-testid={`wysiwyg-insert-${position}`}
        onClick={(e) => {
          e.stopPropagation();
          onInsert(position);
        }}
        title="Insert block"
        className={`wysiwyg-insert-btn ${isDark ? 'text-slate-500 hover:text-blue-400 hover:bg-slate-800' : 'text-gray-400 hover:text-blue-600 hover:bg-gray-100'}`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
