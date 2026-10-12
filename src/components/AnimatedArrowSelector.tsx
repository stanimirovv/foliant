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
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <Play size={12} className="text-blue-500" />
            Animated Arrows (6 Styles)
          </span>
          {currentAnimation !== 'none' && (
            <button
              type="button"
              data-testid="clear-arrow-animation"
              onClick={() => onSelectAnimation('none')}
              className="text-[11px] text-gray-400 hover:text-gray-600 underline"
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
                    ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-400'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
                title={`${preset.name}: ${preset.description}`}
              >
                <div className="w-full flex justify-between items-center mb-1">
                  <span className="text-[11px] font-medium text-gray-700 truncate">
                    {preset.name}
                  </span>
                  {isSelected && <Check size={10} className="text-blue-600 shrink-0" />}
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
                        {/* Severed gap with electric arc & floating broken connection badge */}
                        <line
                          x1="4"
                          y1="9"
                          x2="26"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          className="arrow-anim-broken-network"
                        />
                        <line
                          x1="26"
                          y1="4"
                          x2="26"
                          y2="14"
                          stroke={previewColor}
                          strokeWidth="2"
                          strokeLinecap="round"
                          className="arrow-breaker-cap"
                        />
                        <path
                          d="M 26 9 L 31 5 L 37 13 L 42 9"
                          fill="none"
                          stroke="#67e8f9"
                          strokeWidth="2"
                          className="arrow-zap-spark"
                        />
                        <line
                          x1="42"
                          y1="4"
                          x2="42"
                          y2="14"
                          stroke={previewColor}
                          strokeWidth="2"
                          strokeLinecap="round"
                          className="arrow-breaker-cap"
                        />
                        <line
                          x1="42"
                          y1="9"
                          x2="68"
                          y2="9"
                          stroke={previewColor}
                          strokeWidth="2.2"
                          markerEnd={`url(#${markerId})`}
                          className="arrow-anim-broken-network"
                        />
                        <g className="arrow-x-mark" transform="translate(34, 9)">
                          <circle r="6" fill="#ffffff" stroke={previewColor} strokeWidth="1.6" />
                          <line x1="-2.8" y1="-2.8" x2="2.8" y2="2.8" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
                          <line x1="-2.8" y1="2.8" x2="2.8" y2="-2.8" stroke={previewColor} strokeWidth="1.8" strokeLinecap="round" />
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
                        <circle cx="14" cy="9" r="7" fill="none" stroke={previewColor} strokeWidth="1.2" className="arrow-alarm-ping" />
                        <g className="arrow-x-mark" transform="translate(14, 9)">
                          <circle r="5.5" fill="#ef4444" stroke="#ffffff" strokeWidth="1" />
                          <line x1="-2.5" y1="-2.5" x2="2.5" y2="2.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
                          <line x1="-2.5" y1="2.5" x2="2.5" y2="-2.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
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
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Base Color (5 Happy Paths / 5 Errors)
          </span>
          {hasSelectedArrow && (
            <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
              Selected Arrow
            </span>
          )}
        </div>

        <div className="space-y-1.5 bg-gray-50/70 p-2 rounded-lg border border-gray-100">
          {/* 5 Happy Path / Positive Colors (Green & Blue) */}
          <div>
            <div className="text-[10px] font-medium text-emerald-700 mb-1 flex items-center gap-1">
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
                      isSelected ? 'ring-2 ring-offset-2 ring-gray-900 scale-105' : 'border border-black/10'
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
          <div className="pt-1 border-t border-gray-200/60">
            <div className="text-[10px] font-medium text-rose-700 mb-1 flex items-center gap-1">
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
                      isSelected ? 'ring-2 ring-offset-2 ring-gray-900 scale-105' : 'border border-black/10'
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
