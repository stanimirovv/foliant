import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WalkthroughBar from './WalkthroughBar';

describe('WalkthroughBar', () => {
  afterEach(() => {
    cleanup();
  });
  const baseProps = {
    theme: 'default' as const,
    stepIndex: 1,
    totalSteps: 4,
    label: 'Authenticate user',
    isPlaying: false,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onTogglePlay: vi.fn(),
    onExit: vi.fn(),
  };

  it('renders step counter, active label, and keyboard hint', () => {
    render(<WalkthroughBar {...baseProps} />);
    expect(screen.getByTestId('walkthrough-step-count').textContent).toBe('Step 2/4');
    expect(screen.getByTestId('walkthrough-step-label').textContent).toBe('Authenticate user');
    expect(screen.getByText('←/→')).toBeTruthy();
  });

  it('fires callbacks when buttons are clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onTogglePlay = vi.fn();
    const onExit = vi.fn();
    render(
      <WalkthroughBar
        {...baseProps}
        onPrev={onPrev}
        onNext={onNext}
        onTogglePlay={onTogglePlay}
        onExit={onExit}
      />,
    );

    fireEvent.click(screen.getByTestId('walkthrough-prev'));
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('walkthrough-play'));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('walkthrough-next'));
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('walkthrough-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('disables prev at step 0 and disables play/next at last step', () => {
    const { rerender } = render(<WalkthroughBar {...baseProps} stepIndex={0} totalSteps={3} />);
    expect((screen.getByTestId('walkthrough-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('walkthrough-play') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('walkthrough-next') as HTMLButtonElement).disabled).toBe(false);

    rerender(<WalkthroughBar {...baseProps} stepIndex={2} totalSteps={3} />);
    expect((screen.getByTestId('walkthrough-prev') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('walkthrough-play') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('walkthrough-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('swaps Play and Pause labels/titles based on isPlaying', () => {
    const { rerender } = render(<WalkthroughBar {...baseProps} isPlaying={false} />);
    expect(screen.getByTestId('walkthrough-play').getAttribute('aria-label')).toBe('Play');

    rerender(<WalkthroughBar {...baseProps} isPlaying={true} />);
    expect(screen.getByTestId('walkthrough-play').getAttribute('aria-label')).toBe('Pause');
  });

  it('applies light and dark theme classes', () => {
    const { rerender } = render(<WalkthroughBar {...baseProps} theme="default" />);
    const bar = screen.getByTestId('walkthrough-bar');
    expect(bar.className).toContain('bg-white/90');

    rerender(<WalkthroughBar {...baseProps} theme="dark" />);
    expect(bar.className).toContain('bg-slate-900/90');
  });

  it('always renders the label span with a fixed width so the bar never resizes', () => {
    render(<WalkthroughBar {...baseProps} label="short" />);
    const labelEl = screen.getByTestId('walkthrough-step-label');
    expect(labelEl.className).toContain('w-[220px]');
    expect(labelEl.className).toContain('truncate');
    expect(labelEl.className).not.toContain('max-w-');
  });

  it('renders the label span even when label is undefined so the bar keeps its size', () => {
    render(<WalkthroughBar {...baseProps} label={undefined} />);
    const labelEl = screen.getByTestId('walkthrough-step-label');
    expect(labelEl).toBeTruthy();
    expect(labelEl.textContent).toBe('');
    expect(labelEl.className).toContain('w-[220px]');
  });

  it('keeps the same label span width regardless of label length', () => {
    const { rerender } = render(<WalkthroughBar {...baseProps} label="A" />);
    const shortLabel = screen.getByTestId('walkthrough-step-label');
    const shortClass = shortLabel.className;

    rerender(<WalkthroughBar {...baseProps} label="A very long arrow text that would normally expand the bar well beyond its bounds" />);
    const longLabel = screen.getByTestId('walkthrough-step-label');
    expect(longLabel.className).toBe(shortClass);
    expect(longLabel.className).toContain('w-[220px]');
    expect(longLabel.className).toContain('truncate');
  });
});
