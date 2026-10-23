'use client';

import React from 'react';
import { Play, Pause, SkipBack, SkipForward, X } from 'lucide-react';

export interface WalkthroughBarProps {
  theme: 'default' | 'dark';
  stepIndex: number;        // 0-based active step
  totalSteps: number;
  label?: string;           // bar readout: active message label or flowchart level caption
  isPlaying: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onExit: () => void;
  className?: string;
}

export default function WalkthroughBar({
  theme,
  stepIndex,
  totalSteps,
  label,
  isPlaying,
  onPrev,
  onNext,
  onTogglePlay,
  onExit,
  className,
}: WalkthroughBarProps) {
  const isDark = theme === 'dark';
  const atStart = totalSteps <= 0 || stepIndex <= 0;
  const atEnd = totalSteps <= 0 || stepIndex >= totalSteps - 1;

  const btnClass = `p-1.5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
    isDark ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
  }`;

  return (
    <div
      data-testid="walkthrough-bar"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={`absolute bottom-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-1 rounded-full border shadow-lg backdrop-blur-md px-2.5 py-1 ${
        isDark
          ? 'bg-slate-900/90 border-slate-700 text-slate-200'
          : 'bg-white/90 border-gray-200 text-gray-700'
      } ${className ?? ''}`}
    >
      <button
        type="button"
        data-testid="walkthrough-prev"
        title="Previous step (←)"
        aria-label="Previous step"
        disabled={atStart}
        onClick={onPrev}
        className={btnClass}
      >
        <SkipBack size={14} />
      </button>

      <button
        type="button"
        data-testid="walkthrough-play"
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        disabled={atEnd}
        onClick={onTogglePlay}
        className={btnClass}
      >
        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <button
        type="button"
        data-testid="walkthrough-next"
        title="Next step (→)"
        aria-label="Next step"
        disabled={atEnd}
        onClick={onNext}
        className={btnClass}
      >
        <SkipForward size={14} />
      </button>

      <div className={`w-px h-4 mx-1 ${isDark ? 'bg-slate-700' : 'bg-gray-300'}`} />

      <span
        data-testid="walkthrough-step-count"
        className="px-1 text-xs font-medium tabular-nums select-none whitespace-nowrap"
      >
        {totalSteps > 0 ? `Step ${stepIndex + 1}/${totalSteps}` : 'Step 0/0'}
      </span>

      <span
        data-testid="walkthrough-step-label"
        title={label}
        className={`w-[220px] truncate text-xs select-none px-1 ${
          isDark ? 'text-slate-300' : 'text-gray-600'
        }`}
      >
        {label ?? ''}
      </span>

      <span
        className={`hidden sm:inline text-[10px] select-none px-1 ${
          isDark ? 'text-slate-400' : 'text-gray-400'
        }`}
      >
        ←/→
      </span>

      <div className={`w-px h-4 mx-0.5 ${isDark ? 'bg-slate-700' : 'bg-gray-300'}`} />

      <button
        type="button"
        data-testid="walkthrough-exit"
        title="Exit presentation (Esc)"
        aria-label="Exit presentation"
        onClick={onExit}
        className={btnClass}
      >
        <X size={14} />
      </button>
    </div>
  );
}
