'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Pencil, Play } from 'lucide-react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { collectAvailableKeys, parseViewsData } from '@/lib/views';
import {
  DiagramViewSelection,
  EMPTY_DIAGRAM_VIEW_SELECTION,
  findSavedView,
  renderDiagramWithView,
} from '@/lib/diagramView';
import { WALKTHROUGH_MIN_ZOOM, WALKTHROUGH_MAX_ZOOM } from '@/lib/walkthrough';
import { useWalkthroughPlayback } from '@/lib/useWalkthroughPlayback';
import { applyNodeColors } from '@/lib/styling';
import WalkthroughBar from './WalkthroughBar';

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
  // Per-block view/tag selection for the preview controls. When provided and
  // the block's CONFIG has saved views or tags, the header bar shows a view
  // dropdown and tag toggle chips, and the rendered SVG applies the selection
  // (the same pipeline the diagram editor uses). Never writes to the file.
  viewState?: DiagramViewSelection;
  onViewStateChange?: (selection: DiagramViewSelection) => void;
  // One-shot scroll request (the diagram editor's "Back to markdown"
  // button): when true, scroll this block into view once it has settled
  // (rendered, or in an error/empty state — those have no async height),
  // then report back through onScrolled.
  scrollToMe?: boolean;
  onScrolled?: () => void;
}

export { looksLikeMermaidDiagram, MERMAID_DIAGRAM_KEYWORDS } from '@/lib/model';
import { looksLikeMermaidDiagram } from '@/lib/model';

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
  viewState,
  onViewStateChange,
  scrollToMe,
  onScrolled,
}: MermaidBlockPreviewProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const blockTransformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  // Last successful render for the current block, kept across failed renders.
  const lastGoodRef = useRef<string | null>(null);
  // Scroll request state: the wrapper element and whether the one-shot
  // scroll has already been handled.
  const blockRef = useRef<HTMLDivElement>(null);
  const scrollHandledRef = useRef(false);

  const isDark = theme === 'dark';
  const isEmpty = content.trim().length === 0;
  // Guard: content that is not a mermaid diagram (e.g. markdown prose leaked
  // in by an upstream bug) is never passed to mermaid.render.
  const isNotDiagram = !isEmpty && !looksLikeMermaidDiagram(content);

  // The block's own CONFIG (views, tags) drives the preview controls and the
  // render pipeline.
  const config = useMemo(() => parseViewsData(content), [content]);
  const views = useMemo(() => config?.views ?? [], [config]);
  // Subgraph tags are structural (derived from the block's own code), so they
  // appear as hide toggles even when the block has no %% CONFIG line.
  const availableKeys = useMemo(() => collectAvailableKeys(config, content), [config, content]);
  const showViewControls = Boolean(onViewStateChange) && (views.length > 0 || availableKeys.length > 0);

  // The render input: the raw block processed with the selected view / hidden
  // tags. Without a selection and without a CONFIG, the raw content renders
  // unchanged.
  const renderInput = useMemo(
    () => renderDiagramWithView(content, config, viewState ?? EMPTY_DIAGRAM_VIEW_SELECTION),
    [content, config, viewState],
  );

  const walkthrough = useWalkthroughPlayback({
    code: renderInput.code,
    config,
    containerId: `md-mermaid-svg-host-${index}`,
    transformRef: presenting ? blockTransformRef : undefined,
    enabled: presenting,
    svgVersion: svg,
    onExit: () => setPresenting(false),
  });

  const svgInnerHtml = useMemo(() => (svg ? { __html: svg } : undefined), [svg]);

  // The view active in this block (null when the selection names no saved
  // view of this block). Its stored state drives the render; the chips show
  // its hidden tags so a chip click can exit the view from that state.
  const activeView = findSavedView(config, viewState?.viewName);
  const effectiveHideKeys = activeView?.hideKeys ?? viewState?.hideKeys ?? [];

  const handleSelectView = (name: string) => {
    if (!onViewStateChange) return;
    if (!name) {
      // Back to the full diagram (mirrors deselectView: drop the filter state).
      onViewStateChange({ viewName: null, hideKeys: [] });
      return;
    }
    const view = views.find(v => v.name === name);
    onViewStateChange({ viewName: name, hideKeys: view?.hideKeys ?? [] });
  };

  const handleToggleKey = (key: string) => {
    if (!onViewStateChange) return;
    const next = new Set(effectiveHideKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // A manual tag toggle exits view mode (mirrors setActorState clearing the
    // active view in the diagram editor).
    onViewStateChange({ viewName: null, hideKeys: Array.from(next) });
  };

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
    if (isNotDiagram) {
      if (lastGoodRef.current !== null) {
        // While typing or editing, a diagram may temporarily lack a diagram keyword.
        // Keep the last good render on screen and show a syntax-error chip.
        setError('No diagram type detected');
        return;
      }
      setSvg(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const id = `md-mermaid-${index}-${Math.random().toString(36).substr(2, 9)}`;
        try {
          const { svg } = await mermaid.render(id, renderInput.code);
          if (cancelled) return;
          const styled = applyNodeColors(svg, config, theme);
          lastGoodRef.current = styled;
          setSvg(styled);
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
  }, [renderInput.code, index, theme, isEmpty, isNotDiagram]);

  // Scroll-to-diagram request: wait until the block has settled (SVG
  // rendered, or an error/empty state, which have no async height) so the
  // scroll lands after the block — and the blocks above it — have their
  // final heights, then report back so the request is cleared.
  useEffect(() => {
    if (!scrollToMe) {
      scrollHandledRef.current = false;
      return;
    }
    if (scrollHandledRef.current) return;
    const settled = svg !== null || error !== null || isEmpty || isNotDiagram;
    if (!settled) return;
    scrollHandledRef.current = true;
    blockRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onScrolled?.();
  }, [scrollToMe, svg, error, isEmpty, isNotDiagram, onScrolled]);

  // A block that has never rendered successfully gets the full error box;
  // a transient failure keeps the last good render with a small chip.
  const showErrorBox = error !== null && lastGoodRef.current === null;
  // Content that is not a mermaid diagram (upstream bug guard): show a
  // friendly note instead of a mermaid syntax-error diagram.
  const showNotDiagram = isNotDiagram && lastGoodRef.current === null;

  return (
    <div
      ref={blockRef}
      data-testid={`md-mermaid-block-${index}`}
      className={`md-mermaid-block group ${
        isDark ? 'border-slate-700 bg-slate-900/60' : 'border-gray-200 bg-gray-50'
      }`}
      title="Click to open this diagram in the editor"
      onClick={() => {
        if (!presenting) onSelect();
      }}
    >
      <div
        className={`md-mermaid-block-bar ${isDark ? 'text-slate-400 border-slate-700' : 'text-gray-500 border-gray-200'}`}
      >
        <span className="font-medium truncate">{title}</span>
        <span className="flex-shrink-0">Diagram {index + 1} · lines {startLine}–{endLine}</span>
        {showViewControls && (
          <div
            className="md-mermaid-view-controls"
            data-testid={`md-mermaid-view-controls-${index}`}
            // The block opens the diagram editor on click; the controls must
            // not trigger that.
            onClick={(e) => e.stopPropagation()}
          >
            {views.length > 0 && (
              <select
                data-testid={`md-mermaid-view-select-${index}`}
                className="md-mermaid-view-select"
                value={activeView?.name ?? ''}
                onChange={(e) => handleSelectView(e.target.value)}
                title="Apply a saved view to this diagram"
              >
                <option value="">All (default)</option>
                {views.map(v => (
                  <option key={v.name} value={v.name}>{v.name}</option>
                ))}
              </select>
            )}
            {availableKeys.map(k => {
              const off = effectiveHideKeys.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  data-testid={`md-mermaid-tag-${index}-${k}`}
                  data-state={off ? 'off' : 'on'}
                  className={`md-mermaid-tag-chip${off ? ' md-mermaid-tag-off' : ''}`}
                  onClick={() => handleToggleKey(k)}
                  title={off ? `Show elements tagged "${k}"` : `Hide elements tagged "${k}"`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        )}
        {!isEmpty && !isNotDiagram && !showErrorBox && walkthrough.plan && (
          <button
            type="button"
            data-testid={`md-mermaid-present-${index}`}
            className="md-mermaid-tag-chip inline-flex items-center gap-1"
            title="Present this diagram step-by-step (←/→, Space, Esc)"
            onClick={(e) => {
              e.stopPropagation();
              setPresenting((p) => !p);
            }}
          >
            <Play size={11} />
            <span>{presenting ? 'Stop' : 'Present'}</span>
          </button>
        )}
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
      ) : showNotDiagram ? (
        <div
          data-testid={`md-mermaid-not-diagram-${index}`}
          className={`md-mermaid-empty ${isDark ? 'text-slate-500' : 'text-gray-400'}`}
        >
          (not a mermaid diagram — select it to edit)
        </div>
      ) : showErrorBox ? (
        <div data-testid={`md-mermaid-error-${index}`} className="md-mermaid-error">
          <p className="md-mermaid-error-message">Diagram failed to render: {error}</p>
          <pre className="md-mermaid-error-source">{content}</pre>
        </div>
      ) : svg && svgInnerHtml ? (
        presenting ? (
          <div
            id={`md-mermaid-svg-host-${index}`}
            data-testid={`md-mermaid-svg-${index}`}
            className={`relative h-[70vh] overflow-hidden rounded border ${
              isDark ? 'border-slate-700' : 'border-gray-200'
            }`}
          >
            <TransformWrapper
              ref={blockTransformRef}
              minScale={WALKTHROUGH_MIN_ZOOM}
              maxScale={WALKTHROUGH_MAX_ZOOM}
              doubleClick={{ disabled: true }}
            >
              <TransformComponent
                wrapperClass="!w-full !h-full"
                contentClass="!w-full !h-full flex items-center justify-center p-4"
              >
                <div dangerouslySetInnerHTML={svgInnerHtml} />
              </TransformComponent>
            </TransformWrapper>
            {walkthrough.plan && (
              <WalkthroughBar
                theme={theme}
                stepIndex={walkthrough.activeIndex}
                totalSteps={walkthrough.plan.steps.length}
                label={walkthrough.plan.steps[walkthrough.activeIndex]?.label}
                isPlaying={walkthrough.isPlaying}
                onPrev={walkthrough.prev}
                onNext={walkthrough.next}
                onTogglePlay={walkthrough.togglePlay}
                onExit={walkthrough.exit}
              />
            )}
          </div>
        ) : (
          <div
            id={`md-mermaid-svg-host-${index}`}
            data-testid={`md-mermaid-svg-${index}`}
            className="md-mermaid-svg"
            dangerouslySetInnerHTML={svgInnerHtml}
          />
        )
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
