'use client';

import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Code, Columns, Eye, FileText } from 'lucide-react';
import MermaidBlockPreview from './MermaidBlockPreview';
import { splitMarkdownSegments, renderMarkdownSegment } from '@/lib/markdownRender';

export interface MarkdownEditorProps {
  code: string;
  theme: 'default' | 'dark';
  fileName: string;
  onCodeChange: (newCode: string) => void;
  // Opens the mermaid block at `index` in the diagram editor (the same
  // select-to-edit flow as the Files menu entries).
  onSelectDiagram: (index: number) => void;
}

type MarkdownViewMode = 'edit' | 'split' | 'preview';

const VIEW_MODE_STORAGE_KEY = 'mermaid_md_editor_view';

function loadViewMode(): MarkdownViewMode {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === 'edit' || stored === 'split' || stored === 'preview') return stored;
    } catch {}
  }
  return 'split';
}

// Rich editor for a markdown file: the raw markdown on one side (Monaco) and
// the rendered document on the other — headings, lists, tables, code, and the
// embedded mermaid diagrams rendered as SVGs. The mermaid blocks are
// visualizations only; they are edited by selecting them (click a diagram in
// the preview, or pick it in the Files menu), which opens the diagram editor.
export default function MarkdownEditor({
  code,
  theme,
  fileName,
  onCodeChange,
  onSelectDiagram,
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

  const segments = useMemo(() => splitMarkdownSegments(code), [code]);
  const renderedSegments = useMemo(
    () => segments.map(seg => (seg.type === 'markdown' ? { ...seg, html: renderMarkdownSegment(seg.text) } : seg)),
    [segments],
  );

  const showEditor = viewMode === 'edit' || viewMode === 'split';
  const showPreview = viewMode === 'preview' || viewMode === 'split';

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
            Mermaid diagrams are visualized here — click one (or select it in the Files menu) to edit it.
          </span>
        </div>
        <div className="flex items-center space-x-1 flex-shrink-0">
          {modeButton('edit', Code, 'Edit')}
          {modeButton('split', Columns, 'Split')}
          {modeButton('preview', Eye, 'Preview')}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {showEditor && (
          <div
            data-testid="markdown-source-pane"
            className={`flex-1 min-w-0 min-h-0 ${showPreview ? (isDark ? 'border-r border-slate-800' : 'border-r border-gray-200') : ''}`}
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
              {renderedSegments.length === 0 ? (
                <p className={isDark ? 'text-slate-500 italic' : 'text-gray-400 italic'}>
                  (empty file)
                </p>
              ) : (
                renderedSegments.map((seg, i) =>
                  seg.type === 'markdown' ? (
                    <div
                      key={`text-${i}`}
                      dangerouslySetInnerHTML={{ __html: seg.html }}
                    />
                  ) : (
                    <MermaidBlockPreview
                      key={`mermaid-${seg.startLine}`}
                      content={seg.content}
                      index={seg.index}
                      title={seg.title}
                      startLine={seg.startLine}
                      endLine={seg.endLine}
                      theme={theme}
                      onSelect={() => onSelectDiagram(seg.index)}
                    />
                  ),
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
