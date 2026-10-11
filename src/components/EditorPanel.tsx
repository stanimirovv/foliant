'use client';

import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { ModelElement, ParticipantElement, NodeElement, MessageElement, EdgeElement, DiagramType } from '@/lib/model';
import { ArrowStylePatch, ArrowTagInfo } from '@/lib/editor';
import { DiagramConfig, ArrowKeyMode } from '@/lib/views';

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

interface EditorPanelProps {
  element: ModelElement | null;   // selected raw element (null = nothing selected)
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
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
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

  return (
    <div className="p-4">
      <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Editor</h2>
      {!element && (
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
      {element && isComponent(element) && (
        <ParticipantFields
          key={element.key}
          element={element}
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
      {element && isArrow(element) && (
        <ArrowFields
          key={element.key}
          element={element}
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
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onSetKeyMode={onSetKeyMode}
          onRequestDelete={onRequestDelete}
        />
      )}
      {element && !isComponent(element) && !isArrow(element) && (
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
  const meta = config?.actors?.[element.id];
  const label = element.kind === 'participant' ? (element.alias ?? '') : (element.label ?? '');
  const tags = meta?.keys ?? [];

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
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
        <input
          type="text"
          className={fieldInput}
          placeholder="#rrggbb or name"
          list="editor-actor-color-list"
          value={meta?.color ?? ''}
          onChange={(e) => onSetColor(e.target.value)}
        />
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
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onSetKeyMode: (mode: ArrowKeyMode) => void;
  onRequestDelete: () => void;
}

function ArrowFields({
  element, diagramType, arrowStyle, arrowTags, arrowColors, actorKeys,
  onEditLabel, onSetColor, onSetType, onSetWidth, onSetDash,
  onAddTag, onRemoveTag, onSetKeyMode, onRequestDelete,
}: ArrowFieldsProps) {
  const vocabulary = diagramType === 'flowchart' ? FLOWCHART_OPERATORS : SEQUENCE_OPERATORS;
  const operators = vocabulary.includes(element.operator)
    ? vocabulary
    : [element.operator, ...vocabulary];
  const [tagInput, setTagInput] = useState('');
  const ownTags = arrowTags?.keys ?? [];
  const inheritedTags = arrowTags?.inherited ?? [];
  const keyMode: ArrowKeyMode = arrowTags?.keyMode ?? 'merged';

  const submitTag = () => {
    const tag = tagInput.trim();
    if (tag) onAddTag(tag);
    setTagInput('');
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
        <input
          type="text"
          className={fieldInput}
          placeholder="#rrggbb or name"
          list="editor-arrow-color-list"
          value={arrowStyle?.color ?? ''}
          onChange={(e) => onSetColor(e.target.value)}
        />
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
