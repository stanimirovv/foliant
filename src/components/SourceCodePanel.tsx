'use client';

import React, { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Code, Eye, Copy, Check, AlertCircle } from 'lucide-react';

export interface SourceCodePanelProps {
  code: string;
  isVisualEditMode: boolean;
  changedLines?: number[];
  theme: 'default' | 'dark';
  validationError?: string | null;
  onCodeChange: (newCode: string) => void;
  onSwitchToCodeMode: () => void;
  onSwitchToVisualMode: () => void;
  onCopy?: () => void;
  viewName?: string | null;
  onExitView?: () => void;
}

type MonacoEditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

export default function SourceCodePanel({
  code,
  isVisualEditMode,
  changedLines = [],
  theme,
  validationError = null,
  onCodeChange,
  onSwitchToCodeMode,
  onSwitchToVisualMode,
  onCopy,
  viewName = null,
  onExitView,
}: SourceCodePanelProps) {
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const decorationsRef = useRef<string[]>([]);

  const isDark = theme === 'dark';
  const isReadOnly = Boolean(viewName) || isVisualEditMode;
  const isReadOnlyRef = useRef(isReadOnly);
  isReadOnlyRef.current = isReadOnly;
  const codeRef = useRef(code);
  codeRef.current = code;
  const viewNameRef = useRef(viewName);
  viewNameRef.current = viewName;
  const isVisualEditModeRef = useRef(isVisualEditMode);
  isVisualEditModeRef.current = isVisualEditMode;
  const onSwitchToCodeModeRef = useRef(onSwitchToCodeMode);
  onSwitchToCodeModeRef.current = onSwitchToCodeMode;

  const handleCopy = async () => {
    if (onCopy) {
      onCopy();
    } else {
      try {
        await navigator.clipboard.writeText(code);
      } catch {}
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidFocusEditorText(() => {
      if (!viewNameRef.current && isVisualEditModeRef.current) {
        onSwitchToCodeModeRef.current();
      }
    });

    // Apply decorations if already mounted with changed lines
    if (changedLines.length > 0) {
      const newDecorations = changedLines.map((lineNum) => ({
        range: new monaco.Range(lineNum, 1, lineNum, 1),
        options: {
          isWholeLine: true,
          className: 'diff-line-changed',
          linesDecorationsClassName: 'diff-gutter-changed',
          overviewRuler: {
            color: 'rgba(16, 185, 129, 0.7)',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      }));
      decorationsRef.current = editor.deltaDecorations([], newDecorations);
      editor.revealLineInCenter(changedLines[0]);
    }
  };

  // Re-apply decorations whenever changedLines updates
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (changedLines.length > 0) {
      const newDecorations = changedLines.map((lineNum) => ({
        range: new monaco.Range(lineNum, 1, lineNum, 1),
        options: {
          isWholeLine: true,
          className: 'diff-line-changed',
          linesDecorationsClassName: 'diff-gutter-changed',
          overviewRuler: {
            color: 'rgba(16, 185, 129, 0.7)',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      }));
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
      editor.revealLineInCenter(changedLines[0]);
    } else {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
    }
  }, [changedLines]);

  const handleCodeChange = (value: string | undefined) => {
    if (isReadOnlyRef.current) return;
    if (value !== undefined && value !== codeRef.current) {
      onCodeChange(value);
    }
  };

  return (
    <div
      data-testid="source-code-panel"
      className={`h-full flex flex-col ${
        isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-gray-900'
      }`}
    >
      {/* Top Header / Mode Bar */}
      <div
        className={`px-3 py-2 border-b flex items-center justify-between text-xs ${
          isDark ? 'border-slate-800 bg-slate-900/90' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="flex items-center space-x-2">
          {viewName ? (
            <span
              data-testid="code-mode-badge"
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30 flex items-center space-x-1"
            >
              <Eye size={12} />
              <span>Read-only (View: {viewName})</span>
            </span>
          ) : isVisualEditMode ? (
            <span
              data-testid="code-mode-badge"
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            >
              Read-only (Visual Mode)
            </span>
          ) : (
            <span
              data-testid="code-mode-badge"
              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-500 dark:text-amber-400 animate-pulse flex items-center space-x-1"
            >
              <span>Code Hand-Editing</span>
            </span>
          )}
          {changedLines.length > 0 && (
            <span
              data-testid="changed-lines-counter"
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              <span>{changedLines.length} changed</span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={handleCopy}
            title={viewName ? `Copy Mermaid for view "${viewName}"` : "Copy Mermaid source"}
            data-testid="source-panel-copy"
            className={`p-1.5 rounded border transition-colors ${
              isDark
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                : 'border-gray-200 text-gray-700 hover:bg-gray-100'
            }`}
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>

          {viewName ? (
            <span
              data-testid="view-mode-indicator"
              className="text-[11px] text-gray-500 dark:text-slate-400 italic px-1"
              title="Exit view to edit diagram code"
            >
              View mode
            </span>
          ) : isVisualEditMode ? (
            <button
              onClick={onSwitchToCodeMode}
              data-testid="switch-to-code-mode"
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              <Code size={13} />
              <span>Edit Code</span>
            </button>
          ) : (
            <button
              onClick={onSwitchToVisualMode}
              data-testid="switch-to-visual-mode"
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
            >
              <Eye size={13} />
              <span>Visual Edit</span>
            </button>
          )}
        </div>
      </div>

      {/* View Mode Notice Banner */}
      {viewName && (
        <div
          data-testid="view-source-notice"
          className={`px-3 py-2 border-b text-xs flex items-center justify-between ${
            isDark ? 'bg-blue-950/40 border-blue-800/60 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Eye size={14} className="flex-shrink-0 text-blue-500" />
            <span>
              Displaying view <strong>&quot;{viewName}&quot;</strong>. The source code is read-only. Copying will copy this view.
            </span>
          </div>
          {onExitView && (
            <button
              onClick={onExitView}
              data-testid="exit-view-source-btn"
              className="ml-2 px-2 py-0.5 rounded text-[11px] font-medium border border-blue-400/40 hover:bg-blue-500/10 transition-colors whitespace-nowrap"
            >
              Exit View
            </button>
          )}
        </div>
      )}

      {/* Validation Error Banner */}
      {validationError && (
        <div
          data-testid="code-validation-error"
          className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-red-500 dark:text-red-400 text-xs flex items-start space-x-2 animate-in fade-in"
        >
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1 overflow-hidden">
            <div className="font-semibold">Mermaid Syntax Error</div>
            <div className="text-[11px] opacity-90 break-words mt-0.5">{validationError}</div>
          </div>
        </div>
      )}

      {/* Code Editor Container */}
      <div
        className="flex-1 min-h-0 relative"
        onClick={() => {
          if (!viewName && isVisualEditMode) {
            onSwitchToCodeMode();
          }
        }}
      >
        <Editor
          height="100%"
          language="markdown"
          theme={isDark ? 'vs-dark' : 'light'}
          value={code}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          options={{
            readOnly: isReadOnly,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            fontSize: 13,
            tabSize: 2,
            renderLineHighlight: isReadOnly ? 'none' : 'line',
            glyphMargin: true,
            domReadOnly: isReadOnly,
          }}
        />
      </div>
    </div>
  );
}
