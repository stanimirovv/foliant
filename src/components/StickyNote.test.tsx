import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import StickyNote from './StickyNote';
import { StickyNote as StickyNoteType } from '@/lib/views';

describe('StickyNote Component', () => {
  const baseNote: StickyNoteType = {
    id: 'note-1',
    x: 100,
    y: 150,
    text: 'Test note content',
    color: 'yellow',
  };

  const defaultProps = {
    note: baseNote,
    zoomScale: 1,
    onMove: vi.fn(),
    onUpdateText: vi.fn(),
    onUpdateColor: vi.fn(),
    onResize: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the note with its initial text and styling', () => {
    render(<StickyNote {...defaultProps} />);
    expect(screen.getByTestId('sticky-note-note-1')).toBeTruthy();
    expect(screen.getByText('Test note content')).toBeTruthy();
  });

  it('renders markdown formatting like bold, bullet, and checklist', () => {
    const markdownNote: StickyNoteType = {
      ...baseNote,
      text: '**Bold text**\n- Bullet item\n- [x] Done task\n- [ ] Pending task',
    };
    render(<StickyNote {...defaultProps} note={markdownNote} />);
    
    // Bold
    const boldEl = screen.getByText('Bold text');
    expect(boldEl.tagName).toBe('STRONG');

    // Bullet
    expect(screen.getByText('Bullet item')).toBeTruthy();

    // Checkboxes
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });

  it('switches to textarea on double click and allows editing', () => {
    render(<StickyNote {...defaultProps} />);
    const body = screen.getByText('Test note content').closest('div');
    fireEvent.doubleClick(body!);

    const textarea = screen.getByTestId('sticky-note-textarea-note-1') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('Test note content');

    fireEvent.change(textarea, { target: { value: 'New edited text' } });
    expect(textarea.value).toBe('New edited text');

    // On blur, commits immediately
    fireEvent.blur(textarea);
    expect(defaultProps.onUpdateText).toHaveBeenCalledWith('note-1', 'New edited text');
  });

  it('a single click selects the note instead of entering edit mode', () => {
    const onSelect = vi.fn();
    render(<StickyNote {...defaultProps} onSelect={onSelect} />);
    const card = screen.getByTestId('sticky-note-note-1');

    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(false);
    // no inline editor on a plain click
    expect(screen.queryByTestId('sticky-note-textarea-note-1')).toBeNull();
  });

  it('reports shift-clicks so the parent can multi-select', () => {
    const onSelect = vi.fn();
    render(<StickyNote {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('sticky-note-note-1'), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(true);
  });

  it('renders a selection ring when selected', () => {
    const { rerender } = render(<StickyNote {...defaultProps} selected={false} />);
    const card = screen.getByTestId('sticky-note-note-1');
    expect(card.getAttribute('data-selected')).toBeNull();
    expect(card.className).not.toContain('ring-blue-500');

    rerender(<StickyNote {...defaultProps} selected={true} />);
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.className).toContain('ring-blue-500');
  });

  it('does not select when the click follows a drag of the note', () => {
    const onSelect = vi.fn();
    render(<StickyNote {...defaultProps} onSelect={onSelect} />);
    const handle = screen.getByTestId('sticky-note-handle-note-1');

    fireEvent.mouseDown(handle, { clientX: 100, clientY: 150, button: 0 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 180 });
    fireEvent.mouseUp(window);
    expect(defaultProps.onMove).toHaveBeenCalledWith('note-1', 150, 180);

    // the trailing click of the drag must not re-select
    fireEvent.click(screen.getByTestId('sticky-note-note-1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('toolbar buttons do not trigger selection', () => {
    const onSelect = vi.fn();
    render(<StickyNote {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('color-blue-note-1'));
    fireEvent.click(screen.getByTestId('delete-note-note-1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicks inside the inline editor do not trigger selection', () => {
    const onSelect = vi.fn();
    render(<StickyNote {...defaultProps} onSelect={onSelect} />);
    const body = screen.getByText('Test note content').closest('div');
    fireEvent.doubleClick(body!);
    const textarea = screen.getByTestId('sticky-note-textarea-note-1');
    fireEvent.click(textarea);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls onUpdateColor when clicking color buttons', () => {
    render(<StickyNote {...defaultProps} />);
    const blueDot = screen.getByTestId('color-blue-note-1');
    fireEvent.click(blueDot);
    expect(defaultProps.onUpdateColor).toHaveBeenCalledWith('note-1', 'blue');
  });

  it('calls onDelete when clicking the delete button', () => {
    render(<StickyNote {...defaultProps} />);
    const deleteBtn = screen.getByTestId('delete-note-note-1');
    fireEvent.click(deleteBtn);
    expect(defaultProps.onDelete).toHaveBeenCalledWith('note-1');
  });

  it('calls onMove after dragging the handle', () => {
    render(<StickyNote {...defaultProps} />);
    const handle = screen.getByTestId('sticky-note-handle-note-1');

    // Start drag
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 150, button: 0 });

    // Move
    fireEvent.mouseMove(window, { clientX: 150, clientY: 180 });

    // Release
    fireEvent.mouseUp(window);

    expect(defaultProps.onMove).toHaveBeenCalledWith('note-1', 150, 180);
  });

  it('renders at the default size when the note has no stored size', () => {
    render(<StickyNote {...defaultProps} />);
    const card = screen.getByTestId('sticky-note-note-1') as HTMLElement;
    expect(card.style.width).toBe('65px');
    expect(card.style.height).toBe('55px');
  });

  it("renders at the note's stored size", () => {
    const sizedNote: StickyNoteType = { ...baseNote, width: 200, height: 160 };
    render(<StickyNote {...defaultProps} note={sizedNote} />);
    const card = screen.getByTestId('sticky-note-note-1') as HTMLElement;
    expect(card.style.width).toBe('200px');
    expect(card.style.height).toBe('160px');
  });

  it('shrinks the card when the corner handle is dragged inwards', () => {
    const { rerender } = render(<StickyNote {...defaultProps} />);
    const card = screen.getByTestId('sticky-note-note-1') as HTMLElement;
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    fireEvent.mouseMove(window, { clientX: 135, clientY: 175 });

    // the card shrinks live while dragging (65x55 -> 35x25)
    expect(card.style.width).toBe('35px');
    expect(card.style.height).toBe('25px');

    fireEvent.mouseUp(window);
    expect(defaultProps.onResize).toHaveBeenCalledWith('note-1', 35, 25);

    // once the parent persists the new size, the card keeps it
    rerender(<StickyNote {...defaultProps} note={{ ...baseNote, width: 35, height: 25 }} />);
    expect(card.style.width).toBe('35px');
    expect(card.style.height).toBe('25px');
  });

  it('grows the card when the corner handle is dragged outwards', () => {
    render(<StickyNote {...defaultProps} />);
    const card = screen.getByTestId('sticky-note-note-1') as HTMLElement;
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    fireEvent.mouseMove(window, { clientX: 225, clientY: 275 });

    // 65x55 + 60x70
    expect(card.style.width).toBe('125px');
    expect(card.style.height).toBe('125px');

    fireEvent.mouseUp(window);
    expect(defaultProps.onResize).toHaveBeenCalledWith('note-1', 125, 125);
  });

  it('clamps the size to the minimum when dragged far inwards and maximum when dragged far outwards', () => {
    render(<StickyNote {...defaultProps} />);
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    fireEvent.mouseMove(window, { clientX: -500, clientY: -500 });
    fireEvent.mouseUp(window);

    expect(defaultProps.onResize).toHaveBeenCalledWith('note-1', 16, 14);

    fireEvent.mouseDown(handle, { clientX: 116, clientY: 164, button: 0 });
    fireEvent.mouseMove(window, { clientX: 3000, clientY: 3000 });
    fireEvent.mouseUp(window);

    expect(defaultProps.onResize).toHaveBeenLastCalledWith('note-1', 1200, 1000);
  });

  it('divides the drag distance by the zoom scale', () => {
    render(<StickyNote {...defaultProps} zoomScale={2} />);
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    // +60 client px at 2x zoom = +30 diagram px
    fireEvent.mouseMove(window, { clientX: 225, clientY: 265 });
    fireEvent.mouseUp(window);

    expect(defaultProps.onResize).toHaveBeenCalledWith('note-1', 95, 85);
  });

  it('does not call onResize when the handle is pressed without dragging', () => {
    render(<StickyNote {...defaultProps} />);
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    fireEvent.mouseUp(window);

    expect(defaultProps.onResize).not.toHaveBeenCalled();
  });

  it('does not select the note on the click trailing a resize', () => {
    const onSelect = vi.fn();
    render(<StickyNote {...defaultProps} onSelect={onSelect} />);
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    fireEvent.mouseMove(window, { clientX: 195, clientY: 235 });
    fireEvent.mouseUp(window);

    fireEvent.click(screen.getByTestId('sticky-note-note-1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the base text size at the default card size', () => {
    render(<StickyNote {...defaultProps} />);
    const line = screen.getByText('Test note content') as HTMLElement;
    expect(line.style.fontSize).toBe('6px');
  });

  it('scales the text and color toolbar down with a tiny card and up with a larger one', () => {
    const tinyNote: StickyNoteType = { ...baseNote, width: 26, height: 22 }; // scale 0.4
    const { rerender } = render(<StickyNote {...defaultProps} note={tinyNote} />);
    let line = screen.getByText('Test note content') as HTMLElement;
    expect(line.style.fontSize).toBe('2.4px'); // 6 * 0.4
    const tinyColorDot = screen.getByTestId('color-blue-note-1') as HTMLElement;
    expect(tinyColorDot.style.width).toBe('1.6px'); // 4 * 0.4
    expect(tinyColorDot.style.height).toBe('1.6px');
    expect(tinyColorDot.className).toContain('shrink-0');

    const largeNote: StickyNoteType = { ...baseNote, width: 260, height: 220 }; // scale 4
    rerender(<StickyNote {...defaultProps} note={largeNote} />);
    line = screen.getByText('Test note content') as HTMLElement;
    expect(line.style.fontSize).toBe('24px'); // 6 * 4
    const largeColorDot = screen.getByTestId('color-blue-note-1') as HTMLElement;
    expect(largeColorDot.style.width).toBe('16px'); // 4 * 4
    expect(largeColorDot.style.height).toBe('16px');
  });

  it('scales the text live while the card is being resized', () => {
    render(<StickyNote {...defaultProps} />);
    const card = screen.getByTestId('sticky-note-note-1') as HTMLElement;
    const handle = screen.getByTestId('sticky-note-resize-note-1');

    fireEvent.mouseDown(handle, { clientX: 165, clientY: 205, button: 0 });
    fireEvent.mouseMove(window, { clientX: 204, clientY: 238 }); // -> 104x88, scale 1.6

    const line = screen.getByText('Test note content') as HTMLElement;
    expect(line.style.fontSize).toBe('9.6px'); // 6 * 1.6
    expect(card.style.width).toBe('104px');
    expect(card.style.height).toBe('88px');

    fireEvent.mouseUp(window);
  });
});
