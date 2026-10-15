'use client';

import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { ModelElement, ParticipantElement, NodeElement, MessageElement, EdgeElement, NoteElement, StickyNoteElement, DiagramType, NodeShape, ParticipantType } from '@/lib/model';
import { ArrowStylePatch, ArrowTagInfo, PRESET_ACTOR_COLORS } from '@/lib/editor';
import { DiagramConfig, ArrowKeyMode, ArrowAnimationType, ArrowStyleDefaults, StickyNote, StickyNoteColor } from '@/lib/views';
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
  config: DiagramConfig | null;   // current CONFIG (field values + datalists)
  arrowStyle: ArrowStylePatch | null;  // current style of the selected message/edge
  arrowTags: ArrowTagInfo | null; // tags of the selected message/edge (own + behavior)
  globalArrowStyle?: ArrowStyleDefaults | null;  // CONFIG.defaultArrowStyle (all-arrows fallback)
  onSetGlobalColor?: (color: string) => void;   // edit the all-arrows default color ('' clears)
  onSetGlobalWidth?: (width: number | '') => void;  // edit the all-arrows default width ('' clears)
  noteTags?: string[] | null;   // tags of the selected note (null when no note is selected)
  stickyNoteTags?: string[] | null;  // tags of the selected sticky note (null when no sticky note is selected)
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
  config,
  arrowStyle,
  arrowTags,
  globalArrowStyle,
  onSetGlobalColor,
  onSetGlobalWidth,
  noteTags,
  stickyNoteTags,
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
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: EditorPanelProps) {
  const actorColors: string[] = [];
  const actorKeys: string[] = [];
  const arrowColors: string[] = [];
  if (config?.actors) {
    for (const meta of Object.values(config.actors)) {
      if (meta.color && !actorColors.includes(meta.color)) actorColors.push(meta.color);
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
    <div className="p-4" data-testid="editor-panel">
      <h2 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 mb-2">Editor</h2>
      {!isMultiSelect && !activeElement && (
        <>
          {onSetGlobalColor && onSetGlobalWidth && (
            <GlobalArrowFields
              arrowStyle={globalArrowStyle ?? null}
              arrowColors={arrowColors}
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
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onGroupParticipants={onGroupParticipants}
        />
      )}
      {!isMultiSelect && activeElement && isComponent(activeElement) && (
        <ParticipantFields
          key={activeElement.key}
          element={activeElement}
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
          inheritedTags={activeInheritedTags}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
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
      {!isMultiSelect && activeElement && !isComponent(activeElement) && !isArrow(activeElement) && activeElement.kind !== 'note' && activeElement.kind !== 'sticky' && (
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
  onAddTag: (tag: string, targetKey?: string) => void;
  onRemoveTag: (tag: string, targetKey?: string) => void;
  onGroupParticipants?: (participantKeys: string[], title: string, color?: string) => void;
}

function MultiElementFields({
  elements,
  elementsTagInfo,
  actorKeys,
  onAddTag,
  onRemoveTag,
  onGroupParticipants,
}: MultiElementFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const [boxTitle, setBoxTitle] = useState('Group');
  const [boxColor, setBoxColor] = useState('');

  const participants = elements.filter((el): el is ParticipantElement => el.kind === 'participant');

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
              placeholder="Color (e.g. #213b5e, #1e293b)"
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

      <div className="space-y-2 border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 rounded p-2.5">
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

      <div className="space-y-2">
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
    </div>
  );
}

interface ComponentFieldsProps {
  element: ParticipantElement | NodeElement;
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
  element, config, actorColors, actorKeys, inheritedTags,
  onEditLabel, onSetColor, onSetParticipantKind, onSetNodeShape, onAddTag, onRemoveTag, onRequestDelete,
}: ComponentFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const meta = config?.actors?.[element.id];
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
                value={colorToHex(meta?.color)}
                onChange={(e) => onSetColor(e.target.value)}
              />
              <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={meta?.color || 'Default'}>
                {meta?.color || 'Default'}
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
                value={colorToHex(meta?.color)}
                onChange={(e) => onSetColor(e.target.value)}
              />
              <span className="text-xs text-gray-500 dark:text-slate-400 font-mono truncate flex-1 min-w-0" title={meta?.color || 'Default'}>
                {meta?.color || 'Default'}
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
              value={colorToHex(meta?.color)}
              onChange={(e) => onSetColor(e.target.value)}
            />
            <span className="text-xs text-gray-500 dark:text-slate-400 font-mono flex-1">
              {meta?.color || 'Default'}
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
          {PRESET_ACTOR_COLORS.slice(0, 10).map((c) => {
            const isSelected = meta?.color?.toLowerCase() === c.toLowerCase();
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
                    ? 'ring-2 ring-blue-500 border-white scale-110 shadow-sm'
                    : 'border-slate-700/80 hover:scale-105 hover:border-slate-500'
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
  inheritedTags?: string[];     // structural (subgraph) tags, read-only
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

function NoteFields({
  element, tags, actorKeys, inheritedTags, onAddTag, onRemoveTag,
}: NoteFieldsProps) {
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');

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
        Note over <span className="font-mono">{element.over.join(', ')}</span>
      </p>
      <p className="text-xs text-gray-600 dark:text-slate-300 italic">
        {element.text}
      </p>

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
  onSetColor: (color: string) => void;
  onSetWidth: (width: number | '') => void;
}

// Default style applied to every arrow without its own entry field
// (CONFIG.defaultArrowStyle). Shown when nothing is selected.
function GlobalArrowFields({ arrowStyle, arrowColors, onSetColor, onSetWidth }: GlobalArrowFieldsProps) {
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
  element, diagramType, arrowStyle, arrowTags, arrowColors, actorKeys,
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
      <p className="text-xs text-gray-400">
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
            currentColor={arrowStyle?.color ? colorToHex(arrowStyle?.color) : '#00ff9d'}
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
