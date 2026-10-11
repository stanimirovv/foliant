'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Trash2, GripHorizontal } from 'lucide-react';
import { StickyNote as StickyNoteType, StickyNoteColor } from '@/lib/views';

export interface StickyNoteProps {
  note: StickyNoteType;
  zoomScale?: number;
  getZoomScale?: () => number;
  onMove: (id: string, x: number, y: number) => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateColor: (id: string, color: StickyNoteColor) => void;
  onDelete: (id: string) => void;
}

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

const COLOR_KEYS: StickyNoteColor[] = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple'];

function formatInline(str: string): React.ReactNode {
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
        <code key={match.index} className="bg-black/10 px-1 py-0.5 rounded text-[11px] font-mono">
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

function renderSimpleMarkdown(text: string) {
  if (!text || !text.trim()) {
    return <span className="text-gray-400 italic text-xs">Double-click to type thoughts...</span>;
  }
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    // Checkbox line: - [ ] or - [x]
    const checkMatch = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)/);
    if (checkMatch) {
      const checked = checkMatch[1].toLowerCase() === 'x';
      return (
        <div key={idx} className="flex items-center gap-1.5 my-0.5 text-xs">
          <input
            type="checkbox"
            readOnly
            checked={checked}
            className="rounded text-amber-600 pointer-events-none w-3 h-3"
          />
          <span className={checked ? 'line-through opacity-70' : ''}>
            {formatInline(checkMatch[2])}
          </span>
        </div>
      );
    }
    // Bullet list: - text or * text
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      return (
        <div key={idx} className="flex items-start gap-1.5 my-0.5 ml-1 text-xs">
          <span className="select-none leading-none mt-1 text-[10px]">•</span>
          <span>{formatInline(bulletMatch[1])}</span>
        </div>
      );
    }
    // Header line: # text or ## text
    const headerMatch = line.match(/^#{1,3}\s+(.*)/);
    if (headerMatch) {
      return (
        <div key={idx} className="font-bold my-0.5 text-xs">
          {formatInline(headerMatch[1])}
        </div>
      );
    }
    // Regular line
    return (
      <div key={idx} className="min-h-[1.1rem] text-xs leading-relaxed">
        {formatInline(line)}
      </div>
    );
  });
}

export default function StickyNote({
  note,
  zoomScale = 1,
  getZoomScale,
  onMove,
  onUpdateText,
  onUpdateColor,
  onDelete,
}: StickyNoteProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [pos, setPos] = useState({ x: note.x, y: note.y });
  const [isDragging, setIsDragging] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const colorConfig = NOTE_COLORS[note.color || 'yellow'] || NOTE_COLORS.yellow;

  // Keep local pos and text in sync with props when not dragging/editing
  useEffect(() => {
    if (!isDragging) {
      setPos({ x: note.x, y: note.y });
    }
  }, [note.x, note.y, isDragging]);

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
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      data-testid={`sticky-note-${note.id}`}
      className={`sticky-note-card absolute select-none rounded border shadow-md transition-shadow hover:shadow-lg ${colorConfig.bg} ${colorConfig.border} ${colorConfig.text} flex flex-col`}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: '130px',
        height: '110px',
        zIndex: isDragging ? 50 : 20,
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => {
        if (!isEditing) setShowToolbar(false);
      }}
      onClick={(e) => e.stopPropagation()}
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
          {COLOR_KEYS.map((c) => (
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

      {/* Note Body */}
      <div
        className="flex-1 p-1.5 overflow-y-auto cursor-text text-[11px]"
        onDoubleClick={() => setIsEditing(true)}
        onClick={() => {
          if (!isEditing) setIsEditing(true);
        }}
      >
        {isEditing ? (
          <textarea
            data-testid={`sticky-note-textarea-${note.id}`}
            autoFocus
            value={text}
            onChange={handleTextChange}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleBlur();
              }
            }}
            placeholder="Type your thought..."
            className="w-full h-full bg-transparent resize-none outline-none text-[11px] leading-relaxed font-sans placeholder:text-black/30"
          />
        ) : (
          <div className="w-full h-full overflow-y-auto font-sans break-words select-text">
            {renderSimpleMarkdown(text)}
          </div>
        )}
      </div>
    </div>
  );
}
