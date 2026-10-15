'use client';

import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Code, Eye, FileText, Undo2, Redo2 } from 'lucide-react';
import WYSIWYGEditor from './WYSIWYGEditor';
import { DiagramViewSelection } from '@/lib/diagramView';

export interface MarkdownEditorProps {
  code: string;
  theme: 'default' | 'dark';
  fileName: string;
  onCodeChange: (newCode: string) => void;
  // WYSIWYG edits (with undo) — wired to commitEdit in ClientPage.
  onMarkdownEdit?: (newCode: string) => void;
  // Undo/redo for WYSIWYG edits (shown in Preview mode).
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // Opens the mermaid block at `index` in the diagram editor (the same
  // select-to-edit flow as the Files menu entries).
  onSelectDiagram: (index: number) => void;
  // Per-block view/tag selections for the mermaid preview controls (driven
  // by the mdview/mdhide URL params in ClientPage).
  viewStates?: Map<number, DiagramViewSelection>;
  onViewStateChange?: (index: number, selection: DiagramViewSelection) => void;
}

type MarkdownViewMode = 'edit' | 'preview';

const VIEW_MODE_STORAGE_KEY = 'mermaid_md_editor_view';

function loadViewMode(): MarkdownViewMode {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      // 'split' was removed — migrate a stored preference to 'preview'.
      if (stored === 'split') return 'preview';
      if (stored === 'edit' || stored === 'preview') return stored;
    } catch {}
  }
  return 'preview';
}

// Rich editor for a markdown file with two modes: Edit shows the raw markdown
// in Monaco; Preview shows the WYSIWYG document — headings, lists, tables,
// code rendered as styled blocks you can click to edit inline, and the
// embedded mermaid diagrams rendered as SVGs. The mermaid blocks are edited
// by selecting them (click a diagram in the preview, or pick it in the Files
// menu), which opens the diagram editor.
export default function MarkdownEditor({
  code,
  theme,
  fileName,
  onCodeChange,
  onMarkdownEdit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSelectDiagram,
  viewStates,
  onViewStateChange,
}: MarkdownEditorProps) {
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(loadViewMode);
  const isDark = theme === 'dark';

  const setMode = (mode: MarkdownViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
      } catch {}
    }
  };

  const showEditor = viewMode === 'edit';
  const showPreview = viewMode === 'preview';

  const modeButton = (mode: MarkdownViewMode, Icon: typeof Code, label: string) => (
    <button
      onClick={() => setMode(mode)}
      data-testid={`markdown-mode-${mode}`}
      title={label}
      className={`flex items-center space-x-1 px-2.5 py-1 rounded transition-colors ${
        viewMode === mode
          ? (isDark ? 'bg-slate-800 text-blue-400 font-semibold shadow-sm' : 'bg-white text-blue-600 font-semibold shadow-sm')
          : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-900')
      }`}
    >
      <Icon size={13} />
      <span>{label}</span>
    </button>
  );

  return (
    <div
      data-testid="markdown-editor"
      className={`h-full flex flex-col ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-white text-gray-900'}`}
    >
      {/* Toolbar */}
      <div
        data-testid="markdown-editor-toolbar"
        className={`flex items-center justify-between border-b px-2 py-1.5 text-xs select-none ${
          isDark ? 'border-slate-800 bg-slate-900' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="flex items-center space-x-2 min-w-0">
          <span
            className={`flex items-center space-x-1.5 px-2 py-1 rounded border ${
              isDark ? 'border-slate-700 text-slate-200 bg-slate-800/60' : 'border-gray-200 text-gray-700 bg-white'
            }`}
          >
            <FileText size={12} className="flex-shrink-0" />
            <span className="font-medium truncate">{fileName}</span>
          </span>
          <span
            className={`hidden md:inline ${isDark ? 'text-slate-500' : 'text-gray-400'}`}
          >
            Click any block to edit it inline — mermaid diagrams open in the diagram editor.
          </span>
        </div>
        <div className="flex items-center space-x-1 flex-shrink-0">
          {onUndo && onRedo && viewMode !== 'edit' && (
            <>
              <button
                onClick={onUndo}
                disabled={!canUndo}
                data-testid="markdown-undo"
                title="Undo (WYSIWYG edits)"
                className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
                  canUndo
                    ? (isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-200')
                    : (isDark ? 'text-slate-600 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed')
                }`}
              >
                <Undo2 size={13} />
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                data-testid="markdown-redo"
                title="Redo (WYSIWYG edits)"
                className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
                  canRedo
                    ? (isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-200')
                    : (isDark ? 'text-slate-600 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed')
                }`}
              >
                <Redo2 size={13} />
              </button>
              <span className={`mx-1 ${isDark ? 'text-slate-700' : 'text-gray-300'}`}>|</span>
            </>
          )}
          {modeButton('edit', Code, 'Edit')}
          {modeButton('preview', Eye, 'Preview')}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {showEditor && (
          <div
            data-testid="markdown-source-pane"
            className="flex-1 min-w-0 min-h-0"
          >
            <Editor
              height="100%"
              language="markdown"
              theme={isDark ? 'vs-dark' : 'light'}
              value={code}
              onChange={(value) => {
                if (value !== undefined) onCodeChange(value);
              }}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                fontSize: 13,
                tabSize: 2,
              }}
            />
          </div>
        )}
        {showPreview && (
          <div
            data-testid="markdown-preview-pane"
            className={`flex-1 min-w-0 overflow-y-auto ${isDark ? 'theme-dark bg-slate-950' : 'bg-white'}`}
          >
            <div
              data-testid="markdown-preview"
              className="markdown-body mx-auto max-w-4xl px-6 py-6"
            >
              <WYSIWYGEditor
                code={code}
                theme={theme}
                onCodeChange={onCodeChange}
                onMarkdownEdit={onMarkdownEdit ?? onCodeChange}
                onSelectDiagram={onSelectDiagram}
                viewStates={viewStates}
                onViewStateChange={onViewStateChange}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
