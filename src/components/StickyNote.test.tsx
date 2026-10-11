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

  it('switches to textarea on click/double click and allows editing', () => {
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
});
