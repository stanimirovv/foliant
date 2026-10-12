'use client';

import React, { useState } from 'react';
import { ChevronUp, ChevronDown, Sparkles, Zap } from 'lucide-react';
import { ArrowAnimationType } from '@/lib/views';
import AnimatedArrowSelector from './AnimatedArrowSelector';

interface BottomAnimatedArrowBarProps {
  currentAnimation?: ArrowAnimationType;
  currentColor?: string;
  hasSelectedArrow?: boolean;
  onSelectAnimation: (anim: ArrowAnimationType) => void;
  onSelectColor: (color: string) => void;
  onConvertDiagram: () => void;
}

export default function BottomAnimatedArrowBar({
  currentAnimation = 'none',
  currentColor,
  hasSelectedArrow = false,
  onSelectAnimation,
  onSelectColor,
  onConvertDiagram,
}: BottomAnimatedArrowBarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      data-testid="bottom-animated-arrow-bar"
      className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none flex flex-col items-center"
    >
      <div className="w-full max-w-3xl pointer-events-auto bg-white/95 backdrop-blur-md border-t border-x border-gray-200/80 rounded-t-xl shadow-xl transition-all duration-300 ease-in-out">
        {/* Toggle Bar Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 select-none">
          <button
            type="button"
            data-testid="toggle-animated-arrows-bar"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 text-xs font-semibold text-gray-700 hover:text-blue-600 transition-colors"
          >
            <div className="w-5 h-5 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center">
              <Zap size={13} />
            </div>
            <span>Animated Arrows</span>
            <span className="text-[11px] font-normal text-gray-400">
              (6 Motion Styles &bull; 10 Base Colors)
            </span>
            {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="convert-diagram-bar-btn"
              onClick={onConvertDiagram}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors border border-indigo-200/50"
              title="Deterministically convert all diagram arrows to animated arrows"
            >
              <Sparkles size={12} className="text-indigo-500" />
              Convert Diagram
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xs"
            >
              {isOpen ? 'Minimize' : 'Expand'}
            </button>
          </div>
        </div>

        {/* Expandable Content (from bottom up) */}
        {isOpen && (
          <div className="p-3 max-h-80 overflow-y-auto">
            {hasSelectedArrow ? (
              <p className="text-[11px] text-blue-600 font-medium mb-2 bg-blue-50/60 px-2 py-1 rounded">
                Editing selected arrow &mdash; select an animation or base color below to apply:
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 mb-2 italic">
                Select any arrow in the diagram to apply motion styles, or click &ldquo;Convert Diagram&rdquo; to auto-convert all:
              </p>
            )}

            <AnimatedArrowSelector
              currentAnimation={currentAnimation}
              currentColor={currentColor}
              onSelectAnimation={onSelectAnimation}
              onSelectColor={onSelectColor}
              hasSelectedArrow={hasSelectedArrow}
              compact={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
