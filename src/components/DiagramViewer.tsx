'use client';

import { useEffect, useState, MouseEvent as ReactMouseEvent } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { parseModel } from '@/lib/model';
import { applyArrowStyles, applyNodeColors } from '@/lib/styling';
import { elementKeyAtTarget, svgElementForKey } from '@/lib/svgmap';
import { DiagramConfig } from '@/lib/views';

interface DiagramViewerProps {
  code: string;
  searchQuery: string;
  theme: 'default' | 'dark';
  editMode?: boolean;
  arrowStyles?: DiagramConfig | null;  // resolved config (rewriteArrowStyles); its arrows are applied
  nodeColors?: DiagramConfig | null;   // raw config; actors colors applied to flowchart nodes
  selection?: string | null;           // selected processed element key
  onSelect?: (key: string | null) => void;
}

export default function DiagramViewer({
  code,
  searchQuery,
  theme,
  editMode = false,
  arrowStyles = null,
  nodeColors = null,
  selection = null,
  onSelect,
}: DiagramViewerProps) {
  const [svgStr, setSvgStr] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme });
  }, [theme]);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        setError(null);
        // Add a random ID to prevent caching issues if code changes but ID doesn't
        const id = `mermaid-svg-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        // Post-process: arrow styles + flowchart node colors (both no-op when absent)
        const model = parseModel(code);
        let styled = applyArrowStyles(svg, model, arrowStyles);
        styled = applyNodeColors(styled, nodeColors);
        if (isMounted) {
          setSvgStr(styled);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const e = err as Error;
          setError(e.message || 'Error rendering diagram');
        }
      }
    };
    if (code) {
      renderDiagram();
    }
    return () => {
      isMounted = false;
    };
  }, [code, theme, arrowStyles, nodeColors]);

  useEffect(() => {
    if (svgStr && searchQuery) {
      const container = document.getElementById('diagram-container');
      if (container) {
        const textNodes = container.querySelectorAll('text');
        textNodes.forEach((node) => {
          const content = node.textContent?.toLowerCase() || '';
          if (searchQuery && content.includes(searchQuery.toLowerCase())) {
            node.style.fill = 'red';
            node.style.fontWeight = 'bold';
          } else {
            node.style.fill = '';
            node.style.fontWeight = 'normal';
          }
        });
      }
    }
  }, [svgStr, searchQuery]);

  // Selection highlight: re-applied after every render via the zip (plan 4.7).
  // Coexists with the search highlight (different elements/properties).
  useEffect(() => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    container.querySelectorAll('.editor-selected').forEach(el => el.classList.remove('editor-selected'));
    if (!editMode || !selection) return;
    const svgRoot = container.querySelector('svg');
    if (!svgRoot) return;
    const el = svgElementForKey(svgRoot, parseModel(code), selection);
    if (el) el.classList.add('editor-selected');
  }, [svgStr, selection, editMode, code]);

  // Click delegation: in edit mode, resolve the target to a processed element
  // key (null = empty space -> deselect).
  const handleDiagramClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editMode || !onSelect) return;
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!svgRoot) return;
    const key = elementKeyAtTarget(e.target as Element, svgRoot, parseModel(code));
    onSelect(key);
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-white  rounded border border-gray-200 ">
      {error && (
        <div className="absolute top-0 left-0 w-full bg-red-100 text-red-600 p-2 z-10 text-sm overflow-auto max-h-32">
          {error}
        </div>
      )}
      <div
        id="diagram-container"
        className={`w-full h-full ${editMode ? 'cursor-pointer' : ''}`}
        onClick={handleDiagramClick}
      >
        <TransformWrapper>
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center p-8">
            {svgStr && <div dangerouslySetInnerHTML={{ __html: svgStr }} />}
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  );
}
