'use client';

import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { ModelElement, ParticipantElement, NodeElement, MessageElement, EdgeElement, DiagramType } from '@/lib/model';
import { ArrowStylePatch, ArrowTagInfo } from '@/lib/editor';
import { DiagramConfig, ArrowKeyMode, ArrowAnimationType } from '@/lib/views';
import AnimatedArrowSelector from './AnimatedArrowSelector';

// Operator vocabularies (EDITING_PLAN.md Section 4.8); keep in sync with
// editor.ts (setArrowType validates against the same sets).
const SEQUENCE_OPERATORS = ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '-', '--'];
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
    case 'block': return `${el.blockType} block${el.title ? ` "${el.title}"` : ''}`;
    case 'region': return `region ${el.regionType}${el.value ? `=${el.value}` : ''}`;
    case 'config': return 'CONFIG header';
  }
}

const fieldLabel = 'text-xs font-semibold text-gray-400 block mb-1';
const fieldInput = 'w-full px-2 py-1 text-sm border rounded bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Properties panel for the structured editor (EDITING_PLAN.md 4.12).
export default function EditorPanel({
  element,
  selectedElements,
  elementsTagInfo,
  diagramType,
  config,
  arrowStyle,
  arrowTags,
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

  const isMultiSelect = Boolean(selectedElements && selectedElements.length > 1);
  const activeElement = isMultiSelect ? null : (element ?? (selectedElements && selectedElements.length === 1 ? selectedElements[0] : null));

  return (
    <div className="p-4">
      <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Editor</h2>
      {!isMultiSelect && !activeElement && (
        <>
          <p className="text-xs text-gray-500 italic">
            Click an element in the diagram to edit it.
          </p>
          <p className="text-xs text-gray-400 italic mt-1">
            {diagramType === 'flowchart'
              ? 'Drag a node onto another node to connect them, or drag it into empty space to move it.'
              : 'Drag an actor box to reorder it, or drag between lifelines to add a message.'}
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
        />
      )}
      {!isMultiSelect && activeElement && isComponent(activeElement) && (
        <ParticipantFields
          key={activeElement.key}
          element={activeElement}
          config={config}
          actorColors={actorColors}
          actorKeys={actorKeys}
          onEditLabel={onEditLabel}
          onSetColor={onSetColor}
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
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onSetKeyMode={onSetKeyMode}
          onRequestDelete={onRequestDelete}
        />
      )}
      {!isMultiSelect && activeElement && !isComponent(activeElement) && !isArrow(activeElement) && (
        <p className="text-xs text-gray-500 italic">
          This element is not editable.
        </p>
      )}
      {warning && (
        <p className="text-xs text-yellow-600 mt-2">{warning}</p>
      )}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="delete-dialog"
        >
          <div className="bg-white rounded shadow-lg p-4 w-80">
            <h3 className="text-sm font-semibold mb-2">
              Delete {describeElement(pendingDelete.element)}?
            </h3>
            {pendingDelete.cascaded.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">
                  This also removes {pendingDelete.cascaded.length} referencing
                  {' '}{pendingDelete.cascaded.length === 1 ? 'element' : 'elements'}:
                </p>
                <ul className="text-xs text-gray-700 list-disc pl-4 max-h-32 overflow-y-auto">
                  {pendingDelete.cascaded.map(el => (
                    <li key={el.key}>{describeElement(el)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end space-x-2">
              <button
                onClick={onCancelDelete}
                className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDelete}
                data-testid="confirm-delete"
                className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
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
}

function MultiElementFields({
  elements,
  elementsTagInfo,
  actorKeys,
  onAddTag,
  onRemoveTag,
}: MultiElementFieldsProps) {
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
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-700">
          Selected Elements ({elements.length})
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Hold Shift and click elements in the diagram to add or remove them.
        </p>
      </div>

      <div className="space-y-2 border border-blue-100 bg-blue-50/50 rounded p-2.5">
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
              className="px-2 text-xs rounded border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40"
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
            className="px-2 text-xs rounded border border-gray-200 bg-white hover:bg-gray-100"
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
              className="p-2 rounded border border-gray-200 bg-gray-50/60 space-y-1.5"
              data-testid={`multi-element-${item.element.key}`}
            >
              <div className="flex items-center justify-between text-xs font-medium text-gray-700">
                <span className="truncate mr-1" title={describeElement(item.element)}>
                  {describeElement(item.element)}
                </span>
                <span className="text-[10px] text-gray-400 font-mono flex-shrink-0">
                  {item.element.key}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(item.ownTags ?? []).length === 0 && (!item.inheritedTags || item.inheritedTags.length === 0) && (
                  <span className="text-[11px] text-gray-400 italic">No tags</span>
                )}
                {(item.ownTags ?? []).map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag} from ${describeElement(item.element)}`}
                      data-testid={`remove-tag-${item.element.key}-${tag}`}
                      onClick={() => onRemoveTag(tag, item.element.key)}
                      className="ml-1 hover:text-blue-900"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {item.inheritedTags?.map(tag => (
                  <span
                    key={tag}
                    title="Inherited"
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs"
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
  onEditLabel: (newLabel: string) => void;
  onSetColor: (color: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRequestDelete: () => void;
}

function ParticipantFields({
  element, config, actorColors, actorKeys,
  onEditLabel, onSetColor, onAddTag, onRemoveTag, onRequestDelete,
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
      <p className="text-xs text-gray-400">
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

      <label className="block">
        <span className={fieldLabel}>Color</span>
        <div className="flex items-center space-x-2">
          <input
            type="color"
            aria-label="Color"
            data-testid="actor-color-picker"
            className="h-8 w-12 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            list="editor-actor-color-list"
            value={colorToHex(meta?.color)}
            onChange={(e) => onSetColor(e.target.value)}
          />
          <span className="text-xs text-gray-500 font-mono flex-1">
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
              className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-100 cursor-pointer select-none"
            >
              Clear
            </span>
          )}
        </div>
        <datalist id="editor-actor-color-list">
          {actorColors.map(c => <option key={c} value={c} />)}
        </datalist>
      </label>

      <div>
        <span className={fieldLabel}>Tags</span>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  className="ml-1 hover:text-blue-900"
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
              className="px-2 text-xs rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-40"
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
            className="px-2 text-xs rounded border border-gray-200 hover:bg-gray-100"
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
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onSetKeyMode: (mode: ArrowKeyMode) => void;
  onRequestDelete: () => void;
}

function ArrowFields({
  element, diagramType, arrowStyle, arrowTags, arrowColors, actorKeys,
  onEditLabel, onSetColor, onSetType, onSetWidth, onSetDash, onSetAnimation,
  onAddTag, onRemoveTag, onSetKeyMode, onRequestDelete,
}: ArrowFieldsProps) {
  const vocabulary = diagramType === 'flowchart' ? FLOWCHART_OPERATORS : SEQUENCE_OPERATORS;
  const operators = vocabulary.includes(element.operator)
    ? vocabulary
    : [element.operator, ...vocabulary];
  const [tagInput, setTagInput] = useState('');
  const [existingTagSelect, setExistingTagSelect] = useState('');
  const ownTags = arrowTags?.keys ?? [];
  const inheritedTags = arrowTags?.inherited ?? [];
  const keyMode: ArrowKeyMode = arrowTags?.keyMode ?? 'merged';

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
        <div className="flex items-center space-x-2">
          <input
            type="color"
            aria-label="Color"
            data-testid="arrow-color-picker"
            className="h-8 w-12 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            list="editor-arrow-color-list"
            value={colorToHex(arrowStyle?.color)}
            onChange={(e) => onSetColor(e.target.value)}
          />
          <span className="text-xs text-gray-500 font-mono flex-1">
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
              className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-100 cursor-pointer select-none"
            >
              Clear
            </span>
          )}
        </div>
        <datalist id="editor-arrow-color-list">
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

      {onSetAnimation && (
        <div className="pt-2 border-t border-gray-100">
          <AnimatedArrowSelector
            currentAnimation={arrowStyle?.animation ?? 'none'}
            currentColor={arrowStyle?.color}
            onSelectAnimation={onSetAnimation}
            onSelectColor={onSetColor}
            hasSelectedArrow={true}
            compact={true}
          />
        </div>
      )}

      <div>
        <span className={fieldLabel}>Tags</span>
        {ownTags.length > 0 || inheritedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1 mb-1">
            {ownTags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  className="ml-1 hover:text-blue-900"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {inheritedTags.map(tag => (
              <span
                key={tag}
                title={`Inherited from ${element.from}`}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs"
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
              className="px-2 text-xs rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-40"
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
            className="px-2 text-xs rounded border border-gray-200 hover:bg-gray-100"
          >
            Add
          </button>
        </div>
        <datalist id="editor-arrow-tag-list">
          {actorKeys.map(k => <option key={k} value={k} />)}
        </datalist>
      </div>

      <div>
        <span className={fieldLabel}>Inherit service tags</span>
        <div className="flex border border-gray-200 rounded overflow-hidden text-[10px] w-full bg-gray-50">
          <button
            type="button"
            data-testid="arrow-inherit-on"
            title="Merged: the message also carries the tags of the service it originates from"
            onClick={() => onSetKeyMode('merged')}
            className={`flex-1 py-1 px-1 text-center font-medium transition-colors ${keyMode === 'merged' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
          >
            On
          </button>
          <button
            type="button"
            data-testid="arrow-inherit-off"
            title="Clean: only the message's own tags"
            onClick={() => onSetKeyMode('clean')}
            className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${keyMode === 'clean' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
          >
            Off
          </button>
        </div>
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
