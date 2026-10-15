'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Trash2, GripHorizontal } from 'lucide-react';
import { StickyNote as StickyNoteType, StickyNoteColor } from '@/lib/views';

export interface StickyNoteProps {
  note: StickyNoteType;
  zoomScale?: number;
  getZoomScale?: () => number;
  selected?: boolean;
  onSelect?: (shiftKey: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateColor: (id: string, color: StickyNoteColor) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onDelete: (id: string) => void;
}

export const DEFAULT_NOTE_WIDTH = 130;
export const DEFAULT_NOTE_HEIGHT = 110;
const MIN_NOTE_WIDTH = 80;
const MIN_NOTE_HEIGHT = 70;
const MAX_NOTE_WIDTH = 600;
const MAX_NOTE_HEIGHT = 520;
// Text scales with the smaller relative dimension of the card, clamped so it
// stays legible at the minimum size and doesn't explode on huge cards.
const MIN_TEXT_SCALE = 0.6;
const MAX_TEXT_SCALE = 2.5;

export const NOTE_COLORS: Record<StickyNoteColor, {
  bg: string;
  border: string;
  text: string;
  dot: string;
  headerBg: string;
}> = {
  yellow: {
    bg: 'bg-amber-100',
    border: 'border-amber-300',
    text: 'text-amber-950',
    dot: 'bg-amber-400',
    headerBg: 'bg-amber-200/60',
  },
  green: {
    bg: 'bg-emerald-100',
    border: 'border-emerald-300',
    text: 'text-emerald-950',
    dot: 'bg-emerald-400',
    headerBg: 'bg-emerald-200/60',
  },
  blue: {
    bg: 'bg-sky-100',
    border: 'border-sky-300',
    text: 'text-sky-950',
    dot: 'bg-sky-400',
    headerBg: 'bg-sky-200/60',
  },
  pink: {
    bg: 'bg-rose-100',
    border: 'border-rose-300',
    text: 'text-rose-950',
    dot: 'bg-rose-400',
    headerBg: 'bg-rose-200/60',
  },
  orange: {
    bg: 'bg-orange-100',
    border: 'border-orange-300',
    text: 'text-orange-950',
    dot: 'bg-orange-400',
    headerBg: 'bg-orange-200/60',
  },
  purple: {
    bg: 'bg-purple-100',
    border: 'border-purple-300',
    text: 'text-purple-950',
    dot: 'bg-purple-400',
    headerBg: 'bg-purple-200/60',
  },
};

export const STICKY_NOTE_COLOR_KEYS: StickyNoteColor[] = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'];

// Font size for note text at a given card scale: the note's fixed px sizes
// multiplied by the scale so the text shrinks/grows with the card.
function scaledFont(basePx: number, scale: number): React.CSSProperties {
  return { fontSize: `${Math.round(basePx * scale * 10) / 10}px` };
}

function formatInline(str: string, scale: number): React.ReactNode {
  // Simple token parser for **bold**, *italic*, and `code`
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parts.push(str.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={match.index} className="bg-black/10 px-1 py-0.5 rounded font-mono" style={scaledFont(11, scale)}>
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < str.length) {
    parts.push(str.slice(lastIndex));
  }
  return parts.length === 0 ? str : parts;
}

function renderSimpleMarkdown(text: string, scale: number) {
  if (!text || !text.trim()) {
    return <span className="text-gray-400 italic" style={scaledFont(12, scale)}>Double-click to type thoughts...</span>;
  }
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    // Checkbox line: - [ ] or - [x]
    const checkMatch = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)/);
    if (checkMatch) {
      const checked = checkMatch[1].toLowerCase() === 'x';
      return (
        <div key={idx} className="flex items-center gap-1.5 my-0.5" style={scaledFont(12, scale)}>
          <input
            type="checkbox"
            readOnly
            checked={checked}
            className="rounded text-amber-600 pointer-events-none w-3 h-3"
          />
          <span className={checked ? 'line-through opacity-70' : ''}>
            {formatInline(checkMatch[2], scale)}
          </span>
        </div>
      );
    }
    // Bullet list: - text or * text
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      return (
        <div key={idx} className="flex items-start gap-1.5 my-0.5 ml-1" style={scaledFont(12, scale)}>
          <span className="select-none leading-none mt-1" style={scaledFont(10, scale)}>•</span>
          <span>{formatInline(bulletMatch[1], scale)}</span>
        </div>
      );
    }
    // Header line: # text or ## text
    const headerMatch = line.match(/^#{1,3}\s+(.*)/);
    if (headerMatch) {
      return (
        <div key={idx} className="font-bold my-0.5" style={scaledFont(12, scale)}>
          {formatInline(headerMatch[1], scale)}
        </div>
      );
    }
    // Regular line
    return (
      <div key={idx} className="min-h-[1.1rem] leading-relaxed" style={scaledFont(12, scale)}>
        {formatInline(line, scale)}
      </div>
    );
  });
}

export default function StickyNote({
  note,
  zoomScale = 1,
  getZoomScale,
  selected = false,
  onSelect,
  onMove,
  onUpdateText,
  onUpdateColor,
  onResize,
  onDelete,
}: StickyNoteProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [pos, setPos] = useState({ x: note.x, y: note.y });
  const [size, setSize] = useState({
    width: note.width ?? DEFAULT_NOTE_WIDTH,
    height: note.height ?? DEFAULT_NOTE_HEIGHT,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // A click that immediately follows a drag is the drag's trailing click
  // event, not a selection gesture.
  const suppressClickAfterDragRef = useRef(false);

  const colorConfig = NOTE_COLORS[note.color || 'yellow'] || NOTE_COLORS.yellow;

  // Keep local pos, size and text in sync with props when not dragging/editing
  useEffect(() => {
    if (!isDragging) {
      setPos({ x: note.x, y: note.y });
    }
  }, [note.x, note.y, isDragging]);

  useEffect(() => {
    if (!isResizing) {
      setSize({
        width: note.width ?? DEFAULT_NOTE_WIDTH,
        height: note.height ?? DEFAULT_NOTE_HEIGHT,
      });
    }
  }, [note.width, note.height, isResizing]);

  useEffect(() => {
    if (!isEditing) {
      setText(note.text);
    }
  }, [note.text, isEditing]);

  // Debounced text commit
  const commitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
    commitTimeoutRef.current = setTimeout(() => {
      onUpdateText(note.id, newText);
    }, 500);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    onUpdateText(note.id, text);
  };

  // Dragging logic
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left-click
    e.stopPropagation();
    e.preventDefault();

    suppressClickAfterDragRef.current = false;
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };

    const handleMouseMove = (moveEvt: MouseEvent) => {
      if (!dragStartRef.current) return;
      const scale = getZoomScale ? getZoomScale() : (zoomScale || 1);
      const dx = (moveEvt.clientX - dragStartRef.current.clientX) / (scale || 1);
      const dy = (moveEvt.clientY - dragStartRef.current.clientY) / (scale || 1);
      const newX = Math.round(dragStartRef.current.startX + dx);
      const newY = Math.round(dragStartRef.current.startY + dy);
      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setIsDragging(false);
      const finalPos = posRef.current;
      dragStartRef.current = null;
      if (finalPos.x !== note.x || finalPos.y !== note.y) {
        onMove(note.id, finalPos.x, finalPos.y);
        suppressClickAfterDragRef.current = true;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Corner-resize logic: dragging the bottom-right handle inwards shrinks the
  // card, outwards grows it. The card is anchored at its top-left corner.
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left-click
    e.stopPropagation();
    e.preventDefault();

    suppressClickAfterDragRef.current = false;
    setIsResizing(true);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startWidth = sizeRef.current.width;
    const startHeight = sizeRef.current.height;

    const handleMouseMove = (moveEvt: MouseEvent) => {
      const scale = getZoomScale ? getZoomScale() : (zoomScale || 1);
      const dx = (moveEvt.clientX - startClientX) / (scale || 1);
      const dy = (moveEvt.clientY - startClientY) / (scale || 1);
      const newWidth = Math.round(Math.min(MAX_NOTE_WIDTH, Math.max(MIN_NOTE_WIDTH, startWidth + dx)));
      const newHeight = Math.round(Math.min(MAX_NOTE_HEIGHT, Math.max(MIN_NOTE_HEIGHT, startHeight + dy)));
      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setIsResizing(false);
      const finalSize = sizeRef.current;
      const propWidth = note.width ?? DEFAULT_NOTE_WIDTH;
      const propHeight = note.height ?? DEFAULT_NOTE_HEIGHT;
      if (finalSize.width !== propWidth || finalSize.height !== propHeight) {
        onResize?.(note.id, finalSize.width, finalSize.height);
        suppressClickAfterDragRef.current = true;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Text follows the card's smaller relative dimension, clamped to a legible
  // range.
  const textScale = Math.min(
    MAX_TEXT_SCALE,
    Math.max(MIN_TEXT_SCALE, Math.min(size.width / DEFAULT_NOTE_WIDTH, size.height / DEFAULT_NOTE_HEIGHT))
  );

  return (
    <div
      data-testid={`sticky-note-${note.id}`}
      data-selected={selected ? 'true' : undefined}
      className={`sticky-note-card absolute select-none rounded border shadow-md transition-shadow hover:shadow-lg ${colorConfig.bg} ${colorConfig.border} ${colorConfig.text} flex flex-col ${selected ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        zIndex: isDragging || isResizing ? 50 : 20,
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => {
        if (!isEditing) setShowToolbar(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickAfterDragRef.current) {
          suppressClickAfterDragRef.current = false;
          return;
        }
        onSelect?.(e.shiftKey);
      }}
    >
      {/* Top Header / Drag Handle */}
      <div
        data-testid={`sticky-note-handle-${note.id}`}
        className={`sticky-note-handle flex items-center justify-between px-1.5 py-0.5 cursor-grab active:cursor-grabbing border-b border-black/5 ${colorConfig.headerBg}`}
        onMouseDown={handleDragMouseDown}
      >
        <div className="flex items-center gap-0.5 opacity-60">
          <GripHorizontal className="w-3 h-3" />
        </div>

        {/* Inline Mini-Toolbar (Color dots + Delete) */}
        <div
          className={`flex items-center gap-1 transition-opacity ${
            showToolbar || isEditing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {STICKY_NOTE_COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`color-${c}-${note.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onUpdateColor(note.id, c);
              }}
              className={`w-2 h-2 rounded-full ${NOTE_COLORS[c].dot} border border-black/20 hover:scale-125 transition-transform ${
                (note.color || 'yellow') === c ? 'ring-1 ring-black/40 ring-offset-0.5' : ''
              }`}
              title={c}
            />
          ))}
          <button
            type="button"
            data-testid={`delete-note-${note.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            className="p-0.5 text-gray-500 hover:text-red-600 rounded transition-colors ml-0.5"
            title="Delete note"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Note Body: click selects the note (via the card root), double-click edits */}
      <div
        className="flex-1 p-1.5 overflow-y-auto cursor-text"
        style={scaledFont(11, textScale)}
        onDoubleClick={() => setIsEditing(true)}
      >
        {isEditing ? (
          <textarea
            data-testid={`sticky-note-textarea-${note.id}`}
            autoFocus
            value={text}
            onChange={handleTextChange}
            onBlur={handleBlur}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleBlur();
              }
            }}
            placeholder="Type your thought..."
            className="w-full h-full bg-transparent resize-none outline-none leading-relaxed font-sans placeholder:text-black/30"
            style={scaledFont(11, textScale)}
          />
        ) : (
          <div className="w-full h-full overflow-y-auto font-sans break-words select-text">
            {renderSimpleMarkdown(text, textScale)}
          </div>
        )}
      </div>

      {/* Bottom-right corner resize handle */}
      <div
        data-testid={`sticky-note-resize-${note.id}`}
        className={`absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize flex items-end justify-end pr-0.5 pb-0.5 transition-opacity ${
          showToolbar || selected ? 'opacity-100' : 'opacity-0'
        }`}
        onMouseDown={handleResizeMouseDown}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" className="text-black/30" aria-hidden="true">
          <path d="M8 1 L1 8 M8 4.5 L4.5 8 M8 7 L7 8" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
