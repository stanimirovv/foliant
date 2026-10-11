import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ComponentProps } from 'react';
import EditorPanel from './EditorPanel';
import { parseModel } from '@/lib/model';

// Elements come from freshly parsed diagrams (EDITING_PLAN.md 4.13: create,
// never a stale fixture).
const SEQ = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const FLOW = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A`;

const WITH_NOTE = `sequenceDiagram
    participant A
    Note over A: hi`;

const seqModel = parseModel(SEQ);
const flowModel = parseModel(FLOW);
const noteModel = parseModel(WITH_NOTE);

const el = (model: typeof seqModel, key: string) => {
  const found = model.elements.find(e => e.key === key);
  if (!found) throw new Error(`no element ${key}`);
  return found;
};

const participantA = el(seqModel, 'p:0');  // A as Alice
const message0 = el(seqModel, 'm:0');       // A->>B: Hello
const nodeA = el(flowModel, 'n:0');         // A[Alice]
const edge0 = el(flowModel, 'e:0');         // A --> B
const note0 = el(noteModel, 'note:0');

type Props = ComponentProps<typeof EditorPanel>;

const makeProps = (overrides: Partial<Props> = {}): Props => ({
  element: null,
  diagramType: 'sequence',
  config: null,
  arrowStyle: null,
  arrowTags: null,
  warning: null,
  pendingDelete: null,
  onEditLabel: vi.fn(),
  onSetColor: vi.fn(),
  onSetType: vi.fn(),
  onSetWidth: vi.fn(),
  onSetDash: vi.fn(),
  onAddTag: vi.fn(),
  onRemoveTag: vi.fn(),
  onSetKeyMode: vi.fn(),
  onRequestDelete: vi.fn(),
  onConfirmDelete: vi.fn(),
  onCancelDelete: vi.fn(),
  ...overrides,
});

const optionValues = (listId: string) =>
  Array.from(document.querySelectorAll(`#${listId} option`)).map(o => o.getAttribute('value'));

describe('EditorPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a placeholder when nothing is selected', () => {
    render(<EditorPanel {...makeProps()} />);
    expect(screen.getByText(/Click an element in the diagram/)).toBeTruthy();
  });

  it('participant fields dispatch label, color, tags and delete', () => {
    const props = makeProps({
      element: participantA,
      config: {
        version: 1,
        actors: {
          A: { color: '#e11d48', keys: ['backend'] },
          B: { color: '#2563eb' },
        },
      },
    });
    render(<EditorPanel {...props} />);

    const label = screen.getByLabelText('Label') as HTMLInputElement;
    expect(label.value).toBe('Alice');
    fireEvent.change(label, { target: { value: 'Alicia' } });
    expect(props.onEditLabel).toHaveBeenCalledWith('Alicia');

    const color = screen.getByLabelText('Color') as HTMLInputElement;
    expect(color.value).toBe('#e11d48');
    fireEvent.change(color, { target: { value: '#2563eb' } });
    expect(props.onSetColor).toHaveBeenCalledWith('#2563eb');
    // datalist offers the colors already present in CONFIG
    expect(optionValues('editor-actor-color-list')).toEqual(['#e11d48', '#2563eb']);

    // existing tag renders as a chip; its remove button dispatches
    fireEvent.click(screen.getByLabelText('Remove tag backend'));
    expect(props.onRemoveTag).toHaveBeenCalledWith('backend');

    // typing + Enter adds a tag; datalist offers existing keys
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'db' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(props.onAddTag).toHaveBeenCalledWith('db');
    expect(optionValues('editor-tag-list')).toEqual(['backend']);

    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(props.onRequestDelete).toHaveBeenCalled();
  });

  it('node fields dispatch the label edit', () => {
    const props = makeProps({ element: nodeA, diagramType: 'flowchart' });
    const { container } = render(<EditorPanel {...props} />);

    expect(container.querySelector('.font-mono')?.textContent).toBe('A');
    const label = screen.getByLabelText('Label') as HTMLInputElement;
    expect(label.value).toBe('Alice');
    fireEvent.change(label, { target: { value: 'Alicia' } });
    expect(props.onEditLabel).toHaveBeenCalledWith('Alicia');
  });

  it('message fields dispatch label, type, color, width, dash and delete', () => {
    const props = makeProps({
      element: message0,
      arrowStyle: { color: '#e11d48', width: 3, dash: 'dashed' },
      config: {
        version: 1,
        arrows: [
          { from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' },
          { from: 'B', to: 'A', color: '#2563eb' },
        ],
      },
    });
    render(<EditorPanel {...props} />);

    const label = screen.getByLabelText('Label') as HTMLInputElement;
    expect(label.value).toBe('Hello');
    fireEvent.change(label, { target: { value: 'Hi' } });
    expect(props.onEditLabel).toHaveBeenCalledWith('Hi');

    // Type dropdown lists the 4.8 sequence operator vocabulary
    const type = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(type.value).toBe('->>');
    expect(Array.from(type.options).map(o => o.value)).toEqual(
      ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '-', '--']
    );
    fireEvent.change(type, { target: { value: '-->>' } });
    expect(props.onSetType).toHaveBeenCalledWith('-->>');

    // Color/Width/Dash show the current style and dispatch edits
    expect((screen.getByLabelText('Color') as HTMLInputElement).value).toBe('#e11d48');
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Dash') as HTMLSelectElement).value).toBe('dashed');
    expect(optionValues('editor-arrow-color-list')).toEqual(['#e11d48', '#2563eb']);

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#2563eb' } });
    expect(props.onSetColor).toHaveBeenCalledWith('#2563eb');
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '5' } });
    expect(props.onSetWidth).toHaveBeenCalledWith(5);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '' } });
    expect(props.onSetWidth).toHaveBeenCalledWith('');
    fireEvent.change(screen.getByLabelText('Dash'), { target: { value: 'dotted' } });
    expect(props.onSetDash).toHaveBeenCalledWith('dotted');

    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(props.onRequestDelete).toHaveBeenCalled();
  });

  it('message fields dispatch tags and the inherit-tags toggle', () => {
    const props = makeProps({
      element: message0,
      config: {
        version: 1,
        actors: { A: { keys: ['backend'] } },
        arrows: [{ from: 'A', to: 'B', label: 'Hello', keys: ['critical'] }],
      },
      arrowTags: { keys: ['critical'], keyMode: 'merged', inherited: ['backend'] },
    });
    render(<EditorPanel {...props} />);

    // own tag renders as a removable chip; the inherited service tag is a
    // read-only chip (no remove button)
    expect(screen.getByText('critical')).toBeTruthy();
    const inheritedChip = screen.getByText('backend');
    expect(inheritedChip.title).toBe('Inherited from A');
    expect(screen.queryByLabelText('Remove tag backend')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove tag critical'));
    expect(props.onRemoveTag).toHaveBeenCalledWith('critical');

    // typing + Enter adds a tag; the datalist offers keys from actors and arrows
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'retry' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(props.onAddTag).toHaveBeenCalledWith('retry');
    expect(optionValues('editor-arrow-tag-list')).toEqual(['backend', 'critical']);

    // the inherit toggle defaults to On (merged) and dispatches the mode
    fireEvent.click(screen.getByTestId('arrow-inherit-off'));
    expect(props.onSetKeyMode).toHaveBeenCalledWith('clean');
    fireEvent.click(screen.getByTestId('arrow-inherit-on'));
    expect(props.onSetKeyMode).toHaveBeenCalledWith('merged');
  });

  it('message fields show no inherited chips in clean mode', () => {
    const props = makeProps({
      element: message0,
      arrowTags: { keys: [], keyMode: 'clean', inherited: [] },
    });
    render(<EditorPanel {...props} />);
    expect(screen.queryByTitle(/Inherited from/)).toBeNull();
    // Off is the active toggle state
    const off = screen.getByTestId('arrow-inherit-off');
    expect(off.className).toContain('bg-blue-500');
  });

  it('edge type dropdown lists the 4.8 flowchart operator vocabulary', () => {
    const props = makeProps({ element: edge0, diagramType: 'flowchart' });
    render(<EditorPanel {...props} />);

    const type = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(type.value).toBe('-->');
    expect(Array.from(type.options).map(o => o.value)).toEqual(
      ['---', '-->', '==>', '-.->', '<-->', '<==>', 'x--x', 'o--o']
    );
  });

  it('delete confirmation lists the element and its cascaded references', () => {
    const props = makeProps({
      element: participantA,
      pendingDelete: {
        element: participantA,
        cascaded: [el(seqModel, 'm:0'), el(seqModel, 'm:1')],
      },
    });
    render(<EditorPanel {...props} />);

    const dialog = screen.getByTestId('delete-dialog');
    expect(dialog.textContent).toContain('participant A (Alice)');
    expect(dialog.textContent).toContain('2 referencing elements');
    expect(dialog.textContent).toContain('message A ->> B: Hello');
    expect(dialog.textContent).toContain('message B -->> A: Hi there');

    fireEvent.click(screen.getByTestId('confirm-delete'));
    expect(props.onConfirmDelete).toHaveBeenCalled();
  });

  it('delete confirmation can be cancelled', () => {
    const props = makeProps({
      element: message0,
      pendingDelete: { element: message0, cascaded: [] },
    });
    render(<EditorPanel {...props} />);

    const dialog = screen.getByTestId('delete-dialog');
    expect(dialog.textContent).toContain('message A ->> B: Hello');
    expect(dialog.textContent).not.toContain('referencing');

    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onCancelDelete).toHaveBeenCalled();
    expect(props.onConfirmDelete).not.toHaveBeenCalled();
  });

  it('shows the transform warning', () => {
    render(<EditorPanel {...makeProps({ warning: 'Boom' })} />);
    expect(screen.getByText('Boom')).toBeTruthy();
  });

  it('shows a note for elements that are not editable', () => {
    render(<EditorPanel {...makeProps({ element: note0 })} />);
    expect(screen.getByText('This element is not editable.')).toBeTruthy();
  });
});
