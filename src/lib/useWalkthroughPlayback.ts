import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { parseModel } from './model';
import { DiagramConfig } from './views';
import {
  buildWalkthroughPlan,
  dimTargetsForStep,
  panTargetForStep,
  WALKTHROUGH_MAX_ZOOM,
  WalkthroughPlan,
} from './walkthrough';

export interface UseWalkthroughPlaybackOptions {
  code: string;                 // the exact rendered code string
  config: DiagramConfig | null; // parseViewsData(code)
  containerId: string;          // DOM id hosting the SVG ('diagram-container' / per-block)
  transformRef?: RefObject<ReactZoomPanPinchContentRef | null>; // absent -> scrollIntoView fallback
  getZoomScale?: () => number;  // current TransformWrapper scale (fallback: ref.state.scale, then 1)
  enabled: boolean;             // presentation mode on/off (parent-owned)
  svgVersion: unknown;          // changes whenever the rendered SVG changes (svgStr / svg string)
  onExit?: () => void;          // called by exit() — clears the parent's presentation state
}

export interface WalkthroughPlayback {
  plan: WalkthroughPlan | null;
  activeIndex: number;
  isPlaying: boolean;
  visibleStickyNoteIds: string[] | null; // null = all visible (not presenting / untagged)
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  exit: () => void;
  setActiveIndex: (i: number) => void;
}

export function useWalkthroughPlayback(opts: UseWalkthroughPlaybackOptions): WalkthroughPlayback {
  const {
    code,
    config,
    containerId,
    transformRef,
    getZoomScale,
    enabled,
    svgVersion,
    onExit,
  } = opts;

  const plan = useMemo(() => buildWalkthroughPlan(code, config), [code, config]);

  const [rawActiveIndex, setRawActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Reset when enabled flips on/off
  const prevEnabledRef = useRef(enabled);
  if (prevEnabledRef.current !== enabled) {
    prevEnabledRef.current = enabled;
    if (rawActiveIndex !== 0) setRawActiveIndex(0);
    if (isPlaying) setIsPlaying(false);
  }

  const maxStepIndex = plan && plan.steps.length > 0 ? plan.steps.length - 1 : 0;
  const activeIndex = Math.max(0, Math.min(rawActiveIndex, maxStepIndex));

  // Keep state clamped if plan shrinks mid-presentation
  useEffect(() => {
    if (rawActiveIndex > maxStepIndex) {
      setRawActiveIndex(maxStepIndex);
    }
  }, [rawActiveIndex, maxStepIndex]);

  const setActiveIndex = useCallback(
    (i: number) => {
      setIsPlaying(false);
      setRawActiveIndex(Math.max(0, Math.min(i, maxStepIndex)));
    },
    [maxStepIndex],
  );

  const next = useCallback(() => {
    setIsPlaying(false);
    setRawActiveIndex((prev) => Math.min(Math.min(prev, maxStepIndex) + 1, maxStepIndex));
  }, [maxStepIndex]);

  const prev = useCallback(() => {
    setIsPlaying(false);
    setRawActiveIndex((p) => Math.max(0, Math.min(p, maxStepIndex) - 1));
  }, [maxStepIndex]);

  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => {
      if (!playing && activeIndex >= maxStepIndex) return false;
      return !playing;
    });
  }, [activeIndex, maxStepIndex]);

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const exit = useCallback(() => {
    setIsPlaying(false);
    onExitRef.current?.();
  }, []);

  const getZoomScaleRef = useRef(getZoomScale);
  getZoomScaleRef.current = getZoomScale;

  // Dimming effect (post-render DOM class mutation, mirroring search highlight)
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    svg
      .querySelectorAll('.walkthrough-dimmed, .walkthrough-active')
      .forEach((el) => el.classList.remove('walkthrough-dimmed', 'walkthrough-active'));
    if (!enabled || !plan || plan.steps.length === 0) return;
    const model = parseModel(code);
    const { dimmed, active } = dimTargetsForStep(svg, model, plan, activeIndex);
    dimmed.forEach((el) => el.classList.add('walkthrough-dimmed'));
    active.forEach((el) => el.classList.add('walkthrough-active'));
  }, [enabled, activeIndex, plan, code, containerId, svgVersion]);

  // Auto-pan effect (mirroring search auto-pan)
  useEffect(() => {
    if (!enabled || !plan || plan.steps.length === 0) return;
    const container = document.getElementById(containerId);
    const svg = container?.querySelector('svg');
    if (!svg) return;
    const model = parseModel(code);
    const target = panTargetForStep(svg, model, plan, activeIndex);
    if (!target) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (transformRef?.current) {
      const current = getZoomScaleRef.current?.() ?? transformRef.current.state?.scale ?? 1;
      const scale = Math.min(Math.max(current, 1), WALKTHROUGH_MAX_ZOOM);
      transformRef.current.zoomToElement(target as unknown as HTMLElement, {
        scale,
        animationTime: reduced ? 0 : 200,
      });
    } else if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [enabled, activeIndex, plan, code, containerId, svgVersion, transformRef]);

  // Autoplay effect
  useEffect(() => {
    if (!enabled || !isPlaying || !plan || plan.steps.length === 0) return;
    if (activeIndex >= plan.steps.length - 1) {
      setIsPlaying(false);
      return;
    }
    const t = setTimeout(() => {
      setRawActiveIndex((idx) => {
        const nextIdx = Math.min(idx + 1, plan.steps.length - 1);
        if (nextIdx >= plan.steps.length - 1) {
          setIsPlaying(false);
        }
        return nextIdx;
      });
    }, 1600);
    return () => clearTimeout(t);
  }, [enabled, isPlaying, activeIndex, plan]);

  // Keyboard listener (callbacks via refs so listener never re-registers)
  const nextRef = useRef(next);
  nextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  const exitRef = useRef(exit);
  exitRef.current = exit;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextRef.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevRef.current();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlayRef.current();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        exitRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  // Visible sticky notes while presenting: union of stickyNoteIds over steps 0..activeIndex,
  // plus any sticky note that attaches to no step (untagged = always visible).
  const visibleStickyNoteIds = useMemo<string[] | null>(() => {
    if (!enabled || !plan || plan.steps.length === 0) return null;
    const allAttached = new Set<string>();
    for (const s of plan.steps) {
      for (const id of s.stickyNoteIds) allAttached.add(id);
    }
    const visible = new Set<string>();
    for (let i = 0; i <= activeIndex && i < plan.steps.length; i++) {
      for (const id of plan.steps[i].stickyNoteIds) {
        visible.add(id);
      }
    }
    for (const note of config?.notes ?? []) {
      if (!note.keys || note.keys.length === 0 || !allAttached.has(note.id)) {
        visible.add(note.id);
      }
    }
    return Array.from(visible);
  }, [enabled, plan, activeIndex, config]);

  return {
    plan,
    activeIndex,
    isPlaying,
    visibleStickyNoteIds,
    next,
    prev,
    togglePlay,
    exit,
    setActiveIndex,
  };
}
