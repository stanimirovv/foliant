'use client';

import { useEffect, useState } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

interface DiagramViewerProps {
  code: string;
  searchQuery: string;
  theme: 'default' | 'dark';
}

export default function DiagramViewer({ code, searchQuery, theme }: DiagramViewerProps) {
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
        if (isMounted) {
          setSvgStr(svg);
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
  }, [code, theme]);

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

  return (
    <div className="w-full h-full relative overflow-hidden bg-white  rounded border border-gray-200 ">
      {error && (
        <div className="absolute top-0 left-0 w-full bg-red-100 text-red-600 p-2 z-10 text-sm overflow-auto max-h-32">
          {error}
        </div>
      )}
      <div id="diagram-container" className="w-full h-full">
        <TransformWrapper>
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center p-8">
            {svgStr && <div dangerouslySetInnerHTML={{ __html: svgStr }} />}
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  );
}
