'use client';

import { useEffect, useState } from 'react';
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
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const id = `md-mermaid-${index}-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, content);
          if (!cancelled) {
            setSvg(svg);
            setError(null);
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setSvg(null);
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, index, theme, isEmpty]);

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
      ) : error ? (
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
