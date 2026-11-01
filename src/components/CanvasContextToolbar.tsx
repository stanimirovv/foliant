'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Trash2,
  MessageSquareWarning,
  Sparkles,
  Box,
  Layers,
  FolderGit2,
  Minimize2,
  X,
} from 'lucide-react';
import {
  ModelElement,
  ParticipantElement,
  NodeElement,
  MessageElement,
  EdgeElement,
  BlockType,
  DiagramType,
  NodeShape,
  ParticipantType,
  NotePlacement,
} from '@/lib/model';
import {
  ArrowStylePatch,
  getPresetActorColors,
  resolveActorColorForTheme,
} from '@/lib/editor';
import {
  DiagramConfig,
  ArrowAnimationType,
  StickyNote,
  StickyNoteColor,
} from '@/lib/views';
import { ANIMATED_ARROW_PRESETS, ANIMATED_ARROW_COLORS } from '@/lib/styling';
import { NOTE_COLORS, STICKY_NOTE_COLOR_KEYS } from './StickyNote';
import { WrapCheck, colorToHex } from './EditorPanel';

const SEQUENCE_QUICK_OPERATORS = ['->>', '-->>', '->', '-->', '-x', '--x', '-)', '--)'];
const FLOWCHART_QUICK_OPERATORS = ['-->', '-.->', '==>', '---', '<-->', 'x--x', 'o--o'];
const DASH_OPTIONS = ['solid', 'dashed', 'dotted'] as const;

export interface CanvasContextToolbarProps {
  selectedElements: ModelElement[];
  diagramType: DiagramType;
  theme: 'default' | 'dark';
  config: DiagramConfig | null;
  arrowStyle: ArrowStylePatch | null;
  wrapChecks?: { block: WrapCheck; region: WrapCheck } | null;
  onSetColor: (color: string) => void;
  onSetType: (operator: string) => void;
  onSetDash: (dash: 'solid' | 'dashed' | 'dotted') => void;
  onSetAnimation: (anim: ArrowAnimationType) => void;
  onSetParticipantKind?: (kind: ParticipantType) => void;
  onSetNodeShape?: (shape: NodeShape) => void;
  onAddSequenceNote?: () => void;
  onSetNotePlacement?: (placement: NotePlacement) => void;
  onSetBlockType?: (blockType: BlockType) => void;
  onUnwrapBlock?: () => void;
  onUpdateStickyNote?: (id: string, patch: Partial<Omit<StickyNote, 'id'>>) => void;
  onGroupParticipants?: (participantKeys: string[], title: string, color?: string) => void;
  onGroupNodes?: (nodeKeys: string[], title: string) => void;
  onWrapInBlock?: (blockType: BlockType, title?: string) => void;
  onWrapInRegion?: (type: string, value?: string) => void;
  onRequestDelete: () => void;
}

export default function CanvasContextToolbar({
  selectedElements,
  diagramType,
  theme,
  config,
  arrowStyle,
  wrapChecks,
  onSetColor,
  onSetType,
  onSetDash,
  onSetAnimation,
  onSetParticipantKind,
  onSetNodeShape,
  onAddSequenceNote,
  onSetNotePlacement,
  onSetBlockType,
  onUnwrapBlock,
  onUpdateStickyNote,
  onGroupParticipants,
  onGroupNodes,
  onWrapInBlock,
  onWrapInRegion,
  onRequestDelete,
}: CanvasContextToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [groupTitlePrompt, setGroupTitlePrompt] = useState<{
    mode: 'box' | 'subgraph' | 'region';
    value: string;
  } | null>(null);

  const selectionKeySignature = selectedElements.map((e) => e.key).join('|');

  useEffect(() => {
    setGroupTitlePrompt(null);
  }, [selectionKeySignature]);

  useEffect(() => {
    if (selectedElements.length === 0) {
      setCoords(null);
      return;
    }

    const updatePosition = () => {
      const container = document.getElementById('diagram-container');
      const parent = toolbarRef.current?.parentElement;
      if (!container || !parent) {
        setCoords(null);
        return;
      }

      const parentRect = parent.getBoundingClientRect();
      if (parentRect.width <= 0 || parentRect.height <= 0) {
        setCoords(null);
        return;
      }

      const selectedDomNodes = Array.from(
        container.querySelectorAll('.editor-selected'),
      );
      // Include selected sticky notes if any
      for (const el of selectedElements) {
        if (el.kind === 'sticky') {
          const wrapper = container.querySelector(
            `[data-testid="sticky-note-wrapper-${el.id}"]`,
          );
          if (wrapper) selectedDomNodes.push(wrapper);
        }
      }

      let minLeft = Infinity;
      let minTop = Infinity;
      let maxRight = -Infinity;
      let maxBottom = -Infinity;

      for (const node of selectedDomNodes) {
        const r = node.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;
        if (r.left < minLeft) minLeft = r.left;
        if (r.top < minTop) minTop = r.top;
        if (r.right > maxRight) maxRight = r.right;
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      }

      if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
        setCoords(null);
        return;
      }

      const toolbarWidth = toolbarRef.current?.offsetWidth || 280;
      const halfWidth = toolbarWidth / 2;
      const rawCenterX = (minLeft + maxRight) / 2 - parentRect.left;
      const clampedLeft = Math.min(
        Math.max(rawCenterX, halfWidth + 12),
        Math.max(halfWidth + 12, parentRect.width - halfWidth - 12),
      );

      let targetTop = minTop - parentRect.top - 48;
      if (targetTop < 12) {
        // Place below the element if too close to the top of the viewport
        const belowTop = maxBottom - parentRect.top + 12;
        targetTop =
          belowTop + 44 < parentRect.height
            ? belowTop
            : Math.max(12, Math.min(parentRect.height - 52, 12));
      }

      setCoords({ left: Math.round(clampedLeft), top: Math.round(targetTop) });
    };

    updatePosition();

    const container = document.getElementById('diagram-container');
    let observer: MutationObserver | null = null;
    if (container && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        updatePosition();
      });
      observer.observe(container, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['style', 'class', 'transform'],
      });
    }

    window.addEventListener('resize', updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [selectionKeySignature, selectedElements]);

  if (selectedElements.length === 0) return null;

  const isDark = theme === 'dark';
  const isMulti = selectedElements.length > 1;
  const single = !isMulti ? selectedElements[0] : null;

  const presetActorColors = getPresetActorColors(theme).slice(0, 6);
  const quickArrowColors = [
    ...ANIMATED_ARROW_COLORS.positive.slice(0, 3).map((c) => c.hex),
    ...ANIMATED_ARROW_COLORS.error.slice(0, 3).map((c) => c.hex),
  ];

  const selectClass = `px-1.5 py-1 text-xs rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
    isDark
      ? 'bg-slate-800 border-slate-700 text-slate-100'
      : 'bg-gray-50 border-gray-200 text-gray-800'
  }`;

  const divider = (
    <div
      className={`w-px h-5 mx-1 flex-shrink-0 ${
        isDark ? 'bg-slate-700' : 'bg-gray-200'
      }`}
    />
  );

  const renderSingleComponentControls = (el: ParticipantElement | NodeElement) => {
    const meta = config?.actors?.[el.id];
    const effectiveColor = meta?.color
      ? resolveActorColorForTheme(meta.color, theme)
      : undefined;

    return (
      <>
        <span
          className="text-[11px] font-mono font-semibold px-1.5 truncate max-w-[100px]"
          title={el.id}
          data-testid="ctx-element-badge"
        >
          {el.id}
        </span>
        {divider}
        {el.kind === 'participant' && onSetParticipantKind && (
          <select
            aria-label="Participant type"
            data-testid="ctx-participant-kind"
            value={el.participantType ?? 'participant'}
            onChange={(e) => onSetParticipantKind(e.target.value as ParticipantType)}
            className={selectClass}
          >
            <option value="participant">Box</option>
            <option value="actor">Actor</option>
            <option value="database">Database</option>
            <option value="queue">Queue</option>
            <option value="boundary">Boundary</option>
            <option value="control">Control</option>
            <option value="entity">Entity</option>
            <option value="collections">Collections</option>
          </select>
        )}
        {el.kind === 'node' && onSetNodeShape && (
          <select
            aria-label="Node shape"
            data-testid="ctx-node-shape"
            value={el.shape ?? 'rect'}
            onChange={(e) => onSetNodeShape(e.target.value as NodeShape)}
            className={selectClass}
          >
            <option value="rect">Rectangle</option>
            <option value="round">Rounded</option>
            <option value="cylinder">Database</option>
            <option value="rhombus">Decision</option>
            <option value="circle">Circle</option>
            <option value="asymmetric">Flag</option>
          </select>
        )}
        {divider}
        <div className="flex items-center space-x-1" data-testid="ctx-color-swatches">
          {presetActorColors.map((swatch) => {
            const active = effectiveColor?.toLowerCase() === swatch.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                data-testid={`ctx-color-swatch-${swatch}`}
                title={`Color ${swatch}`}
                onClick={() => onSetColor(swatch)}
                style={{ backgroundColor: swatch }}
                className={`w-4 h-4 rounded-full border transition-transform ${
                  active
                    ? 'ring-2 ring-blue-500 scale-110 border-white dark:border-slate-900'
                    : 'border-gray-300 dark:border-slate-600 hover:scale-110'
                }`}
              />
            );
          })}
          {meta?.color && (
            <button
              type="button"
              data-testid="ctx-clear-color"
              title="Clear color"
              onClick={() => onSetColor('')}
              className={`p-0.5 rounded text-[10px] border ${
                isDark
                  ? 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              <X size={11} />
            </button>
          )}
        </div>
        {el.kind === 'participant' && onAddSequenceNote && (
          <>
            {divider}
            <button
              type="button"
              data-testid="ctx-add-note"
              title="Add sequence note over participant"
              onClick={onAddSequenceNote}
              className={`flex items-center space-x-1 px-1.5 py-1 text-xs rounded transition-colors ${
                isDark
                  ? 'hover:bg-slate-800 text-slate-200'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              <MessageSquareWarning size={13} />
              <span>+ Note</span>
            </button>
          </>
        )}
      </>
    );
  };

  const renderSingleArrowControls = (el: MessageElement | EdgeElement) => {
    const vocab =
      diagramType === 'flowchart'
        ? FLOWCHART_QUICK_OPERATORS
        : SEQUENCE_QUICK_OPERATORS;
    const operators = vocab.includes(el.operator)
      ? vocab
      : [el.operator, ...vocab];
    const currentAnim = arrowStyle?.animation ?? 'none';

    return (
      <>
        <select
          aria-label="Arrow operator"
          data-testid="ctx-arrow-operator"
          value={el.operator}
          onChange={(e) => onSetType(e.target.value)}
          className={selectClass}
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <select
          aria-label="Arrow dash"
          data-testid="ctx-arrow-dash"
          value={arrowStyle?.dash ?? 'solid'}
          onChange={(e) =>
            onSetDash(e.target.value as 'solid' | 'dashed' | 'dotted')
          }
          className={selectClass}
        >
          {DASH_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {divider}
        <div className="flex items-center space-x-1" data-testid="ctx-arrow-colors">
          {quickArrowColors.map((hex) => {
            const active =
              arrowStyle?.color &&
              colorToHex(arrowStyle.color).toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                data-testid={`ctx-color-swatch-${hex}`}
                title={`Arrow color ${hex}`}
                onClick={() => onSetColor(hex)}
                style={{ backgroundColor: hex }}
                className={`w-4 h-4 rounded-full border transition-transform ${
                  active
                    ? 'ring-2 ring-blue-500 scale-110 border-white dark:border-slate-900'
                    : 'border-gray-300 dark:border-slate-600 hover:scale-110'
                }`}
              />
            );
          })}
          {arrowStyle?.color && (
            <button
              type="button"
              data-testid="ctx-clear-color"
              title="Clear arrow color"
              onClick={() => onSetColor('')}
              className={`p-0.5 rounded text-[10px] border ${
                isDark
                  ? 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  : 'border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              <X size={11} />
            </button>
          )}
        </div>
        {divider}
        <div className="flex items-center space-x-1">
          <Sparkles size={13} className="text-blue-500 flex-shrink-0" />
          <select
            aria-label="Arrow animation"
            data-testid="ctx-arrow-animation"
            value={currentAnim}
            onChange={(e) =>
              onSetAnimation(e.target.value as ArrowAnimationType)
            }
            className={selectClass}
          >
            <option value="none">No Anim</option>
            {ANIMATED_ARROW_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </>
    );
  };

  const renderMultiControls = () => {
    const participants = selectedElements.filter(
      (e): e is ParticipantElement => e.kind === 'participant',
    );
    const nodes = selectedElements.filter(
      (e): e is NodeElement => e.kind === 'node',
    );
    const arrows = selectedElements.filter(
      (e): e is MessageElement | EdgeElement =>
        e.kind === 'message' || e.kind === 'edge',
    );
    const components = selectedElements.filter(
      (e): e is ParticipantElement | NodeElement =>
        e.kind === 'participant' || e.kind === 'node',
    );
    const wrappable = selectedElements.filter(
      (e) => e.kind === 'message' || e.kind === 'note',
    );
    const canWrapBlock =
      diagramType === 'sequence' &&
      wrappable.length >= 2 &&
      Boolean(wrapChecks?.block.ok && onWrapInBlock);
    const canWrapRegion =
      diagramType === 'sequence' &&
      wrappable.length >= 2 &&
      Boolean(wrapChecks?.region.ok && onWrapInRegion);

    const swatches =
      arrows.length > 0 && components.length === 0
        ? quickArrowColors
        : presetActorColors;

    return (
      <>
        <span
          data-testid="ctx-multi-count"
          className="text-xs font-semibold px-1.5 whitespace-nowrap"
        >
          {selectedElements.length} selected
        </span>

        {(arrows.length > 0 || components.length > 0) && (
          <>
            {divider}
            <div
              className="flex items-center space-x-1"
              data-testid="ctx-bulk-colors"
            >
              {swatches.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  data-testid={`ctx-color-swatch-${swatch}`}
                  title={`Bulk color ${swatch}`}
                  onClick={() => onSetColor(swatch)}
                  style={{ backgroundColor: swatch }}
                  className="w-4 h-4 rounded-full border border-gray-300 dark:border-slate-600 hover:scale-110 transition-transform"
                />
              ))}
            </div>
          </>
        )}

        {participants.length >= 2 && onGroupParticipants && (
          <>
            {divider}
            {groupTitlePrompt?.mode === 'box' ? (
              <div className="flex items-center space-x-1">
                <input
                  type="text"
                  data-testid="ctx-group-box-input"
                  autoFocus
                  value={groupTitlePrompt.value}
                  placeholder="Box title..."
                  onChange={(e) =>
                    setGroupTitlePrompt({ mode: 'box', value: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onGroupParticipants(
                        participants.map((p) => p.key),
                        groupTitlePrompt.value.trim() || 'Group',
                      );
                      setGroupTitlePrompt(null);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setGroupTitlePrompt(null);
                    }
                  }}
                  className={`w-24 px-1.5 py-0.5 text-xs rounded border ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-100'
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                />
                <button
                  type="button"
                  data-testid="ctx-group-box-confirm"
                  onClick={() => {
                    onGroupParticipants(
                      participants.map((p) => p.key),
                      groupTitlePrompt.value.trim() || 'Group',
                    );
                    setGroupTitlePrompt(null);
                  }}
                  className="px-2 py-0.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="ctx-group-box"
                onClick={() =>
                  setGroupTitlePrompt({ mode: 'box', value: 'Group' })
                }
                className="flex items-center space-x-1 px-2 py-1 text-xs rounded bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 font-medium"
              >
                <Box size={13} />
                <span>Group Box</span>
              </button>
            )}
          </>
        )}

        {nodes.length >= 2 && onGroupNodes && (
          <>
            {divider}
            {groupTitlePrompt?.mode === 'subgraph' ? (
              <div className="flex items-center space-x-1">
                <input
                  type="text"
                  data-testid="ctx-group-subgraph-input"
                  autoFocus
                  value={groupTitlePrompt.value}
                  placeholder="Subgraph title..."
                  onChange={(e) =>
                    setGroupTitlePrompt({
                      mode: 'subgraph',
                      value: e.target.value,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onGroupNodes(
                        nodes.map((n) => n.key),
                        groupTitlePrompt.value.trim() || 'Subgraph',
                      );
                      setGroupTitlePrompt(null);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setGroupTitlePrompt(null);
                    }
                  }}
                  className={`w-28 px-1.5 py-0.5 text-xs rounded border ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-100'
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                />
                <button
                  type="button"
                  data-testid="ctx-group-subgraph-confirm"
                  onClick={() => {
                    onGroupNodes(
                      nodes.map((n) => n.key),
                      groupTitlePrompt.value.trim() || 'Subgraph',
                    );
                    setGroupTitlePrompt(null);
                  }}
                  className="px-2 py-0.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="ctx-group-subgraph"
                onClick={() =>
                  setGroupTitlePrompt({ mode: 'subgraph', value: 'Subgraph' })
                }
                className="flex items-center space-x-1 px-2 py-1 text-xs rounded bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 font-medium"
              >
                <FolderGit2 size={13} />
                <span>Group Subgraph</span>
              </button>
            )}
          </>
        )}

        {canWrapBlock && (
          <>
            {divider}
            <div className="flex items-center space-x-1" data-testid="ctx-wrap-block-group">
              {(['loop', 'alt', 'opt', 'par'] as BlockType[]).map((bt) => (
                <button
                  key={bt}
                  type="button"
                  data-testid={`ctx-wrap-block-${bt}`}
                  title={`Wrap in ${bt} block`}
                  onClick={() => onWrapInBlock?.(bt, '')}
                  className={`px-1.5 py-0.5 text-[11px] font-mono rounded border transition-colors ${
                    isDark
                      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  +{bt}
                </button>
              ))}
            </div>
          </>
        )}

        {canWrapRegion && (
          <>
            {divider}
            <button
              type="button"
              data-testid="ctx-wrap-region"
              title="Wrap selection in %% @region-start: flow"
              onClick={() => onWrapInRegion?.('flow', 'main')}
              className={`flex items-center space-x-1 px-2 py-0.5 text-xs rounded border transition-colors ${
                isDark
                  ? 'border-blue-700/60 bg-blue-950/40 text-blue-300 hover:bg-blue-900/60'
                  : 'border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100'
              }`}
            >
              <Layers size={12} />
              <span>+Region</span>
            </button>
          </>
        )}
      </>
    );
  };

  return (
    <div
      ref={toolbarRef}
      data-testid="canvas-context-toolbar"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={
        coords
          ? {
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              transform: 'translateX(-50%)',
            }
          : {
              left: '50%',
              top: '12px',
              transform: 'translateX(-50%)',
            }
      }
      className={`absolute z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border shadow-xl backdrop-blur-md select-none transition-[top,left] duration-75 ${
        isDark
          ? 'bg-slate-900/95 border-slate-700 text-slate-100'
          : 'bg-white/95 border-gray-200 text-gray-900'
      }`}
    >
      {isMulti && renderMultiControls()}

      {!isMulti &&
        single &&
        (single.kind === 'participant' || single.kind === 'node') &&
        renderSingleComponentControls(single)}

      {!isMulti &&
        single &&
        (single.kind === 'message' || single.kind === 'edge') &&
        renderSingleArrowControls(single)}

      {!isMulti && single && single.kind === 'note' && (
        <>
          <span className="text-xs font-medium px-1">Note</span>
          {onSetNotePlacement && (
            <select
              aria-label="Note placement"
              data-testid="ctx-note-placement"
              disabled={single.over.length > 1}
              value={single.placement}
              onChange={(e) =>
                onSetNotePlacement(e.target.value as NotePlacement)
              }
              className={selectClass}
            >
              <option value="over">over</option>
              <option value="left of">left of</option>
              <option value="right of">right of</option>
            </select>
          )}
        </>
      )}

      {!isMulti && single && single.kind === 'block' && (
        <>
          <span className="text-xs font-mono font-semibold px-1">
            {single.blockType}
          </span>
          {single.blockType !== 'box' &&
            single.blockType !== 'subgraph' &&
            onSetBlockType && (
              <select
                aria-label="Block type"
                data-testid="ctx-block-type"
                value={single.blockType}
                onChange={(e) => onSetBlockType(e.target.value as BlockType)}
                className={selectClass}
              >
                <option value="alt">alt</option>
                <option value="opt">opt</option>
                <option value="loop">loop</option>
                <option value="par">par</option>
                <option value="rect">rect</option>
              </select>
            )}
          {onUnwrapBlock && (
            <button
              type="button"
              data-testid="ctx-unwrap-block"
              title="Unwrap block (keep contents)"
              onClick={onUnwrapBlock}
              className={`flex items-center space-x-1 px-1.5 py-1 text-xs rounded transition-colors ${
                isDark
                  ? 'hover:bg-slate-800 text-slate-200'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              <Minimize2 size={12} />
              <span>Unwrap</span>
            </button>
          )}
        </>
      )}

      {!isMulti && single && single.kind === 'sticky' && (
        <>
          <span className="text-xs font-medium px-1">Sticky</span>
          {onUpdateStickyNote && (
            <div
              className="flex items-center space-x-1"
              data-testid="ctx-sticky-colors"
            >
              {STICKY_NOTE_COLOR_KEYS.map((c: StickyNoteColor) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`ctx-sticky-color-${c}`}
                  title={`Sticky color ${c}`}
                  onClick={() => onUpdateStickyNote(single.id, { color: c })}
                  className={`w-4 h-4 rounded-full border ${NOTE_COLORS[c].dot} ${
                    (single.color ?? 'yellow') === c
                      ? 'ring-2 ring-blue-500 scale-110'
                      : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          )}
        </>
      )}

      {divider}
      <button
        type="button"
        data-testid="ctx-delete"
        title="Delete selected (Del)"
        aria-label="Delete selected"
        onClick={onRequestDelete}
        className={`p-1 rounded transition-colors ${
          isDark
            ? 'text-rose-400 hover:bg-rose-950/60 hover:text-rose-300'
            : 'text-red-600 hover:bg-red-50 hover:text-red-700'
        }`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
