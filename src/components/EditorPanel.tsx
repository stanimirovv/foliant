'use client';

import { useEffect, useState } from 'react';
import { X, Trash2, ChevronDown, ChevronUp, Play } from 'lucide-react';
import { ModelElement, ParticipantElement, NodeElement, MessageElement, EdgeElement, NoteElement, StickyNoteElement, BlockElement, BlockType, DiagramType, NodeShape, ParticipantType, NotePlacement } from '@/lib/model';
import { ArrowStylePatch, ArrowTagInfo, PRESET_ACTOR_COLORS, getPresetActorColors, resolveActorColorForTheme, hexToRgbColor, rgbToHexColor, DEFAULT_RECT_COLOR } from '@/lib/editor';
import { DiagramConfig, ArrowKeyMode, ArrowAnimationType, ArrowStyleDefaults, StickyNote, StickyNoteColor } from '@/lib/views';
import { ANIMATED_ARROW_PRESETS } from '@/lib/styling';
import AnimatedArrowSelector from './AnimatedArrowSelector';
import { NOTE_COLORS, STICKY_NOTE_COLOR_KEYS } from './StickyNote';

// Operator vocabularies (EDITING_PLAN.md Section 4.8); keep in sync with
// editor.ts (setArrowType validates against the same sets).
const SEQUENCE_OPERATORS = ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '->o', '-->o', '->*', '-->*', '-', '--'];
const FLOWCHART_OPERATORS = ['---', '-->', '==>', '-.->', '<-->', '<==>', 'x--x', 'o--o'];
const DASH_OPTIONS = ['solid', 'dashed', 'dotted'] as const;
type Dash = (typeof DASH_OPTIONS)[number];

export interface PendingDelete {
  element: ModelElement;      // the element being deleted
  cascaded: ModelElement[];   // referencing elements removed with it
}

export interface ElementTagItem {
  element: ModelElement;
  ownTags: string[];
  inheritedTags?: string[];
}

// Normalized canWrapSelection result for the wrap sections (the reason is
// shown verbatim when the check refuses).
export interface WrapCheck {
  ok: boolean;
  reason?: string;
}

export const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  coral: '#ff7f50',
  crimson: '#dc143c',
  gold: '#ffd700',
  indigo: '#4b0082',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  magenta: '#ff00ff',
  plum: '#dda0dd',
  salmon: '#fa8072',
  tan: '#d2b48c',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
};

export function colorToHex(color?: string, fallback = '#000000'): string {
  if (!color) return fallback;
  const trimmed = color.trim().toLowerCase();
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed];
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
  }
  return fallback;
}

interface EditorPanelProps {
  element: ModelElement | null;   // selected raw element (null = nothing selected)
  selectedElements?: ModelElement[];  // all selected raw elements
  elementsTagInfo?: ElementTagItem[]; // tag details for all selected elements
  diagramType: DiagramType;
  theme?: 'default' | 'dark';
  config: DiagramConfig | null;   // current CONFIG (field values + datalists)
  arrowStyle: ArrowStylePatch | null;  // current style of the selected message/edge
  arrowTags: ArrowTagInfo | null; // tags of the selected message/edge (own + behavior)
  globalArrowStyle?: ArrowStyleDefaults | null;  // CONFIG.defaultArrowStyle (all-arrows fallback)
  onSetGlobalColor?: (color: string) => void;   // edit the all-arrows default color ('' clears)
  onSetGlobalWidth?: (width: number | '') => void;  // edit the all-arrows default width ('' clears)
  noteTags?: string[] | null;   // tags of the selected note (null when no note is selected)
  stickyNoteTags?: string[] | null;  // tags of the selected sticky note (null when no sticky note is selected)
  noteActorIds?: string[];      // actors a selected sequence note can span (source order)
  onEditNoteText?: (text: string) => void;          // edit the selected sequence note's text
  onSetNotePlacement?: (placement: NotePlacement) => void;  // edit the selected note's placement
  onSetNoteSpan?: (overIds: string[]) => void;      // edit the selected note's spanned actors
  onEditBlockTitle?: (title: string) => void;       // edit the selected block's title (rgb(...) for rect)
  onSetBlockType?: (blockType: BlockType) => void;  // change the selected block's type
  onUnwrapBlock?: () => void;                       // unwrap the selected block (keep its content)
  wrapChecks?: { block: WrapCheck; region: WrapCheck } | null;  // canWrapSelection for the multi-selection
  onWrapInBlock?: (blockType: BlockType, title?: string) => void;  // wrap the selected messages/notes in a block
  onWrapInRegion?: (type: string, value?: string) => void;         // wrap the selected messages/notes in a %% @region
  regionTypes?: string[];                           // existing region types (datalist for the region type input)
  onUpdateNote?: (id: string, patch: Partial<Omit<StickyNote, 'id'>>) => void;  // edit the selected sticky note
  warning?: string | null;
  pendingDelete: PendingDelete | null; // delete confirmation state
  onEditLabel: (newLabel: string) => void;
  onSetColor: (color: string) => void;
  onSetType: (operator: string) => void;
  onSetWidth: (width: number | '') => void;
  onSetDash: (dash: Dash) => void;
  onSetAnimation?: (anim: ArrowAnimationType) => void;
  onAddTag: (tag: string, targetKey?: string) => void;
  onRemoveTag: (tag: string, targetKey?: string) => void;
  onSetKeyMode: (mode: ArrowKeyMode) => void;
  onSetParticipantKind?: (kind: ParticipantType) => void;
  onSetNodeShape?: (shape: NodeShape) => void;
  onToggleActivation?: (endpoint: 'target' | 'source', active: boolean) => void;
  onGroupParticipants?: (participantKeys: string[], title: string, color?: string) => void;
  onGroupNodes?: (nodeKeys: string[], title: string) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function isComponent(el: ModelElement): el is ParticipantElement | NodeElement {
  return el.kind === 'participant' || el.kind === 'node';
}

function isArrow(el: ModelElement): el is MessageElement | EdgeElement {
  return el.kind === 'message' || el.kind === 'edge';
}

// Human-readable one-liner for the delete confirmation dialog.
function describeElement(el: ModelElement): string {
  switch (el.kind) {
    case 'participant': return `participant ${el.id}${el.alias ? ` (${el.alias})` : ''}`;
    case 'node': return `node ${el.id}${el.label ? ` [${el.label}]` : ''}`;
    case 'message': return `message ${el.from} ${el.operator} ${el.to}${el.label ? `: ${el.label}` : ''}`;
    case 'edge': return `edge ${el.from} ${el.operator} ${el.to}${el.label ? `: ${el.label}` : ''}`;
    case 'note': return `note over ${el.over.join(', ')}: ${el.text}`;
    case 'sticky': {
      const snippet = el.text.trim().replace(/\s+/g, ' ');
      return `sticky note${snippet ? `: ${snippet.length > 40 ? `${snippet.slice(0, 40)}…` : snippet}` : ''}`;
    }
    case 'block': return `${el.blockType} block${el.title ? ` "${el.title}"` : ''}`;
    case 'region': return `region ${el.regionType}${el.value ? `=${el.value}` : ''}`;
    case 'config': return 'CONFIG header';
  }
}

const fieldLabel = 'text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1';
const fieldInput = 'w-full px-2 py-1 text-sm border rounded bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Properties panel for the structured editor (EDITING_PLAN.md 4.12).
export default function EditorPanel({
  element,
  selectedElements,
  elementsTagInfo,
  diagramType,
  theme = 'dark',
  config,
  arrowStyle,
  arrowTags,
  globalArrowStyle,
  onSetGlobalColor,
  onSetGlobalWidth,
  noteTags,
  stickyNoteTags,
  noteActorIds,
  onEditNoteText,
  onSetNotePlacement,
  onSetNoteSpan,
  onEditBlockTitle,
  onSetBlockType,
  onUnwrapBlock,
  wrapChecks,
  onWrapInBlock,
  onWrapInRegion,
  regionTypes,
  onUpdateNote,
  warning,
  pendingDelete,
  onEditLabel,
  onSetColor,
  onSetType,
  onSetWidth,
  onSetDash,
  onSetAnimation,
  onAddTag,
  onRemoveTag,
  onSetKeyMode,
  onSetParticipantKind,
  onSetNodeShape,
  onToggleActivation,
  onGroupParticipants,
  onGroupNodes,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: EditorPanelProps) {
  const actorColors: string[] = [];
  const actorKeys: string[] = [];
  const arrowColors: string[] = [];
  if (config?.actors) {
    for (const meta of Object.values(config.actors)) {
      if (meta.color) {
        const resolved = resolveActorColorForTheme(meta.color, theme);
        if (resolved && !actorColors.includes(resolved)) actorColors.push(resolved);
      }
      if (meta.keys) for (const k of meta.keys) if (!actorKeys.includes(k)) actorKeys.push(k);
    }
  }
  if (config?.arrows) {
    for (const a of config.arrows) {
      if (a.color && !arrowColors.includes(a.color)) arrowColors.push(a.color);
      if (a.keys) for (const k of a.keys) if (!actorKeys.includes(k)) actorKeys.push(k);
    }
  }
  if (config?.noteTags) {
    for (const n of config.noteTags) {
      if (n.keys) for (const k of n.keys) if (!actorKeys.includes(k)) actorKeys.push(k);
    }
  }
  if (config?.notes) {
    for (const n of config.notes) {
      if (n.keys) for (const k of n.keys) if (!actorKeys.includes(k)) actorKeys.push(k);
    }
  }

  const isMultiSelect = Boolean(selectedElements && selectedElements.length > 1);
  const activeElement = isMultiSelect ? null : (element ?? (selectedElements && selectedElements.length === 1 ? selectedElements[0] : null));
  // Structural (subgraph) tags of the active element, shown as read-only chips.
  const activeInheritedTags = activeElement
    ? (elementsTagInfo ?? []).find(item => item.element.key === activeElement.key)?.inheritedTags
    : undefined;

  return (
    <div className={`p-4 ${theme === 'dark' ? 'dark text-slate-100 bg-slate-900' : 'text-gray-900 bg-white'}`} data-testid="editor-panel">
      <h2 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 mb-2">Editor</h2>
      {!isMultiSelect && !activeElement && (
        <>
          {onSetGlobalColor && onSetGlobalWidth && (
            <GlobalArrowFields
              arrowStyle={globalArrowStyle ?? null}
              arrowColors={arrowColors}
              theme={theme}
              onSetColor={onSetGlobalColor}
              onSetWidth={onSetGlobalWidth}
            />
          )}
          <p className="text-xs text-gray-500 dark:text-slate-400 italic mt-2">
            Click an element in the diagram to edit it.
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 italic mt-1">
            {diagramType === 'flowchart'
              ? 'Drag a node into empty space to move it, or drag from a handle on its edge to connect it to another node.'
              : 'Drag an actor box or lifeline to reorder it, or drag from the handle below the actor box to add a message.'}
          </p>
        </>
      )}
      {isMultiSelect && (
        <MultiElementFields
          elements={selectedElements!}
          elementsTagInfo={elementsTagInfo ?? []}
          actorKeys={actorKeys}
          diagramType={diagramType}
          theme={theme}
          arrowStyle={arrowStyle}
          arrowColors={arrowColors}
          wrapChecks={wrapChecks ?? null}
          regionTypes={regionTypes ?? []}
          onWrapInBlock={onWrapInBlock}
          onWrapInRegion={onWrapInRegion}
          onSetColor={onSetColor}
          onSetType={onSetType}
          onSetWidth={onSetWidth}
          onSetDash={onSetDash}
          onSetAnimation={onSetAnimation}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onGroupParticipants={onGroupParticipants}
          onGroupNodes={onGroupNodes}
          onRequestDelete={onRequestDelete}
        />
      )}
      {!isMultiSelect && activeElement && isComponent(activeElement) && (
        <ParticipantFields
          key={activeElement.key}
          element={activeElement}
          theme={theme}
          config={config}
          actorColors={actorColors}
          actorKeys={actorKeys}
          inheritedTags={activeInheritedTags}
          onEditLabel={onEditLabel}
          onSetColor={onSetColor}
          onSetParticipantKind={onSetParticipantKind}
          onSetNodeShape={onSetNodeShape}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onRequestDelete={onRequestDelete}
        />
      )}
      {!isMultiSelect && activeElement && isArrow(activeElement) && (
        <ArrowFields
          key={activeElement.key}
          element={activeElement}
          diagramType={diagramType}
          theme={theme}
          arrowStyle={arrowStyle}
          arrowTags={arrowTags}
          arrowColors={arrowColors}
          actorKeys={actorKeys}
          onEditLabel={onEditLabel}
          onSetColor={onSetColor}
          onSetType={onSetType}
          onSetWidth={onSetWidth}
          onSetDash={onSetDash}
          onSetAnimation={onSetAnimation}
          onToggleActivation={onToggleActivation}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onSetKeyMode={onSetKeyMode}
          onRequestDelete={onRequestDelete}
        />
      )}
      {!isMultiSelect && activeElement && activeElement.kind === 'note' && (
        <NoteFields
          key={activeElement.key}
          element={activeElement}
          tags={noteTags ?? []}
          actorKeys={actorKeys}
          actorIds={noteActorIds ?? []}
          inheritedTags={activeInheritedTags}
          onEditNoteText={onEditNoteText}
          onSetNotePlacement={onSetNotePlacement}
          onSetNoteSpan={onSetNoteSpan}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onRequestDelete={onRequestDelete}
        />
      )}
      {!isMultiSelect && activeElement && activeElement.kind === 'block' && (
        <BlockFields
          key={activeElement.key}
          element={activeElement}
          onEditBlockTitle={onEditBlockTitle}
          onSetBlockType={onSetBlockType}
          onUnwrapBlock={onUnwrapBlock}
          onRequestDelete={onRequestDelete}
        />
      )}
      {!isMultiSelect && activeElement && activeElement.kind === 'sticky' && (
        <StickyNoteFields
          key={activeElement.key}
          element={activeElement}
          tags={stickyNoteTags ?? []}
          actorKeys={actorKeys}
          onUpdateNote={onUpdateNote}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
        />
      )}
      {!isMultiSelect && activeElement && !isComponent(activeElement) && !isArrow(activeElement) && activeElement.kind !== 'note' && activeElement.kind !== 'block' && activeElement.kind !== 'sticky' && (
        <p className="text-xs text-gray-500 dark:text-slate-400 italic">
          This element is not editable.
        </p>
      )}
      {warning && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">{warning}</p>
      )}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          data-testid="delete-dialog"
        >
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 rounded-lg shadow-xl p-4 w-80">
            <h3 className="text-sm font-semibold mb-2">
              Delete {describeElement(pendingDelete.element)}?
            </h3>
            {pendingDelete.cascaded.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">
                  This also removes {pendingDelete.cascaded.length} referencing
                  {' '}{pendingDelete.cascaded.length === 1 ? 'element' : 'elements'}:
                </p>
                <ul className="text-xs text-gray-700 dark:text-slate-300 list-disc pl-4 max-h-32 overflow-y-auto">
                  {pendingDelete.cascaded.map(el => (
                    <li key={el.key}>{describeElement(el)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end space-x-2">
              <button
                onClick={onCancelDelete}
                className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDelete}
                data-testid="confirm-delete"
                className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface MultiElementFieldsProps {
  elements: ModelElement[];
  elementsTagInfo: ElementTagItem[];
  actorKeys: string[];
  diagramType: DiagramType;
  theme?: 'default' | 'dark';
  arrowStyle: ArrowStylePatch | null;
  arrowColors: string[];
  wrapChecks: { block: WrapCheck; region: WrapCheck } | null;
  regionTypes: string[];
  onWrapInBlock?: (blockType: BlockType, title?: string) => void;
  onWrapInRegion?: (type: string, value?: string) => void;
  onSetColor: (color: string) => void;
  onSetType: (operator: string) => void;
  onSetWidth: (width: number | '') => void;
  onSetDash: (dash: Dash) => void;
  onSetAnimation?: (anim: ArrowAnimationType) => void;
  onAddTag: (tag: string, targetKey?: string) => void;
  onRemoveTag: (tag: string, targetKey?: string) => void;
  onGroupParticipants?: (participantKeys: string[], title: string, color?: string) => void;
  onGroupNodes?: (nodeKeys: string[], title: string) => void;
  onRequestDelete: () => void;
}

function MultiElementFields({
  elements,
  elementsTagInfo,
  actorKeys,
  diagramType,
  theme = 'dark',
  arrowStyle,
  arrowColors,
  wrapChecks,
  regionTypes,
  onWrapInBlock,
  onWrapInRegion,
  onSetColor,
  onSetType,
  onSetWidth,
  onSetDash,
  onSetAnimation,
  onAddTag,
  onRemoveTag,
  onGroupParticipants,
  onGroupNodes,
  onRequestDelete,
}: MultiElementFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const [boxTitle, setBoxTitle] = useState('Group');
  const [boxColor, setBoxColor] = useState('');
  const [subgraphTitle, setSubgraphTitle] = useState('Subgraph');
  const [wrapBlockType, setWrapBlockType] = useState<BlockType>('loop');
  const [wrapBlockTitle, setWrapBlockTitle] = useState('');
  const [wrapBlockColor, setWrapBlockColor] = useState(DEFAULT_RECT_COLOR);
  const [wrapRegionType, setWrapRegionType] = useState('flow');
  const [wrapRegionValue, setWrapRegionValue] = useState('');
  const [isAnimDropdownOpen, setIsAnimDropdownOpen] = useState(false);

  const participants = elements.filter((el): el is ParticipantElement => el.kind === 'participant');
  const nodes = elements.filter((el): el is NodeElement => el.kind === 'node');
  const arrows = elements.filter(isArrow);
  // Only messages and notes are wrappable (W4); the panel counts them for the
  // ≥2 requirement, participants keep the Box group control.
  const wrappable = elements.filter(el => el.kind === 'message' || el.kind === 'note');
  const showWrap = diagramType === 'sequence' && wrappable.length >= 2 && Boolean(onWrapInBlock && onWrapInRegion);

  const vocabulary = diagramType === 'flowchart' ? FLOWCHART_OPERATORS : SEQUENCE_OPERATORS;
  const allSameOperator = arrows.length > 0 && arrows.every(a => a.operator === arrows[0].operator);
  const currentOperator = allSameOperator ? arrows[0].operator : '';
  const operators = allSameOperator && !vocabulary.includes(arrows[0].operator)
    ? [arrows[0].operator, ...vocabulary]
    : vocabulary;

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
  };

  const submitExistingTag = () => {
    if (existingTagSelect) {
      onAddTag(existingTagSelect);
      setExistingTagSelect('');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">
          Selected Elements ({elements.length})
        </p>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
          Hold Shift and click elements in the diagram to add or remove them.
        </p>
      </div>

      <div
        className="space-y-2 border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 rounded p-2.5"
        data-testid="multi-add-tag-section"
      >
        <span className={fieldLabel}>Add tag to all elements</span>
        {actorKeys.length > 0 && (
          <div className="flex space-x-1">
            <select
              className={fieldInput}
              value={existingTagSelect}
              onChange={(e) => setExistingTagSelect(e.target.value)}
              data-testid="multi-select-existing-tag"
              aria-label="Select existing tag"
            >
              <option value="">Select existing tag...</option>
              {actorKeys.map(k => (
                <option key={k} value={k}>#{k}</option>
              ))}
            </select>
            <button
              type="button"
              data-testid="multi-add-existing-tag"
              disabled={!existingTagSelect}
              onClick={submitExistingTag}
              className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex space-x-1">
          <input
            type="text"
            className={fieldInput}
            placeholder="Add tag to all..."
            list="editor-multi-tag-list"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTag();
              }
            }}
            data-testid="multi-add-tag-input"
          />
          <button
            type="button"
            title="Add tag"
            data-testid="multi-add-tag"
            onClick={submitTag}
            className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            Add
          </button>
        </div>
        <datalist id="editor-multi-tag-list">
          {actorKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      </div>

      <div className="space-y-2" data-testid="multi-tags-by-element-section">
        <span className={fieldLabel}>Tags by Element</span>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
          {elementsTagInfo.map(item => (
            <div
              key={item.element.key}
              className="p-2 rounded border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 space-y-1.5"
              data-testid={`multi-element-${item.element.key}`}
            >
              <div className="flex items-center justify-between text-xs font-medium text-gray-700 dark:text-slate-200">
                <span className="truncate mr-1" title={describeElement(item.element)}>
                  {describeElement(item.element)}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-slate-500 font-mono flex-shrink-0">
                  {item.element.key}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(item.ownTags ?? []).length === 0 && (!item.inheritedTags || item.inheritedTags.length === 0) && (
                  <span className="text-[11px] text-gray-400 dark:text-slate-500 italic">No tags</span>
                )}
                {(item.ownTags ?? []).map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag} from ${describeElement(item.element)}`}
                      data-testid={`remove-tag-${item.element.key}-${tag}`}
                      onClick={() => onRemoveTag(tag, item.element.key)}
                      className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {item.inheritedTags?.map(tag => (
                  <span
                    key={tag}
                    title="Inherited"
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <DeleteButton onRequestDelete={onRequestDelete} />

      {arrows.length > 0 && (
        <div
          className="space-y-3 border border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-800/30 rounded p-2.5"
          data-testid="multi-arrow-fields"
        >
          <span className={fieldLabel}>
            Arrow Style ({arrows.length} {arrows.length === 1 ? 'arrow' : 'arrows'})
          </span>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={fieldLabel}>Type</span>
              <select
                className={fieldInput}
                data-testid="multi-arrow-type"
                value={currentOperator}
                onChange={(e) => {
                  if (e.target.value) onSetType(e.target.value);
                }}
              >
                {!allSameOperator && <option value="" disabled>Mixed</option>}
                {operators.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
            </label>

            <label className="block">
              <span className={fieldLabel}>Color</span>
              <div className="flex items-center space-x-1.5">
                <input
                  type="color"
                  aria-label="Color"
                  data-testid="arrow-color-picker"
                  className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shrink-0"
                  list="editor-multi-arrow-color-list"
                  value={colorToHex(arrowStyle?.color, '#00ff9d')}
                  onChange={(e) => onSetColor(e.target.value)}
                />
                <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={arrowStyle?.color || 'Default'}>
                  {arrowStyle?.color || 'Default'}
                </span>
                {arrowStyle?.color && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Clear color"
                    data-testid="clear-arrow-color"
                    title="Reset to default color"
                    onClick={(e) => {
                      e.preventDefault();
                      onSetColor('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSetColor('');
                      }
                    }}
                    className="text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 px-1 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer select-none shrink-0"
                  >
                    Clear
                  </span>
                )}
              </div>
              <datalist id="editor-multi-arrow-color-list">
                {arrowColors.map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={fieldLabel}>Width</span>
              <input
                type="number"
                min={1}
                max={10}
                className={fieldInput}
                placeholder="1-10"
                data-testid="multi-arrow-width"
                value={arrowStyle?.width ?? ''}
                onChange={(e) => onSetWidth(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>

            <label className="block">
              <span className={fieldLabel}>Dash</span>
              <select
                className={fieldInput}
                data-testid="multi-arrow-dash"
                value={arrowStyle?.dash ?? 'solid'}
                onChange={(e) => onSetDash(e.target.value as Dash)}
              >
                {DASH_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          {onSetAnimation && (
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <button
                type="button"
                data-testid="multi-arrow-animation-dropdown-toggle"
                aria-expanded={isAnimDropdownOpen}
                onClick={() => setIsAnimDropdownOpen(prev => !prev)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700/70 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Play size={12} className="text-blue-500" />
                  <span>Animated Arrows</span>
                  <span className="text-[11px] font-normal text-gray-400 dark:text-slate-500">
                    ({ANIMATED_ARROW_PRESETS.find(p => p.id === (arrowStyle?.animation ?? 'none'))?.name ?? 'None'})
                  </span>
                </span>
                {isAnimDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {isAnimDropdownOpen && (
                <div className="mt-2" data-testid="multi-arrow-animation-dropdown-content">
                  <AnimatedArrowSelector
                    currentAnimation={arrowStyle?.animation ?? 'none'}
                    currentColor={arrowStyle?.color ? colorToHex(arrowStyle?.color) : (theme === 'default' ? '#00b875' : '#00ff9d')}
                    theme={theme}
                    onSelectAnimation={onSetAnimation}
                    onSelectColor={onSetColor}
                    hasSelectedArrow={true}
                    compact={true}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {participants.length >= 2 && onGroupParticipants && (
        <div className="space-y-2 border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 rounded p-2.5">
          <span className={fieldLabel}>Group into Box ({participants.length} participants)</span>
          <div className="space-y-1.5">
            <input
              type="text"
              className={fieldInput}
              placeholder="Box title..."
              value={boxTitle}
              onChange={(e) => setBoxTitle(e.target.value)}
              data-testid="group-box-title"
            />
            <input
              type="text"
              className={fieldInput}
              placeholder={theme === 'default' ? 'Color (e.g. #cfe2f3, #e2e8f0)' : 'Color (e.g. #213b5e, #1e293b)'}
              value={boxColor}
              onChange={(e) => setBoxColor(e.target.value)}
              data-testid="group-box-color"
            />
            <button
              type="button"
              data-testid="group-box-button"
              onClick={() => onGroupParticipants(participants.map(p => p.key), boxTitle, boxColor)}
              className="w-full py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors"
            >
              Group into Box
            </button>
          </div>
        </div>
      )}

      {nodes.length >= 2 && onGroupNodes && (
        <div className="space-y-2 border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 rounded p-2.5">
          <span className={fieldLabel}>Group into Subgraph ({nodes.length} nodes)</span>
          <div className="space-y-1.5">
            <input
              type="text"
              className={fieldInput}
              placeholder="Subgraph title..."
              value={subgraphTitle}
              onChange={(e) => setSubgraphTitle(e.target.value)}
              data-testid="group-subgraph-title"
            />
            <button
              type="button"
              data-testid="group-subgraph-button"
              onClick={() => onGroupNodes(nodes.map(n => n.key), subgraphTitle)}
              className="w-full py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors"
            >
              Group into Subgraph
            </button>
          </div>
        </div>
      )}

      {showWrap && (
        <div className="space-y-2 border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 rounded p-2.5">
          <span className={fieldLabel}>Wrap in Block ({wrappable.length} elements)</span>
          <div className="space-y-1.5">
            <select
              className={fieldInput}
              value={wrapBlockType}
              onChange={(e) => setWrapBlockType(e.target.value as BlockType)}
              data-testid="wrap-block-type"
              aria-label="Block type"
            >
              <option value="alt">alt</option>
              <option value="opt">opt</option>
              <option value="loop">loop</option>
              <option value="par">par</option>
              <option value="rect">rect</option>
            </select>
            {wrapBlockType === 'rect' ? (
              <input
                type="text"
                className={fieldInput}
                placeholder="rgb(200,150,255)"
                value={wrapBlockColor}
                onChange={(e) => setWrapBlockColor(e.target.value)}
                data-testid="wrap-block-color"
                aria-label="Block color"
              />
            ) : (
              <input
                type="text"
                className={fieldInput}
                placeholder="Title (optional)"
                value={wrapBlockTitle}
                onChange={(e) => setWrapBlockTitle(e.target.value)}
                data-testid="wrap-block-title"
              />
            )}
            <button
              type="button"
              data-testid="wrap-block-button"
              disabled={!wrapChecks?.block.ok}
              onClick={() => onWrapInBlock?.(wrapBlockType, wrapBlockType === 'rect' ? wrapBlockColor : wrapBlockTitle)}
              className="w-full py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors disabled:opacity-40"
            >
              Wrap in Block ({wrappable.length} elements)
            </button>
            {!wrapChecks?.block.ok && wrapChecks?.block.reason && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500" data-testid="wrap-reason">
                {wrapChecks.block.reason}
              </p>
            )}
          </div>
        </div>
      )}

      {showWrap && (
        <div className="space-y-2 border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 rounded p-2.5">
          <span className={fieldLabel}>Wrap in Region ({wrappable.length} elements)</span>
          <div className="space-y-1.5">
            <input
              type="text"
              className={fieldInput}
              placeholder="Region type (e.g. flow)"
              list="editor-wrap-region-types"
              value={wrapRegionType}
              onChange={(e) => setWrapRegionType(e.target.value)}
              data-testid="wrap-region-type"
            />
            <datalist id="editor-wrap-region-types">
              {regionTypes.map(t => <option key={t} value={t} />)}
            </datalist>
            <input
              type="text"
              className={fieldInput}
              placeholder="Value (optional)"
              value={wrapRegionValue}
              onChange={(e) => setWrapRegionValue(e.target.value)}
              data-testid="wrap-region-value"
            />
            <button
              type="button"
              data-testid="wrap-region-button"
              disabled={!wrapChecks?.region.ok}
              onClick={() => onWrapInRegion?.(wrapRegionType, wrapRegionValue)}
              className="w-full py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors disabled:opacity-40"
            >
              Wrap in Region
            </button>
            {!wrapChecks?.region.ok && wrapChecks?.region.reason && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500" data-testid="wrap-region-reason">
                {wrapChecks.region.reason}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ComponentFieldsProps {
  element: ParticipantElement | NodeElement;
  theme?: 'default' | 'dark';
  config: DiagramConfig | null;
  actorColors: string[];
  actorKeys: string[];
  inheritedTags?: string[];     // structural (subgraph) tags, read-only
  onEditLabel: (newLabel: string) => void;
  onSetColor: (color: string) => void;
  onSetParticipantKind?: (kind: ParticipantType) => void;
  onSetNodeShape?: (shape: NodeShape) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRequestDelete: () => void;
}

function ParticipantFields({
  element, theme = 'dark', config, actorColors, actorKeys, inheritedTags,
  onEditLabel, onSetColor, onSetParticipantKind, onSetNodeShape, onAddTag, onRemoveTag, onRequestDelete,
}: ComponentFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const meta = config?.actors?.[element.id];
  const effectiveColor = meta?.color ? resolveActorColorForTheme(meta.color, theme) : undefined;
  const presetPalette = getPresetActorColors(theme);
  const label = element.kind === 'participant' ? (element.alias ?? '') : (element.label ?? '');
  const tags = meta?.keys ?? [];

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
  };

  const submitExistingTag = () => {
    if (existingTagSelect) {
      onAddTag(existingTagSelect);
      setExistingTagSelect('');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 dark:text-slate-500">
        {element.kind === 'participant' ? 'Participant' : 'Node'}: <span className="font-mono">{element.id}</span>
      </p>

      <label className="block">
        <span className={fieldLabel}>Label</span>
        <input
          type="text"
          className={fieldInput}
          placeholder={element.id}
          value={label}
          onChange={(e) => onEditLabel(e.target.value)}
        />
      </label>

      {element.kind === 'participant' && onSetParticipantKind ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={fieldLabel}>Type</span>
            <select
              className={fieldInput}
              data-testid="participant-kind-select"
              value={element.participantType ?? 'participant'}
              onChange={(e) => onSetParticipantKind(e.target.value as ParticipantType)}
            >
              <option value="participant">Participant (Box)</option>
              <option value="actor">Actor (Stick figure)</option>
              <option value="database">Database</option>
              <option value="queue">Queue</option>
              <option value="boundary">Boundary</option>
              <option value="control">Control</option>
              <option value="entity">Entity</option>
              <option value="collections">Collections</option>
            </select>
          </label>

          <label className="block">
            <span className={fieldLabel}>Color</span>
            <div className="flex items-center space-x-1.5">
              <input
                type="color"
                aria-label="Color"
                data-testid="actor-color-picker"
                className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shrink-0"
                list="editor-actor-color-list"
                value={colorToHex(effectiveColor, theme === 'default' ? presetPalette[0] : '#213b5e')}
                onChange={(e) => onSetColor(e.target.value)}
              />
              <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={effectiveColor || 'Default'}>
                {effectiveColor || 'Default'}
              </span>
              {meta?.color && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Clear color"
                  data-testid="clear-actor-color"
                  title="Reset to default color"
                  onClick={(e) => {
                    e.preventDefault();
                    onSetColor('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSetColor('');
                    }
                  }}
                  className="text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 px-1 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer select-none shrink-0"
                >
                  Clear
                </span>
              )}
            </div>
            <datalist id="editor-actor-color-list">
              {actorColors.map(c => <option key={c} value={c} />)}
            </datalist>
          </label>
        </div>
      ) : element.kind === 'node' && onSetNodeShape ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={fieldLabel}>Type</span>
            <select
              className={fieldInput}
              data-testid="participant-kind-select"
              value={element.shape ?? 'rect'}
              onChange={(e) => onSetNodeShape(e.target.value as NodeShape)}
            >
              <option value="rect">Rectangle (Process)</option>
              <option value="cylinder">Database (Cylinder)</option>
              <option value="rhombus">If / Else (Decision)</option>
              <option value="round">Rounded</option>
              <option value="circle">Circle</option>
              <option value="asymmetric">Flag (Asymmetric)</option>
            </select>
          </label>

          <label className="block">
            <span className={fieldLabel}>Color</span>
            <div className="flex items-center space-x-1.5">
              <input
                type="color"
                aria-label="Color"
                data-testid="actor-color-picker"
                className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shrink-0"
                list="editor-actor-color-list"
                value={colorToHex(effectiveColor, theme === 'default' ? presetPalette[0] : '#213b5e')}
                onChange={(e) => onSetColor(e.target.value)}
              />
              <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={effectiveColor || 'Default'}>
                {effectiveColor || 'Default'}
              </span>
              {meta?.color && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Clear color"
                  data-testid="clear-actor-color"
                  title="Reset to default color"
                  onClick={(e) => {
                    e.preventDefault();
                    onSetColor('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSetColor('');
                    }
                  }}
                  className="text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 px-1 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer select-none shrink-0"
                >
                  Clear
                </span>
              )}
            </div>
            <datalist id="editor-actor-color-list">
              {actorColors.map(c => <option key={c} value={c} />)}
            </datalist>
          </label>
        </div>
      ) : (
        <label className="block">
          <span className={fieldLabel}>Color</span>
          <div className="flex items-center space-x-2">
            <input
              type="color"
              aria-label="Color"
              data-testid="actor-color-picker"
              className="h-8 w-12 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5"
              list="editor-actor-color-list"
              value={colorToHex(effectiveColor, theme === 'default' ? presetPalette[0] : '#213b5e')}
              onChange={(e) => onSetColor(e.target.value)}
            />
            <span className="text-xs text-gray-500 dark:text-slate-400 font-mono flex-1">
              {effectiveColor || 'Default'}
            </span>
            {meta?.color && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear color"
                data-testid="clear-actor-color"
                title="Reset to default color"
                onClick={(e) => {
                  e.preventDefault();
                  onSetColor('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSetColor('');
                  }
                }}
                className="text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 px-1.5 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer select-none"
              >
                Clear
              </span>
            )}
          </div>
          <datalist id="editor-actor-color-list">
            {actorColors.map(c => <option key={c} value={c} />)}
          </datalist>
        </label>
      )}

      <div>
        <span className="text-[11px] text-gray-500 dark:text-slate-400 block mb-1">Preset Tones</span>
        <div className="flex flex-wrap gap-1.5" data-testid="actor-color-presets">
          {presetPalette.slice(0, 10).map((c) => {
            const isSelected = effectiveColor?.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                data-testid={`actor-color-preset-${c}`}
                onClick={() => onSetColor(c)}
                style={{ backgroundColor: c }}
                title={c}
                className={`w-5 h-5 rounded border transition-all ${
                  isSelected
                    ? 'ring-2 ring-blue-500 border-white dark:border-slate-900 scale-110 shadow-sm'
                    : 'border-gray-300 dark:border-slate-700/80 hover:scale-105 hover:border-gray-400 dark:hover:border-slate-500'
                }`}
              />
            );
          })}
        </div>
      </div>

      <div>
        <span className={fieldLabel}>Tags</span>
        {(tags.length > 0 || (inheritedTags ?? []).length > 0) && (
          <div className="flex flex-wrap gap-1 mb-1" data-testid="participant-tag-chips">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {(inheritedTags ?? []).map(tag => (
              <span
                key={tag}
                title="Inherited from the enclosing subgraph"
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {actorKeys.length > 0 && (
          <div className="flex space-x-1 mb-1">
            <select
              className={fieldInput}
              value={existingTagSelect}
              onChange={(e) => setExistingTagSelect(e.target.value)}
              data-testid="participant-select-existing-tag"
              aria-label="Select existing tag"
            >
              <option value="">Select existing tag...</option>
              {actorKeys.map(k => (
                <option key={k} value={k}>#{k}</option>
              ))}
            </select>
            <button
              type="button"
              data-testid="participant-add-existing-tag"
              disabled={!existingTagSelect}
              onClick={submitExistingTag}
              className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex space-x-1">
          <input
            type="text"
            className={fieldInput}
            placeholder="Add tag..."
            list="editor-tag-list"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTag();
              }
            }}
          />
          <button
            type="button"
            title="Add tag"
            data-testid="add-tag"
            onClick={submitTag}
            className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            Add
          </button>
        </div>
        <datalist id="editor-tag-list">
          {actorKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      </div>

      <DeleteButton onRequestDelete={onRequestDelete} />
    </div>
  );
}

interface NoteFieldsProps {
  element: NoteElement;
  tags: string[];
  actorKeys: string[];
  actorIds: string[];          // actors the note can span (participants + implicit actors)
  inheritedTags?: string[];     // structural (subgraph) tags, read-only
  onEditNoteText?: (text: string) => void;
  onSetNotePlacement?: (placement: NotePlacement) => void;
  onSetNoteSpan?: (overIds: string[]) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRequestDelete: () => void;
}

// Single-selection fields for a native sequence note (`Note over/left of/right
// of …`): text, placement, spanned actors, tags and delete. Distinct from
// StickyNoteFields (the free-floating CONFIG cards).
function NoteFields({
  element, tags, actorKeys, actorIds, inheritedTags,
  onEditNoteText, onSetNotePlacement, onSetNoteSpan, onAddTag, onRemoveTag, onRequestDelete,
}: NoteFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const [text, setText] = useState(element.text);

  // Keep the local text in sync when another note is selected or the text is
  // edited elsewhere (mirrors StickyNoteFields).
  useEffect(() => {
    setText(element.text);
  }, [element.text]);

  const commitText = () => {
    if (text !== element.text) onEditNoteText?.(text);
  };

  // Toggling a span chip rebuilds the ordered list: the current order first,
  // additions appended (unchecking the last actor is refused by the transform).
  const toggleSpan = (id: string) => {
    const next = element.over.includes(id)
      ? element.over.filter(x => x !== id)
      : [...element.over, id];
    onSetNoteSpan?.(next);
  };

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
  };

  const submitExistingTag = () => {
    if (existingTagSelect) {
      onAddTag(existingTagSelect);
      setExistingTagSelect('');
    }
  };

  // `left of` / `right of` span exactly one actor in Mermaid: the select is
  // disabled while the note spans more than one.
  const placementDisabled = element.over.length > 1;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 dark:text-slate-500">
        Sequence note {element.placement} <span className="font-mono">{element.over.join(', ')}</span>
      </p>

      <div>
        <span className={fieldLabel}>Text</span>
        <textarea
          data-testid="note-text"
          className={fieldInput}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          placeholder="Note text..."
        />
      </div>

      <div>
        <span className={fieldLabel}>Placement</span>
        <select
          className={fieldInput}
          data-testid="note-placement"
          aria-label="Note placement"
          value={element.placement}
          disabled={placementDisabled}
          title={placementDisabled
            ? 'A left of / right of note can span only one participant'
            : 'Note placement'}
          onChange={(e) => onSetNotePlacement?.(e.target.value as NotePlacement)}
        >
          <option value="over">over</option>
          <option value="left of">left of</option>
          <option value="right of">right of</option>
        </select>
      </div>

      <div>
        <span className={fieldLabel}>Spans</span>
        <div className="flex flex-wrap gap-1.5" data-testid="note-span-chips">
          {actorIds.map(id => (
            <label
              key={id}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs cursor-pointer ${
                element.over.includes(id)
                  ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800'
              }`}
            >
              <input
                type="checkbox"
                data-testid={`note-span-${id}`}
                checked={element.over.includes(id)}
                onChange={() => toggleSpan(id)}
                className="accent-blue-600"
              />
              <span className="font-mono">{id}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className={fieldLabel}>Tags</span>
        {(tags.length > 0 || (inheritedTags ?? []).length > 0) && (
          <div className="flex flex-wrap gap-1 mb-1" data-testid="note-tag-chips">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  data-testid={`remove-note-tag-${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {(inheritedTags ?? []).map(tag => (
              <span
                key={tag}
                title="Inherited from the enclosing subgraph"
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {actorKeys.length > 0 && (
          <div className="flex space-x-1 mb-1">
            <select
              className={fieldInput}
              value={existingTagSelect}
              onChange={(e) => setExistingTagSelect(e.target.value)}
              data-testid="note-select-existing-tag"
              aria-label="Select existing tag"
            >
              <option value="">Select existing tag...</option>
              {actorKeys.map(k => (
                <option key={k} value={k}>#{k}</option>
              ))}
            </select>
            <button
              type="button"
              data-testid="note-add-existing-tag"
              disabled={!existingTagSelect}
              onClick={submitExistingTag}
              className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex space-x-1">
          <input
            type="text"
            className={fieldInput}
            placeholder="Add tag..."
            list="editor-note-tag-list"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTag();
              }
            }}
            data-testid="note-add-tag-input"
          />
          <button
            type="button"
            title="Add tag"
            data-testid="note-add-tag"
            onClick={submitTag}
            className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            Add
          </button>
        </div>
        <datalist id="editor-note-tag-list">
          {actorKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      </div>

      <DeleteButton onRequestDelete={onRequestDelete} />
    </div>
  );
}

interface BlockFieldsProps {
  element: BlockElement;
  onEditBlockTitle?: (title: string) => void;
  onSetBlockType?: (blockType: BlockType) => void;
  onUnwrapBlock?: () => void;
  onRequestDelete: () => void;
}

// Single-selection fields for a sequence block (alt/opt/loop/par/rect/box):
// title (free text for the labeled types, a color for rect), type, unwrap and
// delete. box blocks are read-only (their title encodes color and name; they
// are created by Group into Box) but can still be unwrapped or deleted.
function BlockFields({
  element, onEditBlockTitle, onSetBlockType, onUnwrapBlock, onRequestDelete,
}: BlockFieldsProps) {
  const isSubgraph = element.blockType === 'subgraph';
  const displayTitle = isSubgraph
    ? (element.title?.match(/^([A-Za-z0-9_-]+)\s*\[(.*)\]$/)?.[2] ?? element.title ?? '')
    : (element.title ?? '');
  const [title, setTitle] = useState(displayTitle);

  // Keep the local title in sync when another block is selected or the title
  // is edited elsewhere (mirrors NoteFields).
  useEffect(() => {
    setTitle(displayTitle);
  }, [displayTitle]);

  const commitTitle = () => {
    if (title !== displayTitle) onEditBlockTitle?.(title);
  };

  const isRect = element.blockType === 'rect';
  const isLabeled = element.blockType === 'alt' || element.blockType === 'opt'
    || element.blockType === 'loop' || element.blockType === 'par' || isSubgraph;
  const isBox = element.blockType === 'box';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 dark:text-slate-500">
        {element.blockType} block{element.title ? <> <span className="font-mono">"{element.title}"</span></> : null}
      </p>

      {isBox && (
        <p className="text-xs text-gray-500 dark:text-slate-400 italic">
          Box group — edit via Group into Box. Unwrap removes the grouping and keeps the participants.
        </p>
      )}

      {isLabeled && (
        <div>
          <span className={fieldLabel}>Title</span>
          <input
            type="text"
            className={fieldInput}
            data-testid="block-title"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
          />
        </div>
      )}

      {isRect && (
        <div>
          <span className={fieldLabel}>Color</span>
          <div className="flex items-center space-x-1.5">
            <input
              type="color"
              aria-label="Block color"
              data-testid="block-color-picker"
              className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shrink-0"
              value={rgbToHexColor(element.title ?? '') ?? colorToHex(element.title, '#c896ff')}
              onChange={(e) => {
                const rgb = hexToRgbColor(e.target.value);
                if (rgb) onEditBlockTitle?.(rgb);
              }}
            />
            <span
              className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0"
              title={element.title || 'Default'}
              data-testid="block-color-label"
            >
              {element.title || 'Default'}
            </span>
          </div>
        </div>
      )}

      {(isLabeled || isRect) && !isSubgraph && (
        <div>
          <span className={fieldLabel}>Type</span>
          <select
            className={fieldInput}
            data-testid="block-type"
            aria-label="Block type"
            value={element.blockType}
            onChange={(e) => onSetBlockType?.(e.target.value as BlockType)}
          >
            <option value="alt">alt (alternative)</option>
            <option value="opt">opt (option)</option>
            <option value="loop">loop</option>
            <option value="par">par (parallel)</option>
            <option value="rect">rect (background)</option>
          </select>
        </div>
      )}

      <div className="flex space-x-2">
        <button
          type="button"
          data-testid="block-unwrap"
          onClick={onUnwrapBlock}
          title="Remove the block frame, keep its content"
          className="flex-1 flex items-center justify-center px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
        >
          Unwrap
        </button>
        <div className="flex-1">
          <DeleteButton onRequestDelete={onRequestDelete} />
        </div>
      </div>
    </div>
  );
}

interface StickyNoteFieldsProps {
  element: StickyNoteElement;
  tags: string[];
  actorKeys: string[];
  onUpdateNote?: (id: string, patch: Partial<Omit<StickyNote, 'id'>>) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

// Single-selection fields for a sticky note card: text, color and tags.
// (Editing the text here mirrors the card's own double-click inline editor.)
function StickyNoteFields({
  element, tags, actorKeys, onUpdateNote, onAddTag, onRemoveTag,
}: StickyNoteFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const [text, setText] = useState(element.text);

  // Keep the local text in sync when another note is selected or the text is
  // edited elsewhere (the card's inline editor).
  useEffect(() => {
    setText(element.text);
  }, [element.text]);

  const commitText = () => {
    if (text !== element.text) onUpdateNote?.(element.id, { text });
  };

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
  };

  const submitExistingTag = () => {
    if (existingTagSelect) {
      onAddTag(existingTagSelect);
      setExistingTagSelect('');
    }
  };

  const currentColor: StickyNoteColor = (element.color as StickyNoteColor | undefined) || 'yellow';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 dark:text-slate-500">
        Sticky note <span className="font-mono">{element.id}</span>
      </p>

      <div>
        <span className={fieldLabel}>Text</span>
        <textarea
          data-testid="sticky-note-text"
          className={fieldInput}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          placeholder="Type your thought..."
        />
      </div>

      <div>
        <span className={fieldLabel}>Color</span>
        <div className="flex gap-1.5" data-testid="sticky-note-colors">
          {STICKY_NOTE_COLOR_KEYS.map(c => (
            <button
              key={c}
              type="button"
              data-testid={`sticky-note-color-${c}`}
              title={c}
              onClick={() => onUpdateNote?.(element.id, { color: c })}
              className={`w-5 h-5 rounded-full border border-black/20 transition-transform hover:scale-110 ${NOTE_COLORS[c].dot} ${
                currentColor === c ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900' : ''
              }`}
            />
          ))}
        </div>
      </div>

      <div>
        <span className={fieldLabel}>Tags</span>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1" data-testid="sticky-note-tag-chips">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  data-testid={`remove-sticky-note-tag-${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {actorKeys.length > 0 && (
          <div className="flex space-x-1 mb-1">
            <select
              className={fieldInput}
              value={existingTagSelect}
              onChange={(e) => setExistingTagSelect(e.target.value)}
              data-testid="sticky-note-select-existing-tag"
              aria-label="Select existing tag"
            >
              <option value="">Select existing tag...</option>
              {actorKeys.map(k => (
                <option key={k} value={k}>#{k}</option>
              ))}
            </select>
            <button
              type="button"
              data-testid="sticky-note-add-existing-tag"
              disabled={!existingTagSelect}
              onClick={submitExistingTag}
              className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex space-x-1">
          <input
            type="text"
            className={fieldInput}
            placeholder="Add tag..."
            list="editor-sticky-note-tag-list"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTag();
              }
            }}
            data-testid="sticky-note-add-tag-input"
          />
          <button
            type="button"
            title="Add tag"
            data-testid="sticky-note-add-tag"
            onClick={submitTag}
            className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            Add
          </button>
        </div>
        <datalist id="editor-sticky-note-tag-list">
          {actorKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      </div>
    </div>
  );
}

interface GlobalArrowFieldsProps {
  arrowStyle: ArrowStyleDefaults | null;
  arrowColors: string[];
  theme?: 'default' | 'dark';
  onSetColor: (color: string) => void;
  onSetWidth: (width: number | '') => void;
}

// Default style applied to every arrow without its own entry field
// (CONFIG.defaultArrowStyle). Shown when nothing is selected.
function GlobalArrowFields({ arrowStyle, arrowColors, theme = 'dark', onSetColor, onSetWidth }: GlobalArrowFieldsProps) {
  return (
    <div
      className="space-y-2 border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 rounded p-2.5"
      data-testid="global-arrow-fields"
    >
      <span className={fieldLabel}>All arrows (default style)</span>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>Color</span>
          <div className="flex items-center space-x-1.5">
            <input
              type="color"
              aria-label="Default arrow color"
              data-testid="global-arrow-color-picker"
              className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shrink-0"
              list="editor-global-arrow-color-list"
              value={colorToHex(arrowStyle?.color, theme === 'default' ? '#00b875' : '#00ff9d')}
              onChange={(e) => onSetColor(e.target.value)}
            />
            <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={arrowStyle?.color || 'Default'}>
              {arrowStyle?.color || 'Default'}
            </span>
            {arrowStyle?.color && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear default arrow color"
                data-testid="clear-global-arrow-color"
                title="Reset to theme default"
                onClick={(e) => {
                  e.preventDefault();
                  onSetColor('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSetColor('');
                  }
                }}
                className="text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 px-1 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer select-none shrink-0"
              >
                Clear
              </span>
            )}
          </div>
          <datalist id="editor-global-arrow-color-list">
            {arrowColors.map(c => <option key={c} value={c} />)}
          </datalist>
        </label>

        <label className="block">
          <span className={fieldLabel}>Width</span>
          <input
            type="number"
            min={1}
            max={10}
            className={fieldInput}
            placeholder="1-10"
            data-testid="global-arrow-width"
            value={arrowStyle?.width ?? ''}
            onChange={(e) => onSetWidth(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        Applies to every arrow that does not set its own color or width.
      </p>
    </div>
  );
}

interface ArrowFieldsProps {
  element: MessageElement | EdgeElement;
  diagramType: DiagramType;
  theme?: 'default' | 'dark';
  arrowStyle: ArrowStylePatch | null;
  arrowTags: ArrowTagInfo | null;
  arrowColors: string[];
  actorKeys: string[];
  onEditLabel: (newLabel: string) => void;
  onSetColor: (color: string) => void;
  onSetType: (operator: string) => void;
  onSetWidth: (width: number | '') => void;
  onSetDash: (dash: Dash) => void;
  onSetAnimation?: (anim: ArrowAnimationType) => void;
  onToggleActivation?: (endpoint: 'target' | 'source', active: boolean) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onSetKeyMode: (mode: ArrowKeyMode) => void;
  onRequestDelete: () => void;
}

function ArrowFields({
  element, diagramType, theme = 'dark', arrowStyle, arrowTags, arrowColors, actorKeys,
  onEditLabel, onSetColor, onSetType, onSetWidth, onSetDash, onSetAnimation,
  onToggleActivation, onAddTag, onRemoveTag, onSetKeyMode, onRequestDelete,
}: ArrowFieldsProps) {
  const vocabulary = diagramType === 'flowchart' ? FLOWCHART_OPERATORS : SEQUENCE_OPERATORS;
  const operators = vocabulary.includes(element.operator)
    ? vocabulary
    : [element.operator, ...vocabulary];
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const ownTags = arrowTags?.keys ?? [];
  const inheritedTags = arrowTags?.inherited ?? [];
  const keyMode: ArrowKeyMode = arrowTags?.keyMode ?? 'clean';

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
  };

  const submitExistingTag = () => {
    if (existingTagSelect) {
      onAddTag(existingTagSelect);
      setExistingTagSelect('');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 dark:text-slate-500">
        {element.kind === 'message' ? 'Message' : 'Edge'}:{' '}
        <span className="font-mono">{element.from} {element.operator} {element.to}</span>
      </p>

      <label className="block">
        <span className={fieldLabel}>Label</span>
        <input
          type="text"
          className={fieldInput}
          value={element.label ?? ''}
          onChange={(e) => onEditLabel(e.target.value)}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>Type</span>
          <select
            className={fieldInput}
            value={element.operator}
            onChange={(e) => onSetType(e.target.value)}
          >
            {operators.map(op => <option key={op} value={op}>{op}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={fieldLabel}>Color</span>
          <div className="flex items-center space-x-1.5">
            <input
              type="color"
              aria-label="Color"
              data-testid="arrow-color-picker"
              className="h-8 w-10 cursor-pointer rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shrink-0"
              list="editor-arrow-color-list"
              value={colorToHex(arrowStyle?.color, theme === 'default' ? '#00b875' : '#00ff9d')}
              onChange={(e) => onSetColor(e.target.value)}
            />
            <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={arrowStyle?.color || 'Default'}>
              {arrowStyle?.color || 'Default'}
            </span>
            {arrowStyle?.color && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear color"
                data-testid="clear-arrow-color"
                title="Reset to default color"
                onClick={(e) => {
                  e.preventDefault();
                  onSetColor('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSetColor('');
                  }
                }}
                className="text-xs text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 px-1 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer select-none shrink-0"
              >
                Clear
              </span>
            )}
          </div>
          <datalist id="editor-arrow-color-list">
            {arrowColors.map(c => <option key={c} value={c} />)}
          </datalist>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>Width</span>
          <input
            type="number"
            min={1}
            max={10}
            className={fieldInput}
            placeholder="1-10"
            value={arrowStyle?.width ?? ''}
            onChange={(e) => onSetWidth(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>

        <label className="block">
          <span className={fieldLabel}>Dash</span>
          <select
            className={fieldInput}
            value={arrowStyle?.dash ?? 'solid'}
            onChange={(e) => onSetDash(e.target.value as Dash)}
          >
            {DASH_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>

      {diagramType === 'sequence' && element.kind === 'message' && onToggleActivation && (
        <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-slate-800">
          <span className={fieldLabel}>Lifeline Activation</span>
          <label className="flex items-center space-x-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="activate-target-checkbox"
              checked={Boolean(element.activateTarget || element.activation === '+')}
              onChange={(e) => onToggleActivation('target', e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
            />
            <span>Activate receiver (+)</span>
          </label>
          <label className="flex items-center space-x-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              data-testid="deactivate-source-checkbox"
              checked={Boolean(element.deactivateSource || element.activation === '-')}
              onChange={(e) => onToggleActivation('source', e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
            />
            <span>Deactivate sender (-)</span>
          </label>
        </div>
      )}

      {onSetAnimation && (
        <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
          <AnimatedArrowSelector
            currentAnimation={arrowStyle?.animation ?? 'none'}
            currentColor={arrowStyle?.color ? colorToHex(arrowStyle?.color) : (theme === 'default' ? '#00b875' : '#00ff9d')}
            theme={theme}
            onSelectAnimation={onSetAnimation}
            onSelectColor={onSetColor}
            hasSelectedArrow={true}
            compact={true}
          />
        </div>
      )}

      <div>
        <span className={fieldLabel}>Inherit service tags</span>
        <div className="flex border border-gray-200 dark:border-slate-700 rounded overflow-hidden text-[10px] w-full bg-gray-50 dark:bg-slate-800">
          <button
            type="button"
            data-testid="arrow-inherit-on"
            title="Merged: the message also carries the tags of the service it originates from"
            onClick={() => onSetKeyMode('merged')}
            className={`flex-1 py-1 px-1 text-center font-medium transition-colors ${keyMode === 'merged' ? 'bg-blue-500 text-white shadow-xs' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'}`}
          >
            On
          </button>
          <button
            type="button"
            data-testid="arrow-inherit-off"
            title="Clean: only the message's own tags"
            onClick={() => onSetKeyMode('clean')}
            className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 dark:border-slate-700 ${keyMode === 'clean' ? 'bg-blue-500 text-white shadow-xs' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'}`}
          >
            Off
          </button>
        </div>
      </div>

      <div>
        <span className={fieldLabel}>Tags</span>
        {ownTags.length > 0 || inheritedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1 mb-1">
            {ownTags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {inheritedTags.map(tag => (
              <span
                key={tag}
                title={`Inherited from ${element.from}`}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {actorKeys.length > 0 && (
          <div className="flex space-x-1 mb-1">
            <select
              className={fieldInput}
              value={existingTagSelect}
              onChange={(e) => setExistingTagSelect(e.target.value)}
              data-testid="arrow-select-existing-tag"
              aria-label="Select existing tag"
            >
              <option value="">Select existing tag...</option>
              {actorKeys.map(k => (
                <option key={k} value={k}>#{k}</option>
              ))}
            </select>
            <button
              type="button"
              data-testid="arrow-add-existing-tag"
              disabled={!existingTagSelect}
              onClick={submitExistingTag}
              className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex space-x-1">
          <input
            type="text"
            className={fieldInput}
            placeholder="Add tag..."
            list="editor-arrow-tag-list"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTag();
              }
            }}
          />
          <button
            type="button"
            title="Add tag"
            data-testid="add-arrow-tag"
            onClick={submitTag}
            className="px-2 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            Add
          </button>
        </div>
        <datalist id="editor-arrow-tag-list">
          {actorKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      </div>

      <DeleteButton onRequestDelete={onRequestDelete} />
    </div>
  );
}

function DeleteButton({ onRequestDelete }: { onRequestDelete: () => void }) {
  return (
    <button
      type="button"
      data-testid="panel-delete"
      onClick={onRequestDelete}
      className="w-full flex items-center justify-center space-x-1 px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
    >
      <Trash2 size={12} />
      <span>Delete</span>
    </button>
  );
}
