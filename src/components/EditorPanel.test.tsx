import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ComponentProps } from 'react';
import EditorPanel, { colorToHex } from './EditorPanel';
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

  it('shows the all-arrows default style section when nothing is selected and dispatches edits', () => {
    const props = makeProps({
      config: { version: 1, defaultArrowStyle: { color: '#e11d48', width: 3 } },
      globalArrowStyle: { color: '#e11d48', width: 3 },
      onSetGlobalColor: vi.fn(),
      onSetGlobalWidth: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    expect(screen.getByTestId('global-arrow-fields')).toBeTruthy();
    const color = screen.getByTestId('global-arrow-color-picker') as HTMLInputElement;
    expect(color.type).toBe('color');
    expect(color.value).toBe('#e11d48');
    expect((screen.getByTestId('global-arrow-width') as HTMLInputElement).value).toBe('3');

    fireEvent.change(color, { target: { value: '#2563eb' } });
    expect(props.onSetGlobalColor).toHaveBeenCalledWith('#2563eb');
    // clearing the default color dispatches an empty string
    fireEvent.click(screen.getByTestId('clear-global-arrow-color'));
    expect(props.onSetGlobalColor).toHaveBeenCalledWith('');

    fireEvent.change(screen.getByTestId('global-arrow-width'), { target: { value: '5' } });
    expect(props.onSetGlobalWidth).toHaveBeenCalledWith(5);
    fireEvent.change(screen.getByTestId('global-arrow-width'), { target: { value: '' } });
    expect(props.onSetGlobalWidth).toHaveBeenCalledWith('');
  });

  it('hides the all-arrows section when an element is selected or the handlers are missing', () => {
    const { unmount } = render(<EditorPanel {...makeProps({
      element: message0,
      globalArrowStyle: { color: '#e11d48' },
      onSetGlobalColor: vi.fn(),
      onSetGlobalWidth: vi.fn(),
    })} />);
    expect(screen.queryByTestId('global-arrow-fields')).toBeNull();
    unmount();

    render(<EditorPanel {...makeProps({ globalArrowStyle: { color: '#e11d48' } })} />);
    expect(screen.queryByTestId('global-arrow-fields')).toBeNull();
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
    expect(color.type).toBe('color');
    expect(color.value).toBe('#e11d48');
    fireEvent.change(color, { target: { value: '#2563eb' } });
    expect(props.onSetColor).toHaveBeenCalledWith('#2563eb');
    // clearing color dispatches empty string
    fireEvent.click(screen.getByTestId('clear-actor-color'));
    expect(props.onSetColor).toHaveBeenCalledWith('');
    // datalist offers the colors already present in CONFIG
    expect(optionValues('editor-actor-color-list')).toEqual(['#e11d48', '#2563eb']);

    // clicking a preset actor color swatch dispatches onSetColor
    fireEvent.click(screen.getByTestId('actor-color-preset-#213b5e'));
    expect(props.onSetColor).toHaveBeenCalledWith('#213b5e');

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

  it('participant fields show structural subgraph tags as read-only inherited chips', () => {
    const boxedModel = parseModel(`sequenceDiagram
    box Payment Service
        participant A as Alice
    end`);
    const boxedA = boxedModel.elements.find(e => e.key === 'p:0')!;
    const props = makeProps({
      element: boxedA,
      selectedElements: [boxedA],
      elementsTagInfo: [{ element: boxedA, ownTags: [], inheritedTags: ['payment-service'] }],
    });
    render(<EditorPanel {...props} />);
    const chips = screen.getByTestId('participant-tag-chips');
    expect(chips.textContent).toContain('payment-service');
    // inherited chips are read-only: no remove button, never written to CONFIG
    expect(screen.queryByLabelText('Remove tag payment-service')).toBeNull();
  });

  it('note fields show structural subgraph tags as read-only inherited chips', () => {
    const props = makeProps({
      element: note0,
      selectedElements: [note0],
      noteTags: [],
      elementsTagInfo: [{ element: note0, ownTags: [], inheritedTags: ['internals'] }],
    });
    render(<EditorPanel {...props} />);
    const chips = screen.getByTestId('note-tag-chips');
    expect(chips.textContent).toContain('internals');
    expect(screen.queryByLabelText('Remove tag internals')).toBeNull();
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
      ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '->o', '-->o', '->*', '-->*', '-', '--']
    );
    fireEvent.change(type, { target: { value: '-->>' } });
    expect(props.onSetType).toHaveBeenCalledWith('-->>');

    // Color/Width/Dash show the current style and dispatch edits
    const arrowColor = screen.getByLabelText('Color') as HTMLInputElement;
    expect(arrowColor.type).toBe('color');
    expect(arrowColor.value).toBe('#e11d48');
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Dash') as HTMLSelectElement).value).toBe('dashed');
    expect(optionValues('editor-arrow-color-list')).toEqual(['#e11d48', '#2563eb']);

    fireEvent.change(arrowColor, { target: { value: '#2563eb' } });
    expect(props.onSetColor).toHaveBeenCalledWith('#2563eb');
    // clearing arrow color dispatches empty string
    fireEvent.click(screen.getByTestId('clear-arrow-color'));
    expect(props.onSetColor).toHaveBeenCalledWith('');
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

  it('message fields default to clean mode with Off active when arrowTags has no mode', () => {
    const props = makeProps({
      element: message0,
      arrowTags: null,
    });
    render(<EditorPanel {...props} />);
    const off = screen.getByTestId('arrow-inherit-off');
    expect(off.className).toContain('bg-blue-500');
    const on = screen.getByTestId('arrow-inherit-on');
    expect(on.className).not.toContain('bg-blue-500');
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
    const regionModel = parseModel(`sequenceDiagram\n    participant A\n    %% @region-start: flow=login\n    A->>A: x\n    %% @region-end`);
    const region0 = el(regionModel, 'r:0');
    render(<EditorPanel {...makeProps({ element: region0 })} />);
    expect(screen.getByText('This element is not editable.')).toBeTruthy();
  });

  it('note fields render the note and its tags, and dispatch add/remove', () => {
    const props = makeProps({
      element: note0,
      noteTags: ['backend'],
      config: {
        version: 1,
        noteTags: [{ over: ['A'], text: 'hi', keys: ['backend'] }],
      },
    });
    render(<EditorPanel {...props} />);

    expect(screen.getByText('A')).toBeTruthy(); // over target
    expect(screen.getByText('hi')).toBeTruthy(); // note text
    expect(screen.getByTestId('note-tag-chips').textContent).toContain('backend');

    // add a tag via the free-text input
    const input = screen.getByTestId('note-add-tag-input');
    fireEvent.change(input, { target: { value: 'edge-case' } });
    fireEvent.click(screen.getByTestId('note-add-tag'));
    expect(props.onAddTag).toHaveBeenCalledWith('edge-case');

    // add an existing tag via the dropdown (datalist collects note tags too)
    const select = screen.getByTestId('note-select-existing-tag') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'backend' } });
    fireEvent.click(screen.getByTestId('note-add-existing-tag'));
    expect(props.onAddTag).toHaveBeenCalledWith('backend');

    // remove a tag chip
    fireEvent.click(screen.getByTestId('remove-note-tag-backend'));
    expect(props.onRemoveTag).toHaveBeenCalledWith('backend');
  });

  it('note fields expose editable text, placement and span; edits dispatch handlers', () => {
    const spanModel = parseModel(`sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello\n    Note over A,B: greeting`);
    const spanNote = el(spanModel, 'note:0');
    const props = makeProps({
      element: spanNote,
      noteTags: [],
      noteActorIds: ['A', 'B'],
      onEditNoteText: vi.fn(),
      onSetNotePlacement: vi.fn(),
      onSetNoteSpan: vi.fn(),
      onRequestDelete: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    // header: distinct "Sequence note" copy + the spanned actors
    expect(screen.getByText(/Sequence note/)).toBeTruthy();
    expect(screen.getByText('A, B')).toBeTruthy();

    // text: textarea mirrors the note text; blur commits the edit
    const textarea = screen.getByTestId('note-text') as HTMLTextAreaElement;
    expect(textarea.value).toBe('greeting');
    // no commit when the text is unchanged
    fireEvent.blur(textarea);
    expect(props.onEditNoteText).not.toHaveBeenCalled();
    fireEvent.change(textarea, { target: { value: 'renamed' } });
    fireEvent.blur(textarea);
    expect(props.onEditNoteText).toHaveBeenCalledWith('renamed');
    expect(props.onEditNoteText).toHaveBeenCalledTimes(1);

    // placement: multi-actor span disables the select (N4)
    const placement = screen.getByTestId('note-placement') as HTMLSelectElement;
    expect(placement.value).toBe('over');
    expect(placement.disabled).toBe(true);

    // span chips: checked for the current span; unchecking rebuilds the list
    const chipA = screen.getByTestId('note-span-A') as HTMLInputElement;
    const chipB = screen.getByTestId('note-span-B') as HTMLInputElement;
    expect(chipA.checked).toBe(true);
    expect(chipB.checked).toBe(true);
    fireEvent.click(chipB);
    expect(props.onSetNoteSpan).toHaveBeenCalledWith(['A']);

    // delete button routes through onRequestDelete
    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(props.onRequestDelete).toHaveBeenCalled();
  });

  it('note fields enable placement and append spans on a single-actor note', () => {
    const props = makeProps({
      element: note0,   // Note over A: hi
      noteTags: [],
      noteActorIds: ['A', 'B'],
      onSetNotePlacement: vi.fn(),
      onSetNoteSpan: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    const placement = screen.getByTestId('note-placement') as HTMLSelectElement;
    expect(placement.disabled).toBe(false);
    fireEvent.change(placement, { target: { value: 'left of' } });
    expect(props.onSetNotePlacement).toHaveBeenCalledWith('left of');

    // checking B appends it after the current span (order preserved)
    fireEvent.click(screen.getByTestId('note-span-B'));
    expect(props.onSetNoteSpan).toHaveBeenCalledWith(['A', 'B']);
  });

  it('block fields render title and type for labeled blocks; edits dispatch handlers', () => {
    const blockModel = parseModel(`sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello\n    loop retry\n        B-->>A: Hi\n    end`);
    const loop0 = el(blockModel, 'b:0');
    const props = makeProps({
      element: loop0,
      onEditBlockTitle: vi.fn(),
      onSetBlockType: vi.fn(),
      onUnwrapBlock: vi.fn(),
      onRequestDelete: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    expect(screen.getByText(/loop block/)).toBeTruthy();
    expect(screen.getByText('"retry"')).toBeTruthy();

    // title input mirrors the title; blur commits the edit
    const title = screen.getByTestId('block-title') as HTMLInputElement;
    expect(title.value).toBe('retry');
    fireEvent.blur(title);
    expect(props.onEditBlockTitle).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: 'retry loop' } });
    fireEvent.blur(title);
    expect(props.onEditBlockTitle).toHaveBeenCalledWith('retry loop');
    expect(props.onEditBlockTitle).toHaveBeenCalledTimes(1);

    // type select dispatches the new type
    fireEvent.change(screen.getByTestId('block-type'), { target: { value: 'par' } });
    expect(props.onSetBlockType).toHaveBeenCalledWith('par');

    // unwrap and delete route through their handlers
    fireEvent.click(screen.getByTestId('block-unwrap'));
    expect(props.onUnwrapBlock).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(props.onRequestDelete).toHaveBeenCalled();
  });

  it('block fields show a color row for rect blocks and convert hex to rgb', () => {
    const rectModel = parseModel(`sequenceDiagram\n    participant A\n    participant B\n    rect rgb(1,2,3)\n        A->>B: m\n    end`);
    const rect0 = el(rectModel, 'b:0');
    const props = makeProps({
      element: rect0,
      onEditBlockTitle: vi.fn(),
      onSetBlockType: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    expect(screen.queryByTestId('block-title')).toBeNull();
    const picker = screen.getByTestId('block-color-picker') as HTMLInputElement;
    expect(picker.type).toBe('color');
    expect(picker.value).toBe('#010203');
    expect(screen.getByTestId('block-color-label').textContent).toBe('rgb(1,2,3)');
    fireEvent.change(picker, { target: { value: '#c896ff' } });
    expect(props.onEditBlockTitle).toHaveBeenCalledWith('rgb(200,150,255)');
    // the type select is still offered for rect blocks
    fireEvent.change(screen.getByTestId('block-type'), { target: { value: 'loop' } });
    expect(props.onSetBlockType).toHaveBeenCalledWith('loop');
  });

  it('block fields show read-only controls for box blocks but keep unwrap and delete', () => {
    const boxModel = parseModel(`sequenceDiagram\n    participant A\n    box red BoxOne\n        participant B\n    end`);
    const box0 = el(boxModel, 'b:0');
    const props = makeProps({
      element: box0,
      onEditBlockTitle: vi.fn(),
      onSetBlockType: vi.fn(),
      onUnwrapBlock: vi.fn(),
      onRequestDelete: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    expect(screen.getByText(/Box group/)).toBeTruthy();
    expect(screen.queryByTestId('block-title')).toBeNull();
    expect(screen.queryByTestId('block-type')).toBeNull();
    expect(screen.queryByTestId('block-color-picker')).toBeNull();
    fireEvent.click(screen.getByTestId('block-unwrap'));
    expect(props.onUnwrapBlock).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(props.onRequestDelete).toHaveBeenCalled();
  });

  it('allows adding existing tag from select dropdown in participant view', () => {
    const props = makeProps({
      element: participantA,
      config: {
        version: 1,
        actors: {
          A: { keys: ['backend'] },
          B: { keys: ['frontend'] },
        },
      },
    });
    render(<EditorPanel {...props} />);

    const select = screen.getByTestId('participant-select-existing-tag') as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'frontend' } });
    fireEvent.click(screen.getByTestId('participant-add-existing-tag'));
    expect(props.onAddTag).toHaveBeenCalledWith('frontend');
  });

  it('renders multi-element selection and supports adding tags to all and removing tags per element', () => {
    const props = makeProps({
      selectedElements: [participantA, message0],
      elementsTagInfo: [
        {
          element: participantA,
          ownTags: ['backend', 'core'],
          inheritedTags: [],
        },
        {
          element: message0,
          ownTags: ['v1'],
          inheritedTags: ['backend'],
        },
      ],
      config: {
        version: 1,
        actors: {
          A: { keys: ['backend', 'core'] },
          B: { keys: ['database'] },
        },
        arrows: [
          { from: 'A', to: 'B', label: 'Hello', keys: ['v1'] },
        ],
      },
    });
    render(<EditorPanel {...props} />);

    // Header shows count
    expect(screen.getByText('Selected Elements (2)')).toBeTruthy();

    // Existing diagram tags are available in dropdown (backend, core, database, v1)
    const select = screen.getByTestId('multi-select-existing-tag') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'backend', 'core', 'database', 'v1']);
    fireEvent.change(select, { target: { value: 'database' } });
    fireEvent.click(screen.getByTestId('multi-add-existing-tag'));
    expect(props.onAddTag).toHaveBeenCalledWith('database');

    // Free text input adds custom tag to all
    const tagInput = screen.getByTestId('multi-add-tag-input');
    fireEvent.change(tagInput, { target: { value: 'critical' } });
    fireEvent.click(screen.getByTestId('multi-add-tag'));
    expect(props.onAddTag).toHaveBeenCalledWith('critical');

    // Displays cards for each element with their own tags and inherited tags
    expect(screen.getByText('participant A (Alice)')).toBeTruthy();
    expect(screen.getByText('message A ->> B: Hello')).toBeTruthy();

    // Removing tag from a specific element dispatches with element.key
    fireEvent.click(screen.getByTestId('remove-tag-p:0-core'));
    expect(props.onRemoveTag).toHaveBeenCalledWith('core', 'p:0');

    fireEvent.click(screen.getByTestId('remove-tag-m:0-v1'));
    expect(props.onRemoveTag).toHaveBeenCalledWith('v1', 'm:0');

    // Inherited tag on message is read-only (has inherited title, no remove button)
    const inheritedChips = screen.getAllByText('backend');
    const inheritedOnMsg = inheritedChips.find(c => c.getAttribute('title')?.includes('Inherited'));
    expect(inheritedOnMsg).toBeTruthy();
  });

  it('dispatches animation style and base color edits for arrows when onSetAnimation is provided', () => {
    const onSetAnimation = vi.fn();
    const props = makeProps({
      element: message0,
      arrowStyle: { color: '#00ff9d', animation: 'flow' },
      onSetAnimation,
    });
    render(<EditorPanel {...props} />);

    // Renders the animation options
    expect(screen.getByTestId('select-animation-flow')).toBeTruthy();
    expect(screen.getByTestId('select-animation-pulse')).toBeTruthy();
    expect(screen.getByTestId('select-animation-cyber')).toBeTruthy();
    expect(screen.getByTestId('select-animation-broken-sender')).toBeTruthy();
    expect(screen.getByTestId('select-animation-broken-network')).toBeTruthy();
    expect(screen.getByTestId('select-animation-broken-receiver')).toBeTruthy();

    // Clicking pulse dispatches onSetAnimation
    fireEvent.click(screen.getByTestId('select-animation-pulse'));
    expect(onSetAnimation).toHaveBeenCalledWith('pulse');

    // Clicking a positive color swatch dispatches onSetColor
    fireEvent.click(screen.getByTestId('color-positive-teal'));
    expect(props.onSetColor).toHaveBeenCalledWith('#00f0ff');

    // Clicking an error color swatch dispatches onSetColor
    fireEvent.click(screen.getByTestId('color-error-crimson'));
    expect(props.onSetColor).toHaveBeenCalledWith('#ff3366');

    // Clicking reset animation dispatches 'none'
    fireEvent.click(screen.getByTestId('clear-arrow-animation'));
    expect(onSetAnimation).toHaveBeenCalledWith('none');
  });

  it('colorToHex helper converts named colors, hex codes and defaults', () => {
    expect(colorToHex('#e11d48')).toBe('#e11d48');
    expect(colorToHex('#FFF')).toBe('#ffffff');
    expect(colorToHex('red')).toBe('#ff0000');
    expect(colorToHex('blue')).toBe('#0000ff');
    expect(colorToHex(undefined)).toBe('#000000');
    expect(colorToHex('', '#ffffff')).toBe('#ffffff');
  });

  it('dispatches onSetParticipantKind when changing participant type', () => {
    const onSetParticipantKind = vi.fn();
    const props = makeProps({
      element: participantA,
      onSetParticipantKind,
    });
    render(<EditorPanel {...props} />);

    const select = screen.getByTestId('participant-kind-select') as HTMLSelectElement;
    expect(select.value).toBe('participant');
    fireEvent.change(select, { target: { value: 'actor' } });
    expect(onSetParticipantKind).toHaveBeenCalledWith('actor');

    fireEvent.change(select, { target: { value: 'database' } });
    expect(onSetParticipantKind).toHaveBeenCalledWith('database');

    fireEvent.change(select, { target: { value: 'queue' } });
    expect(onSetParticipantKind).toHaveBeenCalledWith('queue');
  });

  it('dispatches onSetNodeShape when changing flowchart node shape/type', () => {
    const onSetNodeShape = vi.fn();
    const props = makeProps({
      element: nodeA,
      diagramType: 'flowchart',
      onSetNodeShape,
    });
    render(<EditorPanel {...props} />);

    const select = screen.getByTestId('participant-kind-select') as HTMLSelectElement;
    expect(select.value).toBe('rect');

    fireEvent.change(select, { target: { value: 'cylinder' } });
    expect(onSetNodeShape).toHaveBeenCalledWith('cylinder');

    fireEvent.change(select, { target: { value: 'rhombus' } });
    expect(onSetNodeShape).toHaveBeenCalledWith('rhombus');
  });

  it('dispatches onToggleActivation for receiver (+) and sender (-)', () => {
    const onToggleActivation = vi.fn();
    const props = makeProps({
      element: message0,
      diagramType: 'sequence',
      onToggleActivation,
    });
    render(<EditorPanel {...props} />);

    const activateTarget = screen.getByTestId('activate-target-checkbox') as HTMLInputElement;
    expect(activateTarget.checked).toBe(false);
    fireEvent.click(activateTarget);
    expect(onToggleActivation).toHaveBeenCalledWith('target', true);

    const deactivateSource = screen.getByTestId('deactivate-source-checkbox') as HTMLInputElement;
    expect(deactivateSource.checked).toBe(false);
    fireEvent.click(deactivateSource);
    expect(onToggleActivation).toHaveBeenCalledWith('source', true);
  });

  it('renders box grouping section and dispatches onGroupParticipants when 2+ participants are selected', () => {
    const onGroupParticipants = vi.fn();
    const participantB = el(seqModel, 'p:1');
    const props = makeProps({
      selectedElements: [participantA, participantB],
      onGroupParticipants,
    });
    render(<EditorPanel {...props} />);

    const titleInput = screen.getByTestId('group-box-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Group');
    fireEvent.change(titleInput, { target: { value: 'Core Services' } });

    const colorInput = screen.getByTestId('group-box-color') as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: 'LightBlue' } });

    fireEvent.click(screen.getByTestId('group-box-button'));
    expect(onGroupParticipants).toHaveBeenCalledWith(['p:0', 'p:1'], 'Core Services', 'LightBlue');
  });

  it('renders subgraph grouping section and dispatches onGroupNodes when 2+ flowchart nodes are selected', () => {
    const onGroupNodes = vi.fn();
    const nodeB = el(flowModel, 'n:1');
    const props = makeProps({
      selectedElements: [nodeA, nodeB],
      diagramType: 'flowchart',
      onGroupNodes,
    });
    render(<EditorPanel {...props} />);

    const titleInput = screen.getByTestId('group-subgraph-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Subgraph');
    fireEvent.change(titleInput, { target: { value: 'Core Services' } });

    fireEvent.click(screen.getByTestId('group-subgraph-button'));
    expect(onGroupNodes).toHaveBeenCalledWith(['n:0', 'n:1'], 'Core Services');

    // The sequence-only "Group into Box" section stays hidden for nodes.
    expect(screen.queryByTestId('group-box-button')).toBeNull();
  });

  it('hides the subgraph grouping section for a single node and for participants', () => {
    const onGroupNodes = vi.fn();
    // A single node selection is not a multi-selection at all.
    const { unmount } = render(<EditorPanel {...makeProps({
      selectedElements: [nodeA],
      diagramType: 'flowchart',
      onGroupNodes,
    })} />);
    expect(screen.queryByTestId('group-subgraph-button')).toBeNull();
    unmount();

    // Participants get the box section, never the subgraph section.
    const participantB = el(seqModel, 'p:1');
    render(<EditorPanel {...makeProps({
      selectedElements: [participantA, participantB],
      diagramType: 'sequence',
      onGroupParticipants: vi.fn(),
      onGroupNodes,
    })} />);
    expect(screen.queryByTestId('group-subgraph-button')).toBeNull();
    expect(screen.queryByTestId('group-box-button')).toBeTruthy();
  });

  describe('wrap sections (MultiElementFields)', () => {
    const message1 = el(seqModel, 'm:1');
    const participantB = el(seqModel, 'p:1');
    const nodeB = el(flowModel, 'n:1');

    it('renders the wrap sections for a 2-message sequence selection and dispatches both handlers', () => {
      const onWrapInBlock = vi.fn();
      const onWrapInRegion = vi.fn();
      render(<EditorPanel {...makeProps({
        selectedElements: [message0, message1],
        wrapChecks: { block: { ok: true }, region: { ok: true } },
        regionTypes: ['flow', 'auth'],
        onWrapInBlock,
        onWrapInRegion,
      })} />);

      // block wrap: default type loop + title input
      const titleInput = screen.getByTestId('wrap-block-title') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'retry' } });
      fireEvent.click(screen.getByTestId('wrap-block-button'));
      expect(onWrapInBlock).toHaveBeenCalledWith('loop', 'retry');

      // rect swaps the title input for a color input defaulting to rgb(...)
      fireEvent.change(screen.getByTestId('wrap-block-type'), { target: { value: 'rect' } });
      expect(screen.queryByTestId('wrap-block-title')).toBeNull();
      const colorInput = screen.getByTestId('wrap-block-color') as HTMLInputElement;
      expect(colorInput.value).toBe('rgb(200,150,255)');
      fireEvent.click(screen.getByTestId('wrap-block-button'));
      expect(onWrapInBlock).toHaveBeenCalledWith('rect', 'rgb(200,150,255)');

      // region wrap: type defaults to flow, value passed through
      const typeInput = screen.getByTestId('wrap-region-type') as HTMLInputElement;
      expect(typeInput.value).toBe('flow');
      fireEvent.change(screen.getByTestId('wrap-region-value'), { target: { value: 'login' } });
      fireEvent.click(screen.getByTestId('wrap-region-button'));
      expect(onWrapInRegion).toHaveBeenCalledWith('flow', 'login');
    });

    it('disables the wrap buttons and shows the refusal reason verbatim (W1/W2/W9)', () => {
      const onWrapInBlock = vi.fn();
      const onWrapInRegion = vi.fn();
      render(<EditorPanel {...makeProps({
        selectedElements: [message0, message1],
        wrapChecks: {
          block: { ok: false, reason: 'The selection is not contiguous (m:1 sits inside the span but is not selected)' },
          region: { ok: false, reason: 'The selection contains a %% @region-end tag' },
        },
        onWrapInBlock,
        onWrapInRegion,
      })} />);

      const blockButton = screen.getByTestId('wrap-block-button') as HTMLButtonElement;
      const regionButton = screen.getByTestId('wrap-region-button') as HTMLButtonElement;
      expect(blockButton.disabled).toBe(true);
      expect(regionButton.disabled).toBe(true);
      expect(screen.getByTestId('wrap-reason').textContent).toContain('not contiguous');
      expect(screen.getByTestId('wrap-region-reason').textContent).toContain('@region-end');
      fireEvent.click(blockButton);
      fireEvent.click(regionButton);
      expect(onWrapInBlock).not.toHaveBeenCalled();
      expect(onWrapInRegion).not.toHaveBeenCalled();
    });

    it('hides the wrap sections for flowcharts and for selections without 2 wrappable elements (W4)', () => {
      // flowchart nodes are never wrappable
      const { unmount } = render(<EditorPanel {...makeProps({
        selectedElements: [nodeA, nodeB],
        diagramType: 'flowchart',
        wrapChecks: { block: { ok: true }, region: { ok: true } },
        onWrapInBlock: vi.fn(),
        onWrapInRegion: vi.fn(),
      })} />);
      expect(screen.queryByTestId('wrap-block-button')).toBeNull();
      expect(screen.queryByTestId('wrap-region-button')).toBeNull();
      unmount();

      // two participants: box grouping shows, wrap sections stay hidden
      render(<EditorPanel {...makeProps({
        selectedElements: [participantA, participantB],
        diagramType: 'sequence',
        wrapChecks: { block: { ok: true }, region: { ok: true } },
        onWrapInBlock: vi.fn(),
        onWrapInRegion: vi.fn(),
        onGroupParticipants: vi.fn(),
      })} />);
      expect(screen.getByTestId('group-box-button')).toBeTruthy();
      expect(screen.queryByTestId('wrap-block-button')).toBeNull();
      unmount();

      // one message + one participant: only one wrappable element
      render(<EditorPanel {...makeProps({
        selectedElements: [participantA, message0],
        diagramType: 'sequence',
        wrapChecks: { block: { ok: true }, region: { ok: true } },
        onWrapInBlock: vi.fn(),
        onWrapInRegion: vi.fn(),
      })} />);
      expect(screen.queryByTestId('wrap-block-button')).toBeNull();
    });
  });

  it('renders type and color in one row, and width and dash in one row for arrows', () => {
    const props = makeProps({
      element: message0,
      arrowStyle: { color: '#e11d48', width: 2, dash: 'solid' },
    });
    render(<EditorPanel {...props} />);

    const typeSelect = screen.getByLabelText('Type');
    const colorInput = screen.getByLabelText('Color');
    const widthInput = screen.getByLabelText('Width');
    const dashSelect = screen.getByLabelText('Dash');

    // Type and Color are in the same grid row
    const typeParent = typeSelect.closest('label')?.parentElement;
    const colorParent = colorInput.closest('label')?.parentElement;
    expect(typeParent).toBe(colorParent);
    expect(typeParent?.className).toContain('grid-cols-2');

    // Width and Dash are in the same grid row
    const widthParent = widthInput.closest('label')?.parentElement;
    const dashParent = dashSelect.closest('label')?.parentElement;
    expect(widthParent).toBe(dashParent);
    expect(widthParent?.className).toContain('grid-cols-2');
  });

  it('ensures animated arrows in the properties menu always maintain green for happy paths and red for negative paths in preview', () => {
    const props = makeProps({
      element: message0,
      arrowStyle: { color: '#9333ea' },
      onSetAnimation: vi.fn(),
    });
    render(<EditorPanel {...props} />);

    const arrowPicker = screen.getByTestId('arrow-color-picker') as HTMLInputElement;
    expect(arrowPicker.value).toBe('#9333ea');

    // Previews strictly stay green (#00ff9d) for happy paths and red (#ff2a85) for negative paths
    const flowBtn = screen.getByTestId('select-animation-flow');
    const pulseBtn = screen.getByTestId('select-animation-pulse');
    const brokenSenderBtn = screen.getByTestId('select-animation-broken-sender');

    expect(flowBtn.querySelector('svg')?.style.color === '#00ff9d' || flowBtn.querySelector('svg')?.style.color === 'rgb(0, 255, 157)').toBe(true);
    expect(pulseBtn.querySelector('svg')?.style.color === '#00ff9d' || pulseBtn.querySelector('svg')?.style.color === 'rgb(0, 255, 157)').toBe(true);
    expect(brokenSenderBtn.querySelector('svg')?.style.color === '#ff2a85' || brokenSenderBtn.querySelector('svg')?.style.color === 'rgb(255, 42, 133)').toBe(true);
    expect(flowBtn.querySelector('marker path')?.getAttribute('fill')).toBe('#00ff9d');
    expect(brokenSenderBtn.querySelector('marker path')?.getAttribute('fill')).toBe('#ff2a85');
  });

  describe('shift-select arrow controls and delete in MultiElementFields', () => {
    const message1 = el(seqModel, 'm:1');
    const participantB = el(seqModel, 'p:1');

    it('renders arrow type, color picker, width, dash, animations, and delete for multiple selected arrows while keeping wrap and tag sections', () => {
      const onSetType = vi.fn();
      const onSetColor = vi.fn();
      const onSetWidth = vi.fn();
      const onSetDash = vi.fn();
      const onSetAnimation = vi.fn();
      const onRequestDelete = vi.fn();
      const onWrapInBlock = vi.fn();
      const onWrapInRegion = vi.fn();

      const props = makeProps({
        selectedElements: [message0, message1],
        arrowStyle: { color: '#ef4444', width: 3, dash: 'dashed', animation: 'flow' },
        wrapChecks: { block: { ok: true }, region: { ok: true } },
        onSetType,
        onSetColor,
        onSetWidth,
        onSetDash,
        onSetAnimation,
        onRequestDelete,
        onWrapInBlock,
        onWrapInRegion,
      });

      render(<EditorPanel {...props} />);

      expect(screen.getByTestId('multi-arrow-fields')).toBeTruthy();

      // Type select
      const typeSelect = screen.getByTestId('multi-arrow-type') as HTMLSelectElement;
      fireEvent.change(typeSelect, { target: { value: '-x' } });
      expect(onSetType).toHaveBeenCalledWith('-x');

      // Color picker & clear button
      const colorPicker = screen.getByTestId('arrow-color-picker') as HTMLInputElement;
      expect(colorPicker.value).toBe('#ef4444');
      fireEvent.change(colorPicker, { target: { value: '#10b981' } });
      expect(onSetColor).toHaveBeenCalledWith('#10b981');

      fireEvent.click(screen.getByTestId('clear-arrow-color'));
      expect(onSetColor).toHaveBeenCalledWith('');

      // Width input
      const widthInput = screen.getByTestId('multi-arrow-width') as HTMLInputElement;
      expect(widthInput.value).toBe('3');
      fireEvent.change(widthInput, { target: { value: '5' } });
      expect(onSetWidth).toHaveBeenCalledWith(5);

      // Dash select
      const dashSelect = screen.getByTestId('multi-arrow-dash') as HTMLSelectElement;
      expect(dashSelect.value).toBe('dashed');
      fireEvent.change(dashSelect, { target: { value: 'dotted' } });
      expect(onSetDash).toHaveBeenCalledWith('dotted');

      // Animation selector is inside a collapsible dropdown (collapsed by default)
      const animToggle = screen.getByTestId('multi-arrow-animation-dropdown-toggle');
      expect(animToggle.getAttribute('aria-expanded')).toBe('false');
      expect(animToggle.textContent).toContain('Stream');
      expect(screen.queryByTestId('select-animation-pulse')).toBeNull();

      // Opening the dropdown reveals AnimatedArrowSelector
      fireEvent.click(animToggle);
      expect(animToggle.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(screen.getByTestId('select-animation-pulse'));
      expect(onSetAnimation).toHaveBeenCalledWith('pulse');

      // Clicking the toggle again collapses it
      fireEvent.click(animToggle);
      expect(animToggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('select-animation-pulse')).toBeNull();

      // Existing wrap & tag sections remain intact
      expect(screen.getByTestId('wrap-block-button')).toBeTruthy();
      expect(screen.getByTestId('multi-add-tag-input')).toBeTruthy();

      // Delete button
      const deleteBtn = screen.getByTestId('panel-delete');
      fireEvent.click(deleteBtn);
      expect(onRequestDelete).toHaveBeenCalledTimes(1);
    });

    it('renders delete button and hides arrow fields when only participants are shift-selected', () => {
      const onRequestDelete = vi.fn();
      render(<EditorPanel {...makeProps({
        selectedElements: [participantA, participantB],
        onGroupParticipants: vi.fn(),
        onRequestDelete,
      })} />);

      expect(screen.queryByTestId('multi-arrow-fields')).toBeNull();
      expect(screen.getByTestId('group-box-button')).toBeTruthy();
      fireEvent.click(screen.getByTestId('panel-delete'));
      expect(onRequestDelete).toHaveBeenCalledTimes(1);
    });
  });
});



