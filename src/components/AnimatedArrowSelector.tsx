'use client';

import React from 'react';
import { Sparkles, Check, Play } from 'lucide-react';
import { ArrowAnimationType } from '@/lib/views';
import {
  ANIMATED_ARROW_PRESETS,
  ANIMATED_ARROW_COLORS,
} from '@/lib/styling';

interface AnimatedArrowSelectorProps {
  currentAnimation?: ArrowAnimationType;
  currentColor?: string;
  onSelectAnimation: (anim: ArrowAnimationType) => void;
  onSelectColor: (color: string) => void;
  onConvertDiagram?: () => void;
  hasSelectedArrow?: boolean;
  compact?: boolean;
}

export default function AnimatedArrowSelector({
  currentAnimation = 'none',
  currentColor,
  onSelectAnimation,
  onSelectColor,
  onConvertDiagram,
  hasSelectedArrow = false,
  compact = false,
}: AnimatedArrowSelectorProps) {
  const activeColor = currentColor?.trim().toLowerCase() || '#10b981';

  return (
    <div className={`space-y-3 ${compact ? 'text-xs' : 'text-sm'}`}>
      {/* 6 Default Animated Arrows */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide flex items-center gap-1">
            <Play size={12} className="text-blue-500" />
            Animated Arrows (6 Styles)
          </span>
          {currentAnimation !== 'none' && (
            <button
              type="button"
              data-testid="clear-arrow-animation"
              onClick={() => onSelectAnimation('none')}
              className="text-[11px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 underline"
            >
              Reset Animation
            </button>
          )}
        </div>

        <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-6'} gap-1.5`}>
          {ANIMATED_ARROW_PRESETS.map((preset) => {
            const isSelected = currentAnimation === preset.id;
            const previewColor = isSelected ? activeColor : (preset.isError ? '#f43f5e' : '#10b981');
            const markerId = `marker-${preset.id}-${compact ? 'compact' : 'full'}`;

            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`select-animation-${preset.id}`}
                onClick={() => onSelectAnimation(preset.id)}
                className={`flex flex-col items-center justify-between p-1.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 shadow-xs ring-1 ring-blue-400'
                    : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 hover:border-gray-300 dark:hover:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
                title={`${preset.name}: ${preset.description}`}
              >
                <div className="w-full flex justify-between items-center mb-1">
                  <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200 truncate">
                    {preset.name}
                  </span>
                  {isSelected && <Check size={10} className="text-blue-600 dark:text-blue-400 shrink-0" />}
                </div>

                {/* Live SVG animation preview */}
                <div className="w-full h-5 flex items-center justify-center overflow-hidden">
                  <svg
                    width="100%"
                    height="18"
                    viewBox="0 0 80 18"
                    className="overflow-visible"
                    style={{ color: previewColor }}
                  >
                    <defs>
                      <marker
                        id={markerId}
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={previewColor} />
                      </marker>
                    </defs>
                    {preset.id === 'pulse' ? (
                      <>
                        <line
                          x1="4"
                          y1="9"
                          x2="68"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          opacity="0.6"
                          markerEnd={`url(#${markerId})`}
                        />
                        <line
                          x1="4"
                          y1="9"
                          x2="68"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="3.5"
                          pathLength="100"
                          className="arrow-anim-packet-runner"
                        />
                      </>
                    ) : (preset.id === 'broken-network' || preset.id === 'ricochet') ? (
                      <>
                        {/* Severed gap with cutoff breaker caps & floating broken connection badge */}
                        <line
                          x1="4"
                          y1="9"
                          x2="25"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          className="arrow-anim-broken-network"
                        />
                        <line
                          x1="25"
                          y1="3"
                          x2="25"
                          y2="15"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          className="arrow-breaker-cap"
                        />
                        <line
                          x1="43"
                          y1="3"
                          x2="43"
                          y2="15"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          className="arrow-breaker-cap"
                        />
                        <line
                          x1="43"
                          y1="9"
                          x2="68"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          markerEnd={`url(#${markerId})`}
                          className="arrow-anim-broken-network"
                        />
                        <g className="arrow-x-mark" transform="translate(34, 9)">
                          <circle r="5.5" fill="#ffffff" stroke={previewColor} strokeWidth="1.6" />
                          <line x1="-2.4" y1="-2.4" x2="2.4" y2="2.4" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                          <line x1="-2.4" y1="2.4" x2="2.4" y2="-2.4" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                        </g>
                      </>
                    ) : (preset.id === 'broken-sender' || preset.id === 'stutter') ? (
                      <>
                        <line
                          x1="4"
                          y1="9"
                          x2="68"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.5"
                          markerEnd={`url(#${markerId})`}
                          className="arrow-anim-broken-sender"
                        />
                        {/* Origin barrier wall and shockwave burst circle at sender (matching receiver) */}
                        <line x1="4" y1="2" x2="4" y2="16" stroke={previewColor} strokeWidth="2.8" strokeLinecap="round" className="arrow-barrier-wall" />
                        <circle cx="4" cy="9" r="3" fill="none" stroke={previewColor} strokeWidth="1.8" className="arrow-shockwave-burst" />
                        <g className="arrow-x-mark" transform="translate(14, 9)">
                          <circle r="5.5" fill="#ffffff" stroke={previewColor} strokeWidth="1.4" />
                          <line x1="-2.5" y1="-2.5" x2="2.5" y2="2.5" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                          <line x1="-2.5" y1="2.5" x2="2.5" y2="-2.5" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                        </g>
                      </>
                    ) : (preset.id === 'broken-receiver' || preset.id === 'hesitate') ? (
                      <>
                        <line
                          x1="4"
                          y1="9"
                          x2="66"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          markerEnd={`url(#${markerId})`}
                          className="arrow-anim-broken-receiver"
                        />
                        <line
                          x1="68"
                          y1="2"
                          x2="68"
                          y2="16"
                          stroke={previewColor}
                          strokeWidth="2.8"
                          strokeLinecap="round"
                          className="arrow-barrier-wall"
                        />
                        <circle cx="68" cy="9" r="3" fill="none" stroke={previewColor} strokeWidth="1.8" className="arrow-shockwave-burst" />
                        <g className="arrow-x-mark" transform="translate(54, 9)">
                          <circle r="5.5" fill="#ffffff" stroke={previewColor} strokeWidth="1.4" />
                          <line x1="-2.5" y1="-2.5" x2="2.5" y2="2.5" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                          <line x1="-2.5" y1="2.5" x2="2.5" y2="-2.5" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                        </g>
                      </>
                    ) : (
                      <line
                        x1="4"
                        y1="9"
                        x2="68"
                        y2="9"
                        stroke={previewColor}
                        strokeWidth="2.4"
                        markerEnd={`url(#${markerId})`}
                        className={`arrow-anim-${preset.id}`}
                      />
                    )}
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 10 Base Colors: 5 Positive (Green/Blue) + 5 Error (Orange/Red) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
            Base Color (5 Happy Paths / 5 Errors)
          </span>
          {hasSelectedArrow && (
            <span className="text-[10px] text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
              Selected Arrow
            </span>
          )}
        </div>

        <div className="space-y-1.5 bg-gray-50/70 dark:bg-slate-800/50 p-2 rounded-lg border border-gray-100 dark:border-slate-800">
          {/* 5 Happy Path / Positive Colors (Green & Blue) */}
          <div>
            <div className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Positive Streams (Green / Blue)
            </div>
            <div className="flex items-center gap-2">
              {ANIMATED_ARROW_COLORS.positive.map((c) => {
                const isSelected = activeColor === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    type="button"
                    data-testid={`color-positive-${c.name.toLowerCase()}`}
                    onClick={() => onSelectColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-xs ${
                      isSelected ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white dark:ring-offset-slate-900 scale-105' : 'border border-black/10'
                    }`}
                    title={`${c.name} (${c.hex}) - Happy Path`}
                  >
                    {isSelected && <Check size={12} className="text-white drop-shadow-sm" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5 Error / Warning Colors (Orange & Red) */}
          <div className="pt-1 border-t border-gray-200/60 dark:border-slate-700/60">
            <div className="text-[10px] font-medium text-rose-700 dark:text-rose-400 mb-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Failure Modes (Orange / Red)
            </div>
            <div className="flex items-center gap-2">
              {ANIMATED_ARROW_COLORS.error.map((c) => {
                const isSelected = activeColor === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    type="button"
                    data-testid={`color-error-${c.name.toLowerCase()}`}
                    onClick={() => onSelectColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-xs ${
                      isSelected ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white dark:ring-offset-slate-900 scale-105' : 'border border-black/10'
                    }`}
                    title={`${c.name} (${c.hex}) - Error / Failure`}
                  >
                    {isSelected && <Check size={12} className="text-white drop-shadow-sm" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Convert Diagram Action */}
      {onConvertDiagram && (
        <div className="pt-1 flex items-center justify-between">
          <button
            type="button"
            data-testid="convert-animated-arrows-btn"
            onClick={onConvertDiagram}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-md text-xs font-medium shadow-xs transition-all"
            title="Deterministically convert all diagram arrows to animated happy paths and failure flows"
          >
            <Sparkles size={13} className="text-amber-300" />
            Convert Diagram to Animated Arrows
          </button>
        </div>
      )}
    </div>
  );
}
