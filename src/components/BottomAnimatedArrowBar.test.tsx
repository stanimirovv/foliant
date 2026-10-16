import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BottomAnimatedArrowBar from './BottomAnimatedArrowBar';

describe('BottomAnimatedArrowBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders collapsed bar and expands from the bottom up on toggle', () => {
    const onSelectAnimation = vi.fn();
    const onSelectColor = vi.fn();
    const onConvertDiagram = vi.fn();

    render(
      <BottomAnimatedArrowBar
        currentAnimation="none"
        onSelectAnimation={onSelectAnimation}
        onSelectColor={onSelectColor}
        onConvertDiagram={onConvertDiagram}
      />
    );

    // Initial state: header visible, selector collapsed
    expect(screen.getByTestId('bottom-animated-arrow-bar')).toBeTruthy();
    expect(screen.getByText('Animated Arrows')).toBeTruthy();
    expect(screen.queryByTestId('select-animation-flow')).toBeNull();

    // Toggle open
    fireEvent.click(screen.getByTestId('toggle-animated-arrows-bar'));
    expect(screen.getByTestId('select-animation-flow')).toBeTruthy();

    // Selecting an animation dispatches callback
    fireEvent.click(screen.getByTestId('select-animation-flow'));
    expect(onSelectAnimation).toHaveBeenCalledWith('flow');

    // Selecting a color dispatches callback
    fireEvent.click(screen.getByTestId('color-positive-emerald'));
    expect(onSelectColor).toHaveBeenCalledWith('#00ff9d');
  });

  it('renders the Convert Diagram header button as disabled', () => {
    const onConvertDiagram = vi.fn();
    render(
      <BottomAnimatedArrowBar
        currentAnimation="none"
        onSelectAnimation={vi.fn()}
        onSelectColor={vi.fn()}
        onConvertDiagram={onConvertDiagram}
      />
    );

    const btn = screen.getByTestId('convert-diagram-bar-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onConvertDiagram).not.toHaveBeenCalled();
  });
});
