'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Pencil } from 'lucide-react';

export interface MermaidBlockPreviewProps {
  content: string;
  index: number;
  title: string;
  startLine: number;
  endLine: number;
  theme: 'default' | 'dark';
  // Selecting the block opens the diagram in the diagram editor (the same
  // select-to-edit flow as the Files menu).
  onSelect: () => void;
}

// Renders one embedded mermaid block inside the markdown preview. The block is
// a visualization only: editing happens by selecting the diagram (click, or
// the Files menu), which opens it in the diagram editor. Render is debounced
// so typing in the markdown source does not re-render the SVG on every
// keystroke.
//
// Failure handling: while the user types, a block is often transiently
// invalid mermaid. A failed render therefore never replaces the diagram —
// the last successful render stays on screen with a small syntax-error chip
// (the error message is on the chip's tooltip). Only a block that has NEVER
// rendered successfully shows the full error box with the raw source, so a
// genuinely broken block is still diagnosable.
export default function MermaidBlockPreview({
  content,
  index,
  title,
  startLine,
  endLine,
  theme,
  onSelect,
}: MermaidBlockPreviewProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Last successful render for the current block, kept across failed renders.
  const lastGoodRef = useRef<string | null>(null);

  const isDark = theme === 'dark';
  const isEmpty = content.trim().length === 0;

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      themeVariables: theme === 'dark' ? {
        darkMode: true,
        background: '#090d16',
        mainBkg: '#0f172a',
        actorBkg: '#1e293b',
        actorBorder: '#3b82f6',
        actorTextColor: '#f8fafc',
        actorLineColor: '#334155',
        signalColor: '#94a3b8',
        signalTextColor: '#f8fafc',
        labelBoxBkgColor: '#1e293b',
        labelBoxBorderColor: '#334155',
        labelTextColor: '#f8fafc',
        loopTextColor: '#f8fafc',
        noteBkgColor: '#1e293b',
        noteBorderColor: '#334155',
        noteTextColor: '#f8fafc',
        activationBorderColor: '#3b82f6',
        activationBkgColor: '#1e293b',
        sequenceNumberColor: '#f8fafc',
        rectBorder: '#334155',
        nodeBorder: '#3b82f6',
        primaryColor: '#1e293b',
        primaryBorderColor: '#3b82f6',
        primaryTextColor: '#f8fafc',
        lineColor: '#334155',
      } : undefined,
    });
  }, [theme]);

  useEffect(() => {
    if (isEmpty) {
      setSvg(null);
      setError(null);
      lastGoodRef.current = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const id = `md-mermaid-${index}-${Math.random().toString(36).substr(2, 9)}`;
        try {
          const { svg } = await mermaid.render(id, content);
          if (cancelled) return;
          lastGoodRef.current = svg;
          setSvg(svg);
          setError(null);
        } catch (err: unknown) {
          // mermaid 12 renders parse failures into a temp element
          // (#d<id>, appended to document.body) and only removes it on
          // success — remove it here so failed renders during typing do
          // not accumulate stray error diagrams on the page.
          if (typeof document !== 'undefined') {
            document.getElementById(`d${id}`)?.remove();
          }
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          if (!lastGoodRef.current) {
            // Never rendered successfully: drop the diagram so the error
            // box (with the raw source) is shown instead.
            setSvg(null);
          }
          // Otherwise keep `svg` (the last good render) on screen.
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, index, theme, isEmpty]);

  // A block that has never rendered successfully gets the full error box;
  // a transient failure keeps the last good render with a small chip.
  const showErrorBox = error !== null && lastGoodRef.current === null;

  return (
    <div
      data-testid={`md-mermaid-block-${index}`}
      className={`md-mermaid-block group ${
        isDark ? 'border-slate-700 bg-slate-900/60' : 'border-gray-200 bg-gray-50'
      }`}
      title="Click to open this diagram in the editor"
      onClick={onSelect}
    >
      <div
        className={`md-mermaid-block-bar ${isDark ? 'text-slate-400 border-slate-700' : 'text-gray-500 border-gray-200'}`}
      >
        <span className="font-medium truncate">{title}</span>
        <span className="flex-shrink-0">Diagram {index + 1} · lines {startLine}–{endLine}</span>
        {error !== null && (
          <span
            data-testid={`md-mermaid-error-chip-${index}`}
            className="md-mermaid-error-chip"
            title={error}
          >
            Syntax error{lastGoodRef.current !== null ? ' — showing the last successful render' : ''}
          </span>
        )}
        <span
          className={`md-mermaid-edit-chip ${isDark ? 'text-blue-300' : 'text-blue-600'}`}
        >
          <Pencil size={11} />
          <span>Click to edit</span>
        </span>
      </div>
      {isEmpty ? (
        <div
          data-testid={`md-mermaid-empty-${index}`}
          className={`md-mermaid-empty ${isDark ? 'text-slate-500' : 'text-gray-400'}`}
        >
          (empty diagram)
        </div>
      ) : showErrorBox ? (
        <div data-testid={`md-mermaid-error-${index}`} className="md-mermaid-error">
          <p className="md-mermaid-error-message">Diagram failed to render: {error}</p>
          <pre className="md-mermaid-error-source">{content}</pre>
        </div>
      ) : svg ? (
        <div
          data-testid={`md-mermaid-svg-${index}`}
          className="md-mermaid-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          data-testid={`md-mermaid-loading-${index}`}
          className={`md-mermaid-loading ${isDark ? 'text-slate-500' : 'text-gray-400'}`}
        >
          Rendering…
        </div>
      )}
    </div>
  );
}
