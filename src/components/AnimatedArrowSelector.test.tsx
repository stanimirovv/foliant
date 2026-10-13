import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AnimatedArrowSelector from './AnimatedArrowSelector';
import { ANIMATED_ARROW_PRESETS, ANIMATED_ARROW_COLORS } from '@/lib/styling';

describe('AnimatedArrowSelector', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all 6 default animations and all 10 base colors', () => {
    render(
      <AnimatedArrowSelector
        currentAnimation="none"
        onSelectAnimation={vi.fn()}
        onSelectColor={vi.fn()}
      />
    );

    // 6 animations
    for (const preset of ANIMATED_ARROW_PRESETS) {
      expect(screen.getByTestId(`select-animation-${preset.id}`)).toBeTruthy();
      expect(screen.getByText(preset.name)).toBeTruthy();
    }

    // 5 positive colors
    for (const c of ANIMATED_ARROW_COLORS.positive) {
      expect(screen.getByTestId(`color-positive-${c.name.toLowerCase()}`)).toBeTruthy();
    }

    // 5 error colors
    for (const c of ANIMATED_ARROW_COLORS.error) {
      expect(screen.getByTestId(`color-error-${c.name.toLowerCase()}`)).toBeTruthy();
    }
  });

  it('dispatches onSelectAnimation when an animation preset is clicked', () => {
    const onSelectAnimation = vi.fn();
    render(
      <AnimatedArrowSelector
        currentAnimation="none"
        onSelectAnimation={onSelectAnimation}
        onSelectColor={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('select-animation-cyber'));
    expect(onSelectAnimation).toHaveBeenCalledWith('cyber');
  });

  it('dispatches onSelectColor when color swatches are clicked', () => {
    const onSelectColor = vi.fn();
    render(
      <AnimatedArrowSelector
        currentAnimation="flow"
        onSelectAnimation={vi.fn()}
        onSelectColor={onSelectColor}
      />
    );

    fireEvent.click(screen.getByTestId('color-positive-emerald'));
    expect(onSelectColor).toHaveBeenCalledWith('#00ff9d');

    fireEvent.click(screen.getByTestId('color-error-flame'));
    expect(onSelectColor).toHaveBeenCalledWith('#ff6600');
  });

  it('resets animation when reset animation button is clicked', () => {
    const onSelectAnimation = vi.fn();
    render(
      <AnimatedArrowSelector
        currentAnimation="stutter"
        onSelectAnimation={onSelectAnimation}
        onSelectColor={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('clear-arrow-animation'));
    expect(onSelectAnimation).toHaveBeenCalledWith('none');
  });

  it('calls onConvertDiagram when convert diagram button is clicked', () => {
    const onConvertDiagram = vi.fn();
    render(
      <AnimatedArrowSelector
        currentAnimation="none"
        onSelectAnimation={vi.fn()}
        onSelectColor={vi.fn()}
        onConvertDiagram={onConvertDiagram}
      />
    );

    fireEvent.click(screen.getByTestId('convert-animated-arrows-btn'));
    expect(onConvertDiagram).toHaveBeenCalledTimes(1);
  });

  it('renders all animated arrows with the currently selected color in compact mode', () => {
    render(
      <AnimatedArrowSelector
        currentAnimation="none"
        currentColor="#2563eb"
        compact={true}
        onSelectAnimation={vi.fn()}
        onSelectColor={vi.fn()}
      />
    );

    for (const preset of ANIMATED_ARROW_PRESETS) {
      const btn = screen.getByTestId(`select-animation-${preset.id}`);
      const svg = btn.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.style.color === '#2563eb' || svg?.style.color === 'rgb(37, 99, 235)').toBe(true);
      const markerPath = btn.querySelector('marker path');
      expect(markerPath?.getAttribute('fill')).toBe('#2563eb');
    }
  });
});
