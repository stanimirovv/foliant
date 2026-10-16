import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import ClientPage from './ClientPage';
import { parseModel } from '@/lib/model';
import { parseViewsData, StickyNote } from '@/lib/views';
import { createSequenceDiagram } from '@/lib/editorTestHarness';
import { extractMermaidBlocks } from '@/lib/markdown';
import { runMarkdownSaveJob } from '@/lib/markdownSave';
import mermaid from 'mermaid';

let currentMockParams: Record<string, string> = { dir: '/old/dir' };
const mockReplace = vi.fn();
const mockGet = vi.fn((key: string): string | null => currentMockParams[key] ?? null);
const mockSearchParams = {
  get: mockGet,
  toString: () => new URLSearchParams(currentMockParams).toString()
};
const mockRouter = {
  replace: mockReplace
};

vi.mock('next/navigation', () => {
  const actual = vi.importActual('next/navigation');
  return {
    ...actual,
    useRouter: () => mockRouter,
    useSearchParams: () => mockSearchParams,
    usePathname: () => '/',
  };
});

// The DiagramViewer stub records the props it receives and lets tests drive
// selection through onSelect (processed keys, like real clicks) and the drag
// callbacks through dedicated buttons.
vi.mock('./DiagramViewer', () => ({
  __esModule: true,
  default: (props: {
    code: string;
    editMode?: boolean;
    isVisualLocked?: boolean;
    selection?: string | string[] | null;
    onSelect?: (key: string | null, options?: { shiftKey?: boolean }) => void;
    onCreateMessageDrag?: (fromKey: string, toKey: string, position: { type: string; key?: string }) => void;
    onMoveParticipant?: (key: string, beforeKey: string | null) => void;
    onMoveMessageEndpoint?: (messageKey: string, end: 'from' | 'to', targetKey: string) => void;
    onMoveMessage?: (messageKey: string, position: { type: string; key?: string }) => void;
    notes?: StickyNote[];
    showNotes?: boolean;
    onUpdateNote?: (id: string, patch: Partial<StickyNote>) => void;
    onDeleteNote?: (id: string) => void;
  }) => (
    <div
      data-testid="diagram-viewer"
      id="diagram-container"
      data-code={props.code}
      data-edit-mode={String(props.editMode ?? false)}
      data-visual-locked={String(props.isVisualLocked ?? false)}
      data-selection={Array.isArray(props.selection) ? props.selection.join(',') : (props.selection ?? '')}
    >
      <svg data-testid="mock-diagram-svg" viewBox="0 0 100 100"><text>Diagram</text></svg>
      {props.isVisualLocked && <div data-testid="visual-locked-banner">Visual edits locked (editing source code)</div>}
      <div data-testid="mock-notes-info" data-count={props.notes?.length ?? 0} data-show={String(props.showNotes ?? true)} />
      {props.notes && props.notes.length > 0 && (
        <>
          <button data-testid="mock-update-first-note" onClick={() => props.onUpdateNote?.(props.notes![0].id, { text: 'Updated from test' })}>
            update first note
          </button>
          <button data-testid="mock-delete-first-note" onClick={() => props.onDeleteNote?.(props.notes![0].id)}>
            delete first note
          </button>
        </>
      )}
      {['p:0', 'p:1', 'p:2', 'm:0', 'm:1', 'm:2', 'r:0', 'n:0', 'n:1', 'e:0', 'e:1', 'note:0', 'note:1'].map(k => (
        <button
          key={k}
          data-testid={`select-${k}`}
          onClick={(e) => props.onSelect?.(k, e.shiftKey ? { shiftKey: true } : undefined)}
        >
          select {k}
        </button>
      ))}
      <button
        data-testid="drag-create-message"
        onClick={() => props.onCreateMessageDrag?.('p:0', 'p:1', { type: 'bottom' })}
      >
        drag create message
      </button>
      <button
        data-testid="drag-move-participant"
        onClick={() => props.onMoveParticipant?.('p:0', null)}
      >
        drag move participant
      </button>
      <button
        data-testid="drag-move-participant-front"
        onClick={() => props.onMoveParticipant?.('p:3', 'p:0')}
      >
        drag move participant to front
      </button>
      <button
        data-testid="drag-move-node"
        onClick={() => props.onMoveParticipant?.('n:2', 'n:0')}
      >
        drag move node
      </button>
      <button
        data-testid="drag-create-connection"
        onClick={() => props.onCreateMessageDrag?.('n:0', 'n:1', { type: 'bottom' })}
      >
        drag create connection
      </button>
      <button
        data-testid="drag-retarget-head"
        onClick={() => props.onMoveMessageEndpoint?.('m:0', 'to', 'p:2')}
      >
        drag retarget head
      </button>
      <button
        data-testid="drag-retarget-tail"
        onClick={() => props.onMoveMessageEndpoint?.('m:0', 'from', 'p:1')}
      >
        drag retarget tail
      </button>
      <button
        data-testid="drag-retarget-head-same"
        onClick={() => props.onMoveMessageEndpoint?.('m:0', 'to', 'p:1')}
      >
        drag retarget head onto current
      </button>
      <button
        data-testid="drag-move-message"
        onClick={() => props.onMoveMessage?.('m:0', { type: 'after', key: 'm:1' })}
      >
        drag move message
      </button>
    </div>
  ),
}));

// The MarkdownEditor stub records the document it received and lets tests
// drive text edits (onCodeChange) and diagram selection (onSelectDiagram). It
// also records the per-block view/tag states and can report a change for one.
vi.mock('./MarkdownEditor', () => ({
  __esModule: true,
  default: (props: {
    code: string;
    fileName: string;
    onCodeChange: (newCode: string) => void;
    onSelectDiagram: (index: number) => void;
    viewStates?: Map<number, { viewName?: string | null; hideKeys?: string[] }>;
    onViewStateChange?: (index: number, selection: { viewName?: string | null; hideKeys?: string[] }) => void;
  }) => (
    <div
      data-testid="markdown-editor"
      data-code={props.code}
      data-file={props.fileName}
      data-viewstates={JSON.stringify(props.viewStates ? Object.fromEntries(props.viewStates) : null)}
    >
      <textarea
        data-testid="markdown-editor-source"
        value={props.code}
        onChange={(e) => props.onCodeChange(e.target.value)}
      />
      {[0, 1].map(i => (
        <button
          key={i}
          data-testid={`markdown-select-diagram-${i}`}
          onClick={() => props.onSelectDiagram(i)}
        >
          select diagram {i}
        </button>
      ))}
      <button
        data-testid="markdown-viewstate-0"
        onClick={() => props.onViewStateChange?.(0, { viewName: null, hideKeys: ['backend'] })}
      >
        change view state 0
      </button>
    </div>
  ),
}));

global.fetch = vi.fn();

// Stateful file mock: POST persists the body (like the real API) and GET
// returns the current content; postControl.fail simulates a failing write.
// filesState mirrors the directory listing: a POST to a new file adds it.
const fileContent = { current: '' };
const filesState = { list: ['demo.mmd'] };
const postControl = { fail: false };

class MockEventSource {
  static instance: MockEventSource | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    MockEventSource.instance = this;
  }
  close() {}
}
(global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

const fireSse = (file: string) => {
  MockEventSource.instance?.onmessage?.({ data: JSON.stringify({ file }) } as MessageEvent);
};

const DEMO = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const mockFetchWithFile = (content: string) => {
  fileContent.current = content;
  filesState.list = ['demo.mmd'];
  const mockFetch = global.fetch as import('vitest').Mock;
  mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      if (postControl.fail) return { ok: false, status: 500, json: async () => ({}) };
      fileContent.current = JSON.parse(init.body ?? '{}').content ?? '';
      const m = String(url).match(/^\/api\/file\/([^?]+)/);
      if (m && !filesState.list.includes(m[1])) filesState.list.push(m[1]);
      return { ok: true, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => {
        if (String(url).startsWith('/api/file/')) return { content: fileContent.current };
        return { files: [...filesState.list] };
      },
    };
  });
};

const postCalls = () => {
  const mockFetch = global.fetch as import('vitest').Mock;
  return mockFetch.mock.calls.filter(c => (c[1] as { method?: string } | undefined)?.method === 'POST');
};

const mockParams = (params: Record<string, string>) => {
  currentMockParams = { dir: '/old/dir', ...params };
  mockGet.mockImplementation((key: string) => currentMockParams[key] ?? null);
};

// Renders ClientPage in edit mode with the given file content and waits for
// the debounced processed code (and thus the selection map) to be ready.
const renderInEditMode = async (content: string, marker: string) => {
  mockParams({ file: 'demo.mmd', edit: '1' });
  mockFetchWithFile(content);
  render(<ClientPage />);
  const viewer = await screen.findByTestId('diagram-viewer');
  await waitFor(() => {
    expect(viewer.getAttribute('data-code')).toContain(marker);
  }, { timeout: 3000 });
  return viewer;
};

describe('ClientPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileContent.current = '';
    postControl.fail = false;
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });
  afterEach(() => {
    cleanup();
  });

  it('submits a new directory and forces a refresh', async () => {
    mockGet.mockImplementation((key) => {
      if (key === 'dir') return '/old/dir';
      return null;
    });

    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockResolvedValue({
      json: async () => ({ files: ['a.mmd'] })
    });

    render(<ClientPage />);

    const input = screen.getByPlaceholderText('Paste absolute path...');
    fireEvent.change(input, { target: { value: '/new/dir' } });

    const button = screen.getByText('Load Directory');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/?dir=%2Fnew%2Fdir', { scroll: false });
    });
  });

  it('edit mode is on by default when a diagram is opened', async () => {
    mockParams({ file: 'demo.mmd' }); // no edit param at all
    mockFetchWithFile(DEMO);

    render(<ClientPage />);

    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });
    expect(viewer.getAttribute('data-edit-mode')).toBe('true');
    // the right panel and the edit toolbar are visible without any URL param
    expect(await screen.findByText('Click an element in the diagram to edit it.')).toBeTruthy();
    expect(screen.getByTitle('Exit edit mode')).toBeTruthy();
  });

  it('edit=0 opts out of edit mode', async () => {
    mockParams({ file: 'demo.mmd', edit: '0' });
    mockFetchWithFile(DEMO);

    render(<ClientPage />);

    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });
    expect(viewer.getAttribute('data-edit-mode')).toBe('false');
    expect(screen.queryByText('Click an element in the diagram to edit it.')).toBeNull();
    expect(screen.getByTitle('Edit diagram')).toBeTruthy();
  });

  it('the edit toggle opts out with edit=0 and re-enables by removing the param', async () => {
    mockParams({ file: 'demo.mmd' });
    mockFetchWithFile(DEMO);

    const { rerender } = render(<ClientPage />);

    // on by default: the toggle exits edit mode
    const exitButton = await screen.findByTitle('Exit edit mode');
    await waitFor(() => {
      expect((exitButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(exitButton);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('edit=0'), { scroll: false });
    });

    // with edit=0 the toggle re-enables edit mode by dropping the param
    mockParams({ file: 'demo.mmd', edit: '0' });
    rerender(<ClientPage />);
    const editButton = await screen.findByTitle('Edit diagram');
    fireEvent.click(editButton);
    await waitFor(() => {
      const url = mockReplace.mock.calls.at(-1)?.[0] as string;
      expect(url).toContain('dir=');
      expect(url).not.toContain('edit');
    });
  });

  it('edit toggle is disabled with a tooltip for unsupported diagrams (R-01)', async () => {
    mockParams({ file: 'demo.mmd' });
    mockFetchWithFile('this is not a mermaid diagram');

    render(<ClientPage />);

    const button = await screen.findByTitle('Editing is only available for sequence and flowchart diagrams');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(mockReplace).not.toHaveBeenCalledWith(expect.stringContaining('edit=1'), expect.anything());
  });

  it('selecting a message shows the panel with its label', async () => {
    mockParams({ file: 'demo.mmd', edit: '1' });
    mockFetchWithFile(DEMO);

    render(<ClientPage />);

    const viewer = await screen.findByTestId('diagram-viewer');
    // wait for the processed code (debounce) so the selection map can resolve
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });
    expect(viewer.getAttribute('data-edit-mode')).toBe('true');

    fireEvent.click(screen.getByTestId('select-m:0'));

    const input = await screen.findByDisplayValue('Hello');
    expect(input).toBeTruthy();
    expect(viewer.getAttribute('data-selection')).toBe('m:0');
  });

  it('typing a new label dispatches editMessageLabel and updates the processed code', async () => {
    mockParams({ file: 'demo.mmd', edit: '1' });
    mockFetchWithFile(DEMO);

    render(<ClientPage />);

    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });
    fireEvent.click(screen.getByTestId('select-m:0'));

    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });

    // the panel reflects the edit immediately (driven by the raw code)
    await screen.findByDisplayValue('Hi');
    // the processed code passed to the viewer updates after the debounce
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
    }, { timeout: 3000 });
    // the CONFIG line is untouched (the demo has none; editMessageLabel adds none)
    expect(viewer.getAttribute('data-code')).not.toContain('%% CONFIG');
  });

  it('Add Participant appends a new participant to the diagram', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTitle('Add Participant'));

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('participant New1 as New Participant');
    }, { timeout: 3000 });
  });

  it('Add Message appends a message between the first two participants', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTitle('Add Message'));

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: New message');
    }, { timeout: 3000 });
  });

  it('a message created by drag is selected: the right panel shows it', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('drag-create-message'));

    // the new message appears in the diagram (appended at the bottom)
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: New message');
    }, { timeout: 3000 });
    // and it becomes the selection: the viewer highlight follows it once the
    // processed code catches up...
    await waitFor(() => {
      expect(viewer.getAttribute('data-selection')).toBe('m:2');
    }, { timeout: 3000 });
    // ...and the right panel shows the new message's editor
    const input = await screen.findByDisplayValue('New message');
    expect(input).toBeTruthy();
  });

  it('a message created from the Add Message button is selected in the right panel', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTitle('Add Message'));

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: New message');
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(viewer.getAttribute('data-selection')).toBe('m:2');
    }, { timeout: 3000 });
    const input = await screen.findByDisplayValue('New message');
    expect(input).toBeTruthy();
  });

  it('dragging a participant reorders it in the rendered diagram and keeps it selected', async () => {
    const COLORED = `%% CONFIG: {"version":1,"actors":{"Auth":{"color":"red"},"DB":{"color":"red"},"API":{"color":"blue"}}}
sequenceDiagram
    participant Auth as Auth Service
    participant DB as Database
    participant API as API Gateway
    participant C as Client
    Auth->>API: ping`;
    const viewer = await renderInEditMode(COLORED, 'Auth->>API: ping');

    // Drag the rightmost participant (C, processed p:3) to the front before Auth (p:0).
    fireEvent.click(screen.getByTestId('drag-move-participant-front'));

    // Rendered order becomes C, Auth, DB, API.
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const ids = [...code.matchAll(/^\s*participant\s+(\S+)/gm)].map(m => m[1]);
      expect(ids).toEqual(['C', 'Auth', 'DB', 'API']);
    }, { timeout: 3000 });
    // The dragged participant stays selected: C is now rendered at index 0,
    // so its processed key is p:0, and the right panel shows C's editor.
    await waitFor(() => {
      expect(viewer.getAttribute('data-selection')).toBe('p:0');
    }, { timeout: 3000 });
    const input = await screen.findByDisplayValue('Client');
    expect(input).toBeTruthy();
  });

  it('dragging an arrow head retargets the message recipient', async () => {
    const DEMO3 = `sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: Hello
    B-->>A: Hi there`;
    const viewer = await renderInEditMode(DEMO3, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('drag-retarget-head')); // m:0 head -> C (p:2)

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('A->>C: Hello');
      expect(code).not.toContain('A->>B: Hello');
      // the other message is untouched
      expect(code).toContain('B-->>A: Hi there');
    }, { timeout: 3000 });
  });

  it('dragging an arrow tail retargets the message origin', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('drag-retarget-tail')); // m:0 tail -> B (p:1)

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('B->>B: Hello');
      expect(code).toContain('B-->>A: Hi there');
    }, { timeout: 3000 });
  });

  it('a retarget onto the participant already at the endpoint is a no-op (no save)', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockClear();

    // m:0 is A->>B; dragging its head onto B (p:1) changes nothing
    fireEvent.click(screen.getByTestId('drag-retarget-head-same'));

    await new Promise(r => setTimeout(r, 1000)); // past the 800 ms debounce
    expect(postCalls()).toHaveLength(0);
  });

  it('dragging a message vertically reorders it and keeps it selected', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('drag-move-message')); // m:0 after m:1

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code.indexOf('B-->>A: Hi there')).toBeLessThan(code.indexOf('A->>B: Hello'));
      expect(viewer.getAttribute('data-selection')).toBe('m:1');
    }, { timeout: 3000 });
  });

  it('dragging a node reorders it in a flowchart diagram and keeps it selected', async () => {
    const FLOW_DEMO = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| C[Charlie]`;
    const viewer = await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');

    // Drag node C (n:2) before node A (n:0): C's declaration moves to the front
    fireEvent.click(screen.getByTestId('drag-move-node'));

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('    C[Charlie]\n    A[Alice] --> B[Bob]');
    }, { timeout: 3000 });
    // The dragged node stays selected: C is now the first node (n:0)
    await waitFor(() => {
      expect(viewer.getAttribute('data-selection')).toBe('n:0');
    }, { timeout: 3000 });
    const input = await screen.findByDisplayValue('Charlie');
    expect(input).toBeTruthy();
  });

  it('dragging between nodes creates a connection in a flowchart diagram', async () => {
    const FLOW_DEMO = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| C[Charlie]`;
    const viewer = await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');

    // Drag from node A (n:0) to node B (n:1): appends an A -->|New message| B edge
    fireEvent.click(screen.getByTestId('drag-create-connection'));

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('    A -->|New message| B');
    }, { timeout: 3000 });
    // the new edge is selected (e:2), as with sequence message drags
    await waitFor(() => {
      expect(viewer.getAttribute('data-selection')).toBe('e:2');
    }, { timeout: 3000 });
    const input = await screen.findByDisplayValue('New message');
    expect(input).toBeTruthy();
  }, 10000);

  it('shows drag hints per diagram type', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');
    expect(await screen.findByText(/Drag an actor box or lifeline to reorder it/)).toBeTruthy();
    expect(screen.getByText(/drag from the handle below the actor box to add a message/)).toBeTruthy();

    cleanup();

    const FLOW_DEMO = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| C[Charlie]`;
    await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');
    expect(await screen.findByText(/Drag a node into empty space to move it/)).toBeTruthy();
    expect(screen.getByText(/drag from a handle on its edge to connect it to another node/)).toBeTruthy();
  });

  it('Add Message with a selected message inserts after it', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    fireEvent.click(screen.getByTitle('Add Message'));

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code.indexOf('A->>B: New message')).toBeGreaterThan(code.indexOf('A->>B: Hello'));
    }, { timeout: 3000 });
  });

  it('renaming a participant updates the diagram', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-p:0'));

    const input = await screen.findByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    await screen.findByDisplayValue('Alicia');

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('participant A as Alicia');
    }, { timeout: 3000 });
  });

  it('setting a participant color and tag writes them to CONFIG', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    await screen.findByDisplayValue('#e11d48');

    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'backend' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('%% CONFIG: ');
      expect(parseViewsData(code)?.actors?.A).toEqual({ color: '#e11d48', keys: ['backend'] });
    }, { timeout: 3000 });
  });

  it('setting arrow type, color, width and dash updates body and CONFIG', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: '-->>' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Dash'), { target: { value: 'dotted' } });

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      // body: the operator changed in place
      expect(code).toContain('A-->>B: Hello');
      // CONFIG: the full style entry is stored against the raw endpoints
      expect(parseViewsData(code)?.arrows).toEqual([
        { from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dotted' },
      ]);
    }, { timeout: 3000 });
  });

  it('deleting a message removes it immediately without confirmation', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(screen.queryByTestId('delete-dialog')).toBeNull();
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('Hello');
    }, { timeout: 3000 });
    // the selection was cleared with the element
    await screen.findByText(/Click an element in the diagram/);
  });

  it('deleting a participant removes it and its cascaded messages immediately', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');

    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(screen.queryByTestId('delete-dialog')).toBeNull();
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).not.toContain('participant A');
      expect(code).not.toContain('Hello');
      expect(code).not.toContain('Hi there');
      expect(code).toContain('participant B as Bob');
    }, { timeout: 3000 });
  });

  it('deleting a flowchart node deletes it immediately without asking confirmation', async () => {
    const FLOW_DEMO = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| C[Charlie]`;
    const viewer = await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');
    fireEvent.click(screen.getByTestId('select-n:0'));
    await screen.findByDisplayValue('Alice');

    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(screen.queryByTestId('delete-dialog')).toBeNull();
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).not.toContain('A[Alice]');
    }, { timeout: 3000 });
  });

  it('end to end (create -> change -> verify): drive the panel on a newly created diagram', async () => {
    const viewer = await renderInEditMode(createSequenceDiagram(), 'A->>B: Hello');
    const code = () => viewer.getAttribute('data-code') ?? '';

    // add participant -> parseModel gains a participant
    fireEvent.click(screen.getByTitle('Add Participant'));
    await waitFor(() => {
      expect(parseModel(code()).elements.some(e => e.kind === 'participant' && e.id === 'New1')).toBe(true);
    }, { timeout: 3000 });

    // add message -> parseModel gains a message
    fireEvent.click(screen.getByTitle('Add Message'));
    await waitFor(() => {
      expect(parseModel(code()).elements.some(e => e.kind === 'message' && e.label === 'New message')).toBe(true);
    }, { timeout: 3000 });

    // set color and tags -> parseViewsData reflects them
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'backend' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    await waitFor(() => {
      expect(parseViewsData(code())?.actors?.A).toEqual({ color: '#e11d48', keys: ['backend'] });
    }, { timeout: 3000 });

    // set arrow type/color/width/dash -> body + CONFIG both updated
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: '-->>' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#2563eb' } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Dash'), { target: { value: 'dashed' } });
    await waitFor(() => {
      const msg = parseModel(code()).elements.find(e => e.kind === 'message' && e.label === 'Hello');
      expect(msg?.kind === 'message' && msg.operator).toBe('-->>');
      expect(parseViewsData(code())?.arrows).toEqual([
        { from: 'A', to: 'B', label: 'Hello', color: '#2563eb', width: 4, dash: 'dashed' },
      ]);
    }, { timeout: 3000 });

    // delete a participant -> its messages cascade away with it, no confirmation.
    // Participants preserve declaration order (A, B, New1),
    // i.e. processed key p:0 is A.
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');
    fireEvent.click(screen.getByTestId('panel-delete'));
    expect(screen.queryByTestId('delete-dialog')).toBeNull();
    await waitFor(() => {
      const model = parseModel(code());
      expect(model.elements.some(e => e.kind === 'participant' && e.id === 'A')).toBe(false);
      expect(model.elements.some(e => e.kind === 'message')).toBe(false);
    }, { timeout: 3000 });
    // the other participants survive
    const remaining = parseModel(code());
    expect(remaining.elements.some(e => e.kind === 'participant' && e.id === 'B')).toBe(true);
    expect(remaining.elements.some(e => e.kind === 'participant' && e.id === 'New1')).toBe(true);
  }, 15000);

  it('does not auto-save on load (no edit, no POST)', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockClear();
    await new Promise(r => setTimeout(r, 1000)); // past the 800 ms debounce
    expect(postCalls()).toHaveLength(0);
  });

  it('auto-saves an edit with a debounced POST carrying the edited content (create -> change -> verify)', async () => {
    const viewer = await renderInEditMode(createSequenceDiagram(), 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockClear();

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });

    // nothing is posted before the 800 ms debounce fires
    expect(postCalls()).toHaveLength(0);

    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    const [url, init] = postCalls()[0];
    expect(String(url)).toContain('/api/file/demo.mmd');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.content).toContain('A->>B: Hi');
    expect(body.content).not.toContain('Hello');

    // the indicator reports the successful save
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });
    expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
  }, 10000);

  it('ignores an SSE echo of our own save', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
    }, { timeout: 3000 });

    // the file changed on disk (our POST) -> SSE fires -> the refetch returns
    // the last-written content -> ignored: no adoption, no notice
    mockFetch.mockClear();
    await act(async () => { fireSse('demo.mmd'); });
    expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/file/'))).toBe(true); // refetch happened
    expect(screen.queryByTestId('reload-notice')).toBeNull();
    expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
  }, 10000);

  it('adopts an external on-disk change and shows a notice; the next edit wins', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });

    // an external editor writes different content while we are idle
    fileContent.current = DEMO.replace('Hello', 'Edited externally');
    await act(async () => { fireSse('demo.mmd'); });

    const notice = await screen.findByTestId('reload-notice');
    expect(notice.textContent).toContain('Reloaded from disk');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Edited externally');
    }, { timeout: 3000 });

    // editing again wins: the auto-save posts the new content
    mockFetch.mockClear();
    fireEvent.click(screen.getByTestId('select-m:0'));
    const input2 = await screen.findByDisplayValue('Edited externally');
    fireEvent.change(input2, { target: { value: 'Mine again' } });
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    const body = JSON.parse((postCalls()[0][1] as { body: string }).body);
    expect(body.content).toContain('Mine again');
    expect(body.content).not.toContain('Edited externally');
  }, 10000);

  it('shows an error indicator when the save fails and retries on the next edit', async () => {
    postControl.fail = true;
    await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockClear();

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });

    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Save failed');
    }, { timeout: 3000 });
    expect(postCalls()).toHaveLength(1);

    // the next edit retries the save
    postControl.fail = false;
    fireEvent.change(screen.getByDisplayValue('Hi'), { target: { value: 'Hi again' } });
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });
    expect(postCalls().length).toBeGreaterThanOrEqual(2);
    const lastPost = postCalls()[postCalls().length - 1];
    expect(JSON.parse((lastPost[1] as { body: string }).body).content).toContain('Hi again');
  }, 10000);

  it('saving a view updates the last-written content (its SSE echo is ignored)', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;
    (window as unknown as { prompt: unknown }).prompt = vi.fn(() => 'My View');
    mockFetch.mockClear();

    fireEvent.click(screen.getByTitle('Save Current View'));
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('"views"');
    }, { timeout: 3000 });

    // the SSE echo of the view save carries the last-written content -> ignored
    mockFetch.mockClear();
    await act(async () => { fireSse('demo.mmd'); });
    expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/file/'))).toBe(true); // refetch happened
    expect(screen.queryByTestId('reload-notice')).toBeNull();
    expect(viewer.getAttribute('data-code')).toContain('"views"');
  }, 10000);

  it('loading a saved view applies hiddenPaths and actor filters to URL params', async () => {
    const codeWithView = `%% CONFIG: {"version":1,"views":[{"name":"Custom View","hiddenPaths":["tag=beta"],"mergeKeys":["backend"],"hideColors":["red"]}]}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello`;

    await renderInEditMode(codeWithView, 'A->>B: Hello');
    mockReplace.mockClear();

    const loadBtn = screen.getByTitle('Load View');
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    const url = decodeURIComponent(mockReplace.mock.calls.at(-1)?.[0] as string);
    expect(url).toContain('hidden=tag=beta');
    expect(url).toContain('merge_key=backend');
    expect(url).toContain('hide_color=red');
  }, 10000);

  it('loading a saved view clears stale actor filter params', async () => {
    const codeWithView = `%% CONFIG: {"version":1,"views":[{"name":"Regions Only","hiddenPaths":["path1"]}]}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello`;

    mockParams({ file: 'demo.mmd', edit: '1', merge_key: 'old_key', hide_color: 'old_color' });
    mockFetchWithFile(codeWithView);
    render(<ClientPage />);
    await screen.findByTestId('diagram-viewer');
    mockReplace.mockClear();

    const loadBtn = screen.getByTitle('Load View');
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    const url = decodeURIComponent(mockReplace.mock.calls.at(-1)?.[0] as string);
    expect(url).toContain('hidden=path1');
    expect(url).not.toContain('merge_key=');
    expect(url).not.toContain('hide_color=');
  }, 10000);

  it('saving a view captures active actor filters into the saved view config', async () => {
    mockParams({ file: 'demo.mmd', edit: '1', hidden: 'flow=1', merge_key: 'backend', hide_color: 'red' });
    mockFetchWithFile(DEMO);
    render(<ClientPage />);
    await screen.findByTestId('diagram-viewer');
    (window as unknown as { prompt: unknown }).prompt = vi.fn(() => 'Actor Snapshot');
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockClear();

    fireEvent.click(screen.getByTitle('Save Current View'));
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    const lastPost = postCalls().at(-1);
    const savedContent = JSON.parse((lastPost?.[1] as { body: string }).body).content as string;
    expect(savedContent).toContain('"name":"Actor Snapshot"');
    expect(savedContent).toContain('"mergeKeys":["backend"]');
    expect(savedContent).toContain('"hideColors":["red"]');
    expect(savedContent).toContain('"hiddenPaths":["flow=1"]');
  }, 10000);

  it('undo reverts an edit and redo reapplies it (toolbar buttons)', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    // no edits yet: both buttons disabled
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('Redo (Ctrl+Y)') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });
    await screen.findByDisplayValue('Hi');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
    }, { timeout: 3000 });
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    }, { timeout: 3000 });
    expect(viewer.getAttribute('data-code')).not.toContain('A->>B: Hi');
    // the panel follows the reverted state (the selection survives the undo)
    await screen.findByDisplayValue('Hello');
    expect((screen.getByTitle('Redo (Ctrl+Y)') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
    }, { timeout: 3000 });
    await screen.findByDisplayValue('Hi');
  }, 10000);

  it('a new edit clears the redo stack', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hello'), { target: { value: 'Hi' } });
    await screen.findByDisplayValue('Hi');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    }, { timeout: 3000 });
    expect((screen.getByTitle('Redo (Ctrl+Y)') as HTMLButtonElement).disabled).toBe(false);

    // a new edit while the future stack is non-empty clears it
    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hello'), { target: { value: 'Hey' } });
    await screen.findByDisplayValue('Hey');
    expect((screen.getByTitle('Redo (Ctrl+Y)') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hey');
    }, { timeout: 3000 });
    expect(viewer.getAttribute('data-code')).not.toContain('A->>B: Hi');
  }, 10000);

  it('Ctrl+Z / Ctrl+Y trigger undo/redo', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hello'), { target: { value: 'Hi' } });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
    }, { timeout: 3000 });

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    }, { timeout: 3000 });

    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hi');
    }, { timeout: 3000 });
  }, 10000);

  it('does not hijack Ctrl+Z inside text inputs', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hi' } });
    await screen.findByDisplayValue('Hi');
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(false);

    // Ctrl+Z inside the label input is the input's own undo, not the diagram's
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(false);
  }, 10000);

  it('switching files resets the undo history', async () => {
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DEMO);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });

    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hello'), { target: { value: 'Hi' } });
    await screen.findByDisplayValue('Hi');
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(false);

    // switch to another file
    params.file = 'other.mmd';
    fileContent.current = 'sequenceDiagram\n    participant X\n    X->>X: Solo';
    rerender(<ClientPage />);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Solo');
    }, { timeout: 3000 });

    // history was reset: undo is disabled and the old edit is gone
    expect((screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement).disabled).toBe(true);
    expect(viewer.getAttribute('data-code')).not.toContain('Hello');
  }, 10000);

  it('auto-save applies to undo results', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');
    const mockFetch = global.fetch as import('vitest').Mock;

    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hello'), { target: { value: 'Hi' } });
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });

    // undoing reverts the file content on disk too
    mockFetch.mockClear();
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    const body = JSON.parse((postCalls()[0][1] as { body: string }).body);
    expect(body.content).toContain('A->>B: Hello');
    expect(body.content).not.toContain('A->>B: Hi');
  }, 10000);

  it('end to end (create -> change -> verify): three edits, undo twice, redo, future cleared (Step 10)', async () => {
    const viewer = await renderInEditMode(createSequenceDiagram(), 'A->>B: Hello');
    const code = () => viewer.getAttribute('data-code') ?? '';

    // edit 1: rename the message label
    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hello'), { target: { value: 'Hi' } });
    await screen.findByDisplayValue('Hi');
    // edit 2: rename the participant
    fireEvent.click(screen.getByTestId('select-p:0'));
    fireEvent.change(await screen.findByDisplayValue('Alice'), { target: { value: 'Alicia' } });
    await screen.findByDisplayValue('Alicia');
    // edit 3: add a participant
    fireEvent.click(screen.getByTitle('Add Participant'));
    await waitFor(() => {
      expect(parseModel(code()).elements.some(e => e.kind === 'participant' && e.id === 'New1')).toBe(true);
    }, { timeout: 3000 });

    // undo twice: the participant add reverts, then the participant rename
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    await waitFor(() => {
      expect(parseModel(code()).elements.some(e => e.kind === 'participant' && e.id === 'New1')).toBe(false);
    }, { timeout: 3000 });
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    await waitFor(() => {
      expect(parseModel(code()).elements.some(e => e.kind === 'participant' && e.alias === 'Alicia')).toBe(false);
    }, { timeout: 3000 });
    expect(parseModel(code()).elements.some(e => e.kind === 'participant' && e.alias === 'Alice')).toBe(true);
    // edit 1 is still in effect
    expect(parseModel(code()).elements.some(e => e.kind === 'message' && e.label === 'Hi')).toBe(true);

    // redo: the participant rename reapplies
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    await waitFor(() => {
      expect(parseModel(code()).elements.some(e => e.kind === 'participant' && e.alias === 'Alicia')).toBe(true);
    }, { timeout: 3000 });

    // a new edit clears the future stack
    fireEvent.click(screen.getByTestId('select-m:0'));
    fireEvent.change(await screen.findByDisplayValue('Hi'), { target: { value: 'Hey' } });
    await screen.findByDisplayValue('Hey');
    expect((screen.getByTitle('Redo (Ctrl+Y)') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => {
      expect(code()).toContain('A->>B: Hey');
    }, { timeout: 3000 });
  }, 15000);

  it('undo/redo stores at most 15 entries (the oldest edits fall off the stack)', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    // 20 edits: the label becomes v1 .. v20
    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    for (let i = 1; i <= 20; i++) {
      fireEvent.change(input, { target: { value: `v${i}` } });
    }
    await screen.findByDisplayValue('v20');

    // 15 undos land exactly on v5: the stack kept the last 15 states
    // (v19 .. v5), the older ones (v4 .. v0) fell off the cap
    const undoButton = () => screen.getByTitle('Undo (Ctrl+Z)') as HTMLButtonElement;
    for (let i = 0; i < 15; i++) {
      fireEvent.click(undoButton());
    }
    await screen.findByDisplayValue('v5');
    expect(undoButton().disabled).toBe(true);

    // a 16th undo is a no-op
    fireEvent.click(undoButton());
    await screen.findByDisplayValue('v5');

    // redo still works within the capped window: 15 redos reach v20
    const redoButton = () => screen.getByTitle('Redo (Ctrl+Y)') as HTMLButtonElement;
    for (let i = 0; i < 15; i++) {
      fireEvent.click(redoButton());
    }
    await screen.findByDisplayValue('v20');
    expect(redoButton().disabled).toBe(true);
  }, 15000);

  it('tags set in the panel appear in the sidebar Actors controls (By Key)', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    // no CONFIG yet -> no Actors section
    expect(screen.queryByText('By Color')).toBeNull();
    expect(screen.queryByText('By Key')).toBeNull();

    // set a color and a tag on participant A through the panel
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'backend' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    // the Actors panel reads CONFIG: By Key appears and By Color is removed
    expect(screen.queryByText('By Color')).toBeNull();
    await screen.findByText('By Key');
    // the panel tag chip and the sidebar By Key item both render the key
    expect(screen.getAllByText('backend').length).toBeGreaterThanOrEqual(2);
  }, 10000);

  it('message tags set in the panel land in CONFIG.arrows and the sidebar By Key controls', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'critical' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    // the panel chip and the sidebar By Key item both render the key
    await waitFor(() => {
      expect(screen.getAllByText('critical').length).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });
    // and it persists in the CONFIG header on the file
    await waitFor(() => {
      expect(fileContent.current).toContain('"arrows":[{"from":"A","to":"B","label":"Hello","keys":["critical"]}]');
    }, { timeout: 3000 });
  }, 10000);

  it('the inherit toggle stores keyMode merged on the selected message and back', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');
    fireEvent.click(screen.getByTestId('arrow-inherit-on'));
    await waitFor(() => {
      expect(fileContent.current).toContain('"keyMode":"merged"');
    }, { timeout: 3000 });

    // back to Off (clean, the default): the field is gone again
    fireEvent.click(screen.getByTestId('arrow-inherit-off'));
    await waitFor(() => {
      expect(fileContent.current).not.toContain('keyMode');
    }, { timeout: 3000 });
  }, 10000);

  it('hiding a message-only key in the sidebar filters the message out of the diagram', async () => {
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DEMO);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    }, { timeout: 3000 });

    // tag the message, then hide its key through the sidebar Off button
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'critical' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getAllByText('critical').length).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });

    const keyItem = screen.getAllByText('critical').find(el => el.closest('li'))!.closest('li')!;
    fireEvent.click(within(keyItem).getByText('Off'));
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('hide_key=critical'), { scroll: false });

    // simulate the URL change taking effect: the message line is dropped
    params.hide_key = 'critical';
    rerender(<ClientPage />);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('A->>B: Hello');
    }, { timeout: 3000 });
    // the other message and both participants survive
    expect(viewer.getAttribute('data-code')).toContain('B-->>A: Hi there');
    expect(viewer.getAttribute('data-code')).toContain('participant A as Alice');
  }, 10000);

  it('a box subgraph key appears in the sidebar By Key with no CONFIG, and Merged collapses the group into one actor', async () => {
    // mermaid sequence diagrams group actors with `box`; the key is structural,
    // derived from the box title, so no CONFIG line is needed.
    const BOXED = `sequenceDiagram
    participant Client
    box Payment Service
    participant Gateway
    participant Processor
    end
    Client->>Gateway: pay
    Gateway->>Processor: charge
    Processor-->>Client: receipt`;
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(BOXED);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Client->>Gateway: pay');
    }, { timeout: 3000 });

    // the structural subgraph key shows up in the sidebar without any CONFIG
    await screen.findByText('By Key');
    const keyItem = screen.getByText('payment-service').closest('li')!;
    expect(fileContent.current).not.toContain('CONFIG');

    // Merged collapses the whole box into a single actor labeled with the box title
    fireEvent.click(within(keyItem).getByText('Merged'));
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('merge_key=payment-service'), { scroll: false });

    // simulate the URL change taking effect
    params.merge_key = 'payment-service';
    rerender(<ClientPage />);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('participant MergedKey_paymentservice as Payment Service');
    }, { timeout: 3000 });
    const code = viewer.getAttribute('data-code') ?? '';
    // the internal call becomes a self-call on the merged actor
    expect(code).toContain('MergedKey_paymentservice->>MergedKey_paymentservice: charge');
    // the boundary messages are rewired to the merged actor
    expect(code).toContain('Client->>MergedKey_paymentservice: pay');
    expect(code).toContain('MergedKey_paymentservice-->>Client: receipt');
    // the raw participants are gone
    expect(code).not.toContain('participant Gateway');
    expect(code).not.toContain('participant Processor');
    // the merge is a URL param only: nothing was written to the file
    expect(fileContent.current).not.toContain('CONFIG');
    expect(fileContent.current).toContain('box Payment Service');
  }, 10000);

  it('hiding a subgraph key in the sidebar removes the group actors and their messages', async () => {
    const BOXED = `sequenceDiagram
    participant Client
    box Payment Service
    participant Gateway
    participant Processor
    end
    Client->>Gateway: pay
    Gateway->>Processor: charge
    Processor-->>Client: receipt`;
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(BOXED);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Client->>Gateway: pay');
    }, { timeout: 3000 });

    const keyItem = screen.getByText('payment-service').closest('li')!;
    fireEvent.click(within(keyItem).getByText('Off'));
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('hide_key=payment-service'), { scroll: false });

    // simulate the URL change taking effect
    params.hide_key = 'payment-service';
    rerender(<ClientPage />);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('Gateway');
    }, { timeout: 3000 });
    const code = viewer.getAttribute('data-code') ?? '';
    // only the outside actor survives; every message touched the hidden group
    expect(code).toContain('participant Client');
    expect(code).not.toContain('Processor');
    expect(code).not.toContain('charge');
    // the emptied box is cleaned up
    expect(code).not.toContain('box Payment Service');
  }, 10000);

  it('resets all filters when clicking Reset next to By Key', async () => {
    const DIAGRAM = `sequenceDiagram
    participant Client
    box Payment Service
    participant Gateway
    end
    Client->>Gateway: pay`;
    const params: Record<string, string> = {
      file: 'demo.mmd',
      edit: '1',
      merge_key: 'payment-service',
      hide_key: 'other',
    };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DIAGRAM);
    render(<ClientPage />);
    await screen.findByText('By Key');

    const resetButton = screen.getByRole('button', { name: 'Reset' });
    fireEvent.click(resetButton);

    expect(mockReplace).toHaveBeenCalled();
    const lastCall = mockReplace.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).not.toContain('merge_key');
    expect(lastCall).not.toContain('hide_key');
  });

  it('shows "still merged via" hint when an On/Off key has actors merged by another key, and clicking it sets that key to On', async () => {
    const DIAGRAM = `%% CONFIG: {"version":1,"actors":{"CashOut":{"keys":["enrichment"]}}}
sequenceDiagram
    box Enrichment (degrade on failure)
    participant CashOut
    end`;
    const params: Record<string, string> = {
      file: 'demo.mmd',
      edit: '1',
      merge_key: 'enrichment-degrade-on-failure',
    };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DIAGRAM);
    render(<ClientPage />);
    await screen.findByText('By Key');

    // 'enrichment' is On, but CashOut is merged via 'enrichment-degrade-on-failure'
    const hint = await screen.findByText(/1 actor still merged via/);
    expect(hint.textContent).toContain('1 actor still merged via enrichment-degrade-on-failure');

    // Clicking the hint sets 'enrichment-degrade-on-failure' to On (removes it from merge_key)
    fireEvent.click(hint);
    expect(mockReplace).toHaveBeenCalled();
    const lastCall = mockReplace.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).not.toContain('enrichment-degrade-on-failure');
  });

  it('shows "overridden by" hint when a Merged key is not winning for any actors, and clicking it sets the winning key to On', async () => {
    const DIAGRAM = `%% CONFIG: {"version":1,"actors":{"CashOut":{"keys":["enrichment"]}}}
sequenceDiagram
    box Enrichment (degrade on failure)
    participant CashOut
    end`;
    const params: Record<string, string> = {
      file: 'demo.mmd',
      edit: '1',
      merge_key: 'enrichment,enrichment-degrade-on-failure',
    };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DIAGRAM);
    render(<ClientPage />);
    await screen.findByText('By Key');

    // 'enrichment-degrade-on-failure' is merged in URL, but overridden by 'enrichment'
    const hint = await screen.findByText(/overridden by/);
    expect(hint.textContent).toContain('overridden by enrichment');

    // Clicking the hint sets 'enrichment' to On (removes it from merge_key)
    fireEvent.click(hint);
    expect(mockReplace).toHaveBeenCalled();
    const lastCall = mockReplace.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).not.toContain('enrichment,');
    expect(lastCall).toContain('enrichment-degrade-on-failure');
  });

  it('a broken diagram (unclosed region) still renders, shows a warning, and recognized elements stay editable (NFR-01)', async () => {
    const broken = `${DEMO}\n    %% @region-start: flow=checkout`;  // unclosed
    const viewer = await renderInEditMode(broken, 'A->>B: Hello');

    // the pipeline soft-failed: the viewer still receives the original content
    expect(viewer.getAttribute('data-code')).toContain('%% @region-start: flow=checkout');
    // the warning indicator shows
    expect(await screen.findByText('1 warning(s)')).toBeTruthy();

    // the broken area (the region) is not selectable: the panel stays empty
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');
    fireEvent.click(screen.getByTestId('select-r:0'));
    expect(await screen.findByText('Click an element in the diagram to edit it.')).toBeTruthy();

    // edits to recognized elements still work and auto-save
    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Hey' } });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hey');
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(fileContent.current).toContain('A->>B: Hey');
  }, 10000);

  it('a soft-failing edit is a no-op and shows the warning in the panel (NFR-01)', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');
    const tagInput = screen.getByPlaceholderText('Add tag...');
    fireEvent.change(tagInput, { target: { value: 'bad tag!' } });
    fireEvent.click(screen.getByTestId('add-tag'));

    // the transform soft-failed: the warning shows in the panel
    expect(await screen.findByText('Invalid tag: bad tag!')).toBeTruthy();
    // the code is unchanged and nothing was saved
    expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    expect(viewer.getAttribute('data-code')).not.toContain('CONFIG');
    await screen.findByDisplayValue('Alice');  // the selection survived
    await new Promise(r => setTimeout(r, 1000));  // past the 800 ms auto-save debounce
    expect(postCalls()).toHaveLength(0);
  }, 10000);

  it('rapid successive edits coalesce: the final state wins and the selection survives (NFR-03)', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    // three edits in quick succession (inside the 500 ms render debounce)
    fireEvent.change(input, { target: { value: 'One' } });
    fireEvent.change(input, { target: { value: 'Two' } });
    fireEvent.change(input, { target: { value: 'Three' } });

    // the panel reflects the last edit immediately
    await screen.findByDisplayValue('Three');
    // the debounced render shows only the final state
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Three');
    }, { timeout: 3000 });
    expect(viewer.getAttribute('data-code')).not.toContain('A->>B: Two');
    // the selection (highlight target) is intact
    expect(viewer.getAttribute('data-selection')).toBe('m:0');

    // a single auto-save carried the final content
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
    expect(fileContent.current).toContain('A->>B: Three');
    expect(fileContent.current).not.toContain('A->>B: Two');
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });
  }, 10000);

  it('end to end (create -> change -> verify): create a new diagram (name + type), open it, edit it, auto-save', async () => {
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DEMO);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });

    // create a brand-new flowchart through the dialog
    fireEvent.click(screen.getByTestId('new-diagram'));
    fireEvent.change(screen.getByTestId('new-diagram-name'), { target: { value: 'fresh' } });
    fireEvent.change(screen.getByTestId('new-diagram-type'), { target: { value: 'flowchart' } });
    fireEvent.click(screen.getByTestId('new-diagram-create'));

    // the file was created through the API with the flowchart template
    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    const [createUrl, createInit] = postCalls()[0];
    expect(String(createUrl)).toContain('/api/file/fresh.mmd');
    const createBody = JSON.parse((createInit as { body: string }).body);
    expect(createBody.content).toContain('flowchart TD');
    expect(createBody.content).toContain('A[Alice] --> B[Bob]');
    // the app navigated to the new file
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('file=fresh.mmd'), { scroll: false });
    });

    // simulate the URL change (the mock router does not navigate)
    params.file = 'fresh.mmd';
    rerender(<ClientPage />);
    const mockFetch = global.fetch as import('vitest').Mock;
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(c => String(c[0]).includes('/api/file/fresh.mmd'))).toBe(true);
    });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A[Alice] --> B[Bob]');
    }, { timeout: 3000 });
    // the sidebar lists the new file
    expect(await screen.findByText('fresh.mmd')).toBeTruthy();

    // change: edit an edge of the new diagram; the edit auto-saves to the new file
    fireEvent.click(screen.getByTestId('select-e:1'));
    fireEvent.change(await screen.findByDisplayValue('Reply'), { target: { value: 'Thanks' } });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('B -->|Thanks| A');
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
    }, { timeout: 3000 });
    expect(fileContent.current).toContain('B -->|Thanks| A');
    const lastPost = postCalls()[postCalls().length - 1];
    expect(String(lastPost[0])).toContain('/api/file/fresh.mmd');
  }, 15000);

  it('creating a sequence diagram normalizes the name and opens the new file', async () => {
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DEMO);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    });

    // the user types the extension too: it must not be doubled
    fireEvent.click(screen.getByTestId('new-diagram'));
    fireEvent.change(screen.getByTestId('new-diagram-name'), { target: { value: 'seq-one.mmd' } });
    fireEvent.click(screen.getByTestId('new-diagram-create'));

    await waitFor(() => {
      expect(postCalls().length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(String(postCalls()[0][0])).toContain('/api/file/seq-one.mmd');
    const body = JSON.parse((postCalls()[0][1] as { body: string }).body);
    expect(body.content).toContain('sequenceDiagram');

    params.file = 'seq-one.mmd';
    rerender(<ClientPage />);
    const mockFetch = global.fetch as import('vitest').Mock;
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(c => String(c[0]).includes('/api/file/seq-one.mmd'))).toBe(true);
    });
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    }, { timeout: 3000 });
    expect(await screen.findByText('seq-one.mmd')).toBeTruthy();
  }, 15000);

  it('the New Diagram dialog validates the name and reports API failures', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('new-diagram'));
    const dialog = await screen.findByTestId('new-diagram-dialog');

    // empty name
    fireEvent.click(screen.getByTestId('new-diagram-create'));
    expect((await screen.findByTestId('new-diagram-error')).textContent).toBe('Enter a file name');
    expect(postCalls()).toHaveLength(0);

    // duplicate of an existing file
    fireEvent.change(screen.getByTestId('new-diagram-name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByTestId('new-diagram-create'));
    expect((await screen.findByTestId('new-diagram-error')).textContent).toBe('demo.mmd already exists');
    expect(postCalls()).toHaveLength(0);

    // characters outside the safe set
    fireEvent.change(screen.getByTestId('new-diagram-name'), { target: { value: 'my diagram!' } });
    fireEvent.click(screen.getByTestId('new-diagram-create'));
    expect((await screen.findByTestId('new-diagram-error')).textContent).toBe('Use letters, numbers, dashes and underscores only');
    expect(postCalls()).toHaveLength(0);

    // the API write fails
    postControl.fail = true;
    fireEvent.change(screen.getByTestId('new-diagram-name'), { target: { value: 'okname' } });
    fireEvent.click(screen.getByTestId('new-diagram-create'));
    expect((await screen.findByTestId('new-diagram-error')).textContent).toBe('Could not create the file');
    expect(postCalls()).toHaveLength(1);
    postControl.fail = false;

    // cancel closes the dialog without creating anything
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByTestId('new-diagram-cancel'));
    expect(screen.queryByTestId('new-diagram-dialog')).toBeNull();
    expect(postCalls()).toHaveLength(1);
  }, 10000);

  it('shows an error when the directory cannot be read', async () => {
    mockParams({ dir: '/bad/dir' });
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockResolvedValue({
      json: async () => ({ error: 'Failed to read directory' })
    });

    render(<ClientPage />);

    const err = await screen.findByTestId('files-error');
    expect(err.textContent).toContain('Failed to read directory');
    expect(err.textContent).toContain('/bad/dir');
  });

  it('shows a hint when the directory has no .mmd or .md files', async () => {
    mockParams({ dir: '/empty/dir' });
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockResolvedValue({
      json: async () => ({ files: [], markdownFiles: [] })
    });

    render(<ClientPage />);

    expect(await screen.findByText('No .mmd or .md files in this directory')).toBeTruthy();
    expect(screen.queryByTestId('files-error')).toBeNull();
  });

  it('keeps the directory input in sync with the dir URL param', async () => {
    mockParams({ dir: '/first/dir' });
    const mockFetch = global.fetch as import('vitest').Mock;
    mockFetch.mockResolvedValue({
      json: async () => ({ files: [] })
    });

    const { rerender } = render(<ClientPage />);
    expect((screen.getByPlaceholderText('Paste absolute path...') as HTMLInputElement).value).toBe('/first/dir');

    // the URL changes without the form (back/forward, pasted link, recent click)
    mockParams({ dir: '/second/dir' });
    rerender(<ClientPage />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Paste absolute path...') as HTMLInputElement).value).toBe('/second/dir');
    });
  });

  it('copy button copies current mermaid source code and verifies it is valid', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    const copyBtn = screen.getByTestId('copy-mermaid');
    expect(copyBtn).toBeTruthy();
    expect(copyBtn.getAttribute('title')).toBe('Copy Mermaid Code');
    expect(within(copyBtn).getByText('Copy')).toBeTruthy();

    fireEvent.click(copyBtn);

    // Verify clipboard was called with the diagram's current mermaid code
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copiedCode = (navigator.clipboard.writeText as import('vitest').Mock).mock.calls[0][0];
    expect(copiedCode).toContain('A->>B: Hello');
    expect(copiedCode).toContain('B-->>A: Hi there');

    // Verify the copied Mermaid is valid using mermaid.parse
    await expect(mermaid.parse(copiedCode)).resolves.not.toThrow();
    const model = parseModel(copiedCode);
    expect(model.type).toBe('sequence');
    expect(model.elements.length).toBeGreaterThan(0);

    // Verify visual feedback
    expect(within(copyBtn).getByText('Copied')).toBeTruthy();
  });

  it('copy button copies updated valid mermaid code after an edit and after undo', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    const copyBtn = screen.getByTestId('copy-mermaid');

    // Select message m:0 and update its label to "Updated Message"
    fireEvent.click(screen.getByTestId('select-m:0'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.change(input, { target: { value: 'Updated Message' } });

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Updated Message');
    });

    // Click copy button
    fireEvent.click(copyBtn);
    const mockCalls = (navigator.clipboard.writeText as import('vitest').Mock).mock.calls;
    let copiedCode = mockCalls[mockCalls.length - 1]?.[0] as string;
    expect(copiedCode).toContain('Updated Message');

    // Verify valid mermaid code
    await expect(mermaid.parse(copiedCode)).resolves.not.toThrow();

    // Click undo button
    const undoBtn = screen.getByTitle('Undo (Ctrl+Z)');
    fireEvent.click(undoBtn);

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('Updated Message');
      expect(viewer.getAttribute('data-code')).toContain('Hello');
    });

    // Click copy button again
    fireEvent.click(copyBtn);
    copiedCode = mockCalls[mockCalls.length - 1]?.[0] as string;
    expect(copiedCode).toContain('Hello');
    expect(copiedCode).not.toContain('Updated Message');

    // Verify still valid mermaid code
    await expect(mermaid.parse(copiedCode)).resolves.not.toThrow();
  });

  it('copy button copies valid flowchart mermaid code', async () => {
    const FLOW_DEMO = `flowchart TD\n    A[Alice] --> B[Bob]\n    B -->|Reply| C[Charlie]`;
    await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');

    const copyBtn = screen.getByTestId('copy-mermaid');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copiedCode = (navigator.clipboard.writeText as import('vitest').Mock).mock.calls[0][0];
    expect(copiedCode).toContain('flowchart TD');
    expect(copiedCode).toContain('A[Alice] --> B[Bob]');

    // Verify valid flowchart mermaid syntax
    await expect(mermaid.parse(copiedCode)).resolves.not.toThrow();
    const model = parseModel(copiedCode);
    expect(model.type).toBe('flowchart');
  });

  it('shift-clicking multiple elements allows adding tag to all and removing tag from one', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    // 1. Single click selects participant A
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');

    // 2. Shift-click message m:0
    fireEvent.click(screen.getByTestId('select-m:0'), { shiftKey: true });

    // Panel shows multi-element view with 2 elements
    await screen.findByText('Selected Elements (2)');

    // 3. Add tag "shared" to all selected elements using free text input
    const tagInput = screen.getByTestId('multi-add-tag-input');
    fireEvent.change(tagInput, { target: { value: 'shared' } });
    fireEvent.click(screen.getByTestId('multi-add-tag'));

    // Verify CONFIG persisted the tag for both participant A and message m:0
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const cfg = parseViewsData(code);
      expect(cfg?.actors?.A?.keys).toContain('shared');
      const arrow = cfg?.arrows?.find(a => a.from === 'A' && a.to === 'B');
      expect(arrow?.keys).toContain('shared');
    }, { timeout: 3000 });

    // 4. Shift-click participant B to add to selection (now 3 elements)
    fireEvent.click(screen.getByTestId('select-p:1'), { shiftKey: true });
    await screen.findByText('Selected Elements (3)');

    // 5. Select existing tag "shared" from dropdown and add to all
    const select = screen.getByTestId('multi-select-existing-tag') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'shared' } });
    fireEvent.click(screen.getByTestId('multi-add-existing-tag'));

    // Participant B now also has "shared"
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const cfg = parseViewsData(code);
      expect(cfg?.actors?.B?.keys).toContain('shared');
    }, { timeout: 3000 });

    // 6. Remove tag "shared" from participant A
    fireEvent.click(screen.getByTestId('remove-tag-p:0-shared'));

    // Verify participant A lost "shared", but B still has it
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const cfg = parseViewsData(code);
      expect(cfg?.actors?.A?.keys ?? []).not.toContain('shared');
      expect(cfg?.actors?.B?.keys).toContain('shared');
    }, { timeout: 3000 });

    // 7. Shift-click participant B toggles it off
    fireEvent.click(screen.getByTestId('select-p:1'), { shiftKey: true });
    await screen.findByText('Selected Elements (2)');
  });

  it('notes support shift-select, tagging and hiding like other elements', async () => {
    const DEMO_NOTES = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    Note over A,B: Retry policy
    B-->>A: Hi there`;
    const params: Record<string, string> = { file: 'demo.mmd', edit: '1' };
    mockGet.mockImplementation((key: string) => params[key] ?? null);
    mockFetchWithFile(DEMO_NOTES);
    const { rerender } = render(<ClientPage />);
    const viewer = await screen.findByTestId('diagram-viewer');
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Retry policy');
    }, { timeout: 3000 });

    // 1. Single click selects the note: the panel shows its tags editor
    fireEvent.click(screen.getByTestId('select-note:0'));
    expect(await screen.findByTestId('note-add-tag-input')).toBeTruthy();
    expect(screen.queryByText('This element is not editable.')).toBeNull();

    // 2. Shift-click the message: the note joins the multi-selection
    fireEvent.click(screen.getByTestId('select-m:0'), { shiftKey: true });
    await screen.findByText('Selected Elements (2)');

    // 3. Add tag "shared" to all selected elements (note + message)
    const tagInput = screen.getByTestId('multi-add-tag-input');
    fireEvent.change(tagInput, { target: { value: 'shared' } });
    fireEvent.click(screen.getByTestId('multi-add-tag'));

    // CONFIG persisted the tag on both the note and the message
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const cfg = parseViewsData(code);
      expect(cfg?.noteTags).toEqual([{ over: ['A', 'B'], text: 'Retry policy', keys: ['shared'] }]);
      expect(cfg?.arrows?.find(a => a.from === 'A' && a.to === 'B')?.keys).toContain('shared');
    }, { timeout: 3000 });

    // 4. The tag appears in the sidebar under Actors -> By Key
    await waitFor(() => {
      expect(screen.getAllByText('shared').length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // 5. Remove the tag from the note only (per-element chip in multi-select)
    fireEvent.click(screen.getByTestId('remove-tag-note:0-shared'));
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const cfg = parseViewsData(code);
      expect(cfg?.noteTags ?? []).toHaveLength(0);
      // the message keeps the tag
      expect(cfg?.arrows?.find(a => a.from === 'A' && a.to === 'B')?.keys).toContain('shared');
    }, { timeout: 3000 });

    // 6. Tag the note alone through its own panel, then hide the key
    fireEvent.click(screen.getByTestId('select-note:0'));
    const noteInput = await screen.findByTestId('note-add-tag-input');
    fireEvent.change(noteInput, { target: { value: 'flaky' } });
    fireEvent.click(screen.getByTestId('note-add-tag'));
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const cfg = parseViewsData(code);
      expect(cfg?.noteTags?.[0].keys).toContain('flaky');
    }, { timeout: 3000 });

    const keyItem = screen.getAllByText('flaky').find(el => el.closest('li'))!.closest('li')!;
    fireEvent.click(within(keyItem).getByText('Off'));
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('hide_key=flaky'), { scroll: false });

    // simulate the URL change taking effect: the note line is dropped
    params.hide_key = 'flaky';
    rerender(<ClientPage />);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('Note over A,B');
    }, { timeout: 3000 });
    // the untagged message and participants survive
    expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
    expect(viewer.getAttribute('data-code')).toContain('participant A as Alice');

    // 7. Un-hide: the note returns
    const keyItemOn = screen.getAllByText('flaky').find(el => el.closest('li'))!.closest('li')!;
    fireEvent.click(within(keyItemOn).getByText('On'));
    delete params.hide_key;
    rerender(<ClientPage />);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('Note over A,B');
    }, { timeout: 3000 });
  }, 15000);

  it('adds a sticky note via + Note button, updates count, and persists to CONFIG', async () => {
    const viewer = await renderInEditMode(DEMO, 'Alice');

    const notesInfo = screen.getByTestId('mock-notes-info');
    expect(notesInfo.getAttribute('data-count')).toBe('0');

    // Click + Note
    const addNoteBtn = screen.getByTestId('add-sticky-note');
    fireEvent.click(addNoteBtn);

    await waitFor(() => {
      expect(notesInfo.getAttribute('data-count')).toBe('1');
      const parsed = parseViewsData(viewer.getAttribute('data-code') ?? '');
      expect(parsed?.notes).toHaveLength(1);
      expect(parsed?.notes?.[0].color).toBe('yellow');
    });
  });

  it('toggles sticky notes visibility via toolbar toggle', async () => {
    await renderInEditMode(DEMO, 'Alice');

    const notesInfo = screen.getByTestId('mock-notes-info');
    expect(notesInfo.getAttribute('data-show')).toBe('true');

    // Click toggle
    const toggleBtn = screen.getByTestId('toggle-sticky-notes');
    fireEvent.click(toggleBtn);
    expect(notesInfo.getAttribute('data-show')).toBe('false');

    // Click toggle again
    fireEvent.click(toggleBtn);
    expect(notesInfo.getAttribute('data-show')).toBe('true');
  });

  it('updates and deletes a sticky note with undo/redo support', async () => {
    const viewer = await renderInEditMode(DEMO, 'Alice');

    // 1. Add note
    fireEvent.click(screen.getByTestId('add-sticky-note'));
    await screen.findByTestId('mock-update-first-note');

    // 2. Update note text
    fireEvent.click(screen.getByTestId('mock-update-first-note'));
    await waitFor(() => {
      const parsed = parseViewsData(viewer.getAttribute('data-code') ?? '');
      expect(parsed?.notes?.[0].text).toBe('Updated from test');
    });

    // 3. Undo reverts text edit
    const undoBtn = screen.getByTitle('Undo (Ctrl+Z)');
    fireEvent.click(undoBtn);
    await waitFor(() => {
      const parsed = parseViewsData(viewer.getAttribute('data-code') ?? '');
      expect(parsed?.notes?.[0].text).toBe('');
    });

    // 4. Redo restores text edit
    const redoBtn = screen.getByTitle('Redo (Ctrl+Y)');
    fireEvent.click(redoBtn);
    await waitFor(() => {
      const parsed = parseViewsData(viewer.getAttribute('data-code') ?? '');
      expect(parsed?.notes?.[0].text).toBe('Updated from test');
    });

    // 5. Delete note
    fireEvent.click(screen.getByTestId('mock-delete-first-note'));
    await waitFor(() => {
      const parsed = parseViewsData(viewer.getAttribute('data-code') ?? '');
      expect(parsed?.notes ?? []).toHaveLength(0);
    });
  });

  it('selects animation style and base color from bottom bar for selected arrow', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    // Expand bottom bar
    const bar = screen.getByTestId('bottom-animated-arrow-bar');
    fireEvent.click(within(bar).getByTestId('toggle-animated-arrows-bar'));

    // Select cyber animation and teal color within the bottom bar
    const cyberBtn = await within(bar).findByTestId('select-animation-cyber');
    fireEvent.click(cyberBtn);
    fireEvent.click(within(bar).getByTestId('color-positive-teal'));

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows).toEqual([
        { from: 'A', to: 'B', label: 'Hello', animation: 'cyber', color: '#00f0ff' },
      ]);
    }, { timeout: 3000 });
  }, 20000);

  it('inherits default green color when selecting a rich happy path arrow', async () => {
    localStorage.clear();
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    // Expand bottom bar
    const bar = screen.getByTestId('bottom-animated-arrow-bar');
    fireEvent.click(within(bar).getByTestId('toggle-animated-arrows-bar'));

    // Select flow animation (happy path)
    const flowBtn = await within(bar).findByTestId('select-animation-flow');
    fireEvent.click(flowBtn);

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows).toEqual([
        { from: 'A', to: 'B', label: 'Hello', animation: 'flow', color: '#00ff9d' },
      ]);
    }, { timeout: 3000 });
  }, 20000);

  it('inherits default red color when selecting a rich negative path arrow', async () => {
    localStorage.clear();
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    // Expand bottom bar
    const bar = screen.getByTestId('bottom-animated-arrow-bar');
    fireEvent.click(within(bar).getByTestId('toggle-animated-arrows-bar'));

    // Select broken-sender animation (negative path)
    const brokenSenderBtn = await within(bar).findByTestId('select-animation-broken-sender');
    fireEvent.click(brokenSenderBtn);

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows).toEqual([
        { from: 'A', to: 'B', label: 'Hello', animation: 'broken-sender', color: '#ff2a85' },
      ]);
    }, { timeout: 3000 });
  }, 20000);

  it('inherits last used color for subsequent arrows and preserves color when switching style', async () => {
    localStorage.clear();
    const TWO_MSGS = `sequenceDiagram
    participant A
    participant B
    A->>B: First
    B->>A: Second`;
    const viewer = await renderInEditMode(TWO_MSGS, 'A->>B: First');

    // Select first message
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('First');

    const bar = screen.getByTestId('bottom-animated-arrow-bar');
    fireEvent.click(within(bar).getByTestId('toggle-animated-arrows-bar'));

    // Select flow animation and set color to teal (#00f0ff)
    fireEvent.click(await within(bar).findByTestId('select-animation-flow'));
    fireEvent.click(within(bar).getByTestId('color-positive-teal'));

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows?.find(a => a.label === 'First')?.color).toBe('#00f0ff');
    }, { timeout: 3000 });

    // Switch style on first message to cyber: it should PRESERVE the existing color (#00f0ff)
    fireEvent.click(within(bar).getByTestId('select-animation-cyber'));
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows?.find(a => a.label === 'First')).toMatchObject({
        animation: 'cyber',
        color: '#00f0ff',
      });
    }, { timeout: 3000 });

    // Now select second message (plain non-animated arrow)
    fireEvent.click(screen.getByTestId('select-m:1'));
    await screen.findByDisplayValue('Second');

    // Select cyber animation: should INHERIT the last used positive color (#00f0ff)
    fireEvent.click(within(bar).getByTestId('select-animation-cyber'));
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows?.find(a => a.label === 'Second')).toMatchObject({
        animation: 'cyber',
        color: '#00f0ff',
      });
    }, { timeout: 3000 });
  }, 25000);

  it('converts entire diagram to animated arrows via bottom bar Convert button', async () => {
    const DEMO_ERR = `sequenceDiagram
    participant A
    participant B
    A->>B: Request
    B-x A: Error occurred`;
    const viewer = await renderInEditMode(DEMO_ERR, 'A->>B: Request');

    fireEvent.click(screen.getByTestId('convert-diagram-bar-btn'));

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      const parsed = parseViewsData(code);
      expect(parsed?.arrows).toHaveLength(2);
      // Happy path request has positive animation/color
      expect(parsed?.arrows?.[0]).toMatchObject({
        from: 'A',
        to: 'B',
        label: 'Request',
        animation: 'flow',
        color: '#00ff9d',
      });
      // Error arrow has broken-receiver animation and error color
      expect(parsed?.arrows?.[1]).toMatchObject({
        from: 'B',
        to: 'A',
        label: 'Error occurred',
        animation: 'broken-receiver',
        color: '#ff2a85',
      });
    }, { timeout: 3000 });
  });

  it('toggles between Properties tab and Mermaid Source tab', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    expect(screen.getByTestId('tab-properties')).toBeTruthy();
    expect(screen.getByTestId('tab-source')).toBeTruthy();

    // Default is Properties tab
    expect(screen.queryByTestId('source-code-panel')).toBeNull();

    // Switch to Mermaid Source tab
    fireEvent.click(screen.getByTestId('tab-source'));
    expect(screen.getByTestId('source-code-panel')).toBeTruthy();
    expect(screen.getByTestId('code-mode-badge').textContent).toContain('Read-only (Visual Mode)');

    // Switch back to Properties tab
    fireEvent.click(screen.getByTestId('tab-properties'));
    expect(screen.queryByTestId('source-code-panel')).toBeNull();
  });

  it('locks visual editing when entering code mode and unlocks on return to visual mode', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('tab-source'));
    expect(screen.queryByTestId('visual-locked-banner')).toBeNull();

    // Switch to code mode
    fireEvent.click(screen.getByTestId('switch-to-code-mode'));
    expect(screen.getByTestId('code-mode-badge').textContent).toContain('Code Hand-Editing');
    expect(screen.getByTestId('visual-locked-banner')).toBeTruthy();

    // Visual buttons are disabled
    const lockedBtns = screen.getAllByTitle('Locked while editing source code');
    expect(lockedBtns.length).toBeGreaterThan(0);
    lockedBtns.forEach(btn => expect(btn).toHaveProperty('disabled', true));

    // Switch back to visual mode
    fireEvent.click(screen.getByTestId('switch-to-visual-mode'));
    expect(screen.queryByTestId('visual-locked-banner')).toBeNull();
    expect(screen.getByTestId('code-mode-badge').textContent).toContain('Read-only (Visual Mode)');
  });

  it('editing code by hand updates diagram and auto-saves', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('tab-source'));
    fireEvent.click(screen.getByTestId('switch-to-code-mode'));

    const newCode = `sequenceDiagram
    participant A
    participant C
    A->>C: Direct message`;

    const textarea = screen.getByTestId('monaco-editor-textarea');
    fireEvent.change(textarea, { target: { value: newCode } });

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('Direct message');
    }, { timeout: 3000 });

    // Changed lines counter is displayed in code mode as well
    const counter = screen.getByTestId('changed-lines-counter');
    expect(counter).toBeTruthy();
    expect(counter.textContent).toContain('changed');
  });

  it('invalid syntax shows error banner and keeps previous valid diagram rendered', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    fireEvent.click(screen.getByTestId('tab-source'));
    fireEvent.click(screen.getByTestId('switch-to-code-mode'));

    const textarea = screen.getByTestId('monaco-editor-textarea');
    fireEvent.change(textarea, { target: { value: 'invalid syntax not mermaid at all' } });

    await waitFor(() => {
      expect(screen.getByTestId('code-validation-error')).toBeTruthy();
      // Diagram canvas still contains the old valid code
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).toContain('A->>B: Hello');
    }, { timeout: 3000 });
  });

  it('making a visual edit updates changed lines counter in source panel', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');

    // Add Participant via visual button
    fireEvent.click(screen.getByTitle('Add Participant'));

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('participant New1 as New Participant');
    });

    // Switch to Source panel
    fireEvent.click(screen.getByTestId('tab-source'));
    await waitFor(() => {
      const counter = screen.getByTestId('changed-lines-counter');
      expect(counter).toBeTruthy();
      expect(counter.textContent).toContain('changed');
    });
  });

  it('toggles split view to show both Properties and Mermaid Source side-by-side', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    expect(screen.queryByTestId('source-code-panel')).toBeNull();

    // Toggle split view
    fireEvent.click(screen.getByTestId('toggle-split-view'));

    // Both panels are visible simultaneously
    expect(screen.getByTestId('source-code-panel')).toBeTruthy();
    expect(screen.getByText('Click an element in the diagram to edit it.')).toBeTruthy();
  });

  describe('sidebar resize handle', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });
    afterEach(() => {
      window.localStorage.clear();
    });

    it('resizes the sidebar by dragging the handle on its left edge and persists the width', async () => {
      await renderInEditMode(DEMO, 'A->>B: Hello');

      const sidebar = screen.getByTestId('editor-sidebar');
      // default single-tab width (w-80)
      expect(sidebar.style.width).toBe('320px');

      const handle = screen.getByTestId('sidebar-resize-handle');
      // drag the handle 100px to the left -> sidebar grows by 100px
      fireEvent.mouseDown(handle, { clientX: 1000 });
      fireEvent.mouseMove(window, { clientX: 900 });
      fireEvent.mouseUp(window);

      expect(sidebar.style.width).toBe('420px');
      expect(window.localStorage.getItem('mermaid_sidebar_width')).toBe('420');
    });

    it('clamps the sidebar width to a minimum and to the space left for the diagram', async () => {
      await renderInEditMode(DEMO, 'A->>B: Hello');

      const sidebar = screen.getByTestId('editor-sidebar');
      const handle = screen.getByTestId('sidebar-resize-handle');
      // jsdom window.innerWidth is 1024, so the max width is 1024 - 320 = 704

      // drag far right -> clamped to the 240px minimum
      fireEvent.mouseDown(handle, { clientX: 1000 });
      fireEvent.mouseMove(window, { clientX: 2000 });
      fireEvent.mouseUp(window);
      expect(sidebar.style.width).toBe('240px');

      // drag far left -> clamped to the max (diagram keeps at least 320px)
      fireEvent.mouseDown(handle, { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: -500 });
      fireEvent.mouseUp(window);
      expect(sidebar.style.width).toBe('704px');
    });

    it('resizes the split view sidebar independently and remembers each mode’s width', async () => {
      await renderInEditMode(DEMO, 'A->>B: Hello');

      fireEvent.click(screen.getByTestId('toggle-split-view'));

      const sidebar = screen.getByTestId('editor-sidebar');
      // default split-view width (w-[640px])
      expect(sidebar.style.width).toBe('640px');

      // drag the handle 100px to the right -> split sidebar shrinks by 100px
      const handle = screen.getByTestId('sidebar-resize-handle');
      fireEvent.mouseDown(handle, { clientX: 1000 });
      fireEvent.mouseMove(window, { clientX: 1100 });
      fireEvent.mouseUp(window);

      expect(sidebar.style.width).toBe('540px');
      expect(window.localStorage.getItem('mermaid_sidebar_split_width')).toBe('540');
      // the single-tab width is untouched
      expect(window.localStorage.getItem('mermaid_sidebar_width')).toBeNull();

      // toggling back to single-tab restores its own width
      fireEvent.click(screen.getByTestId('toggle-split-view'));
      expect(sidebar.style.width).toBe('320px');
    });

    it('restores a persisted sidebar width on load', async () => {
      window.localStorage.setItem('mermaid_sidebar_width', '500');
      await renderInEditMode(DEMO, 'A->>B: Hello');

      expect(screen.getByTestId('editor-sidebar').style.width).toBe('500px');
    });
  });

  it('Export to SVG button exports SVG with download link and embedded visuals', async () => {
    await renderInEditMode(DEMO, 'A->>B: Hello');

    const exportBtn = screen.getByTestId('export-svg-btn');
    expect(exportBtn).toBeTruthy();

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL');

    fireEvent.click(exportBtn);

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    const content = await blob.text();
    expect(content).toContain('@keyframes mermaid-arrow-packet');
    expect(content).toContain('.arrow-anim-packet-runner');
    expect(content).toContain('diagram-export-bg');
  });

  it('toggles diagram orientation via toolbar button', async () => {
    const FLOW_DEMO = `flowchart TD\n    A[Alice] --> B[Bob]`;
    const viewer = await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');
    expect(viewer.getAttribute('data-code')).toContain('flowchart TD');

    const toggleBtn = screen.getByTestId('toggle-orientation');
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('flowchart LR');
    });

    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('flowchart TD');
    });
  });

  it('toggles numbered steps in sequence diagram via toolbar button', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    expect(viewer.getAttribute('data-code')).not.toContain('autonumber');

    const toggleBtn = screen.getByTestId('toggle-numbered-steps');
    expect(screen.queryByTestId('toggle-orientation')).toBeNull();
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('autonumber');
    });

    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('autonumber');
    });
  });

  it('toggles participant type between participant and actor', async () => {
    const viewer = await renderInEditMode(DEMO, 'participant A as Alice');
    expect(viewer.getAttribute('data-code')).toContain('participant A as Alice');

    // Select participant A
    fireEvent.click(screen.getByTestId('select-p:0'));

    const kindSelect = await screen.findByTestId('participant-kind-select');
    expect((kindSelect as HTMLSelectElement).value).toBe('participant');

    fireEvent.change(kindSelect, { target: { value: 'actor' } });

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('actor A as Alice');
    });
  });

  it('toggles participant type to database and queue in sequence diagram', async () => {
    const viewer = await renderInEditMode(DEMO, 'participant A as Alice');
    expect(viewer.getAttribute('data-code')).toContain('participant A as Alice');

    // Select participant A
    fireEvent.click(screen.getByTestId('select-p:0'));

    const kindSelect = await screen.findByTestId('participant-kind-select');
    expect((kindSelect as HTMLSelectElement).value).toBe('participant');

    fireEvent.change(kindSelect, { target: { value: 'database' } });

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('participant A as Alice @{ type: "database" }');
    });

    fireEvent.change(kindSelect, { target: { value: 'queue' } });

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('participant A as Alice @{ type: "queue" }');
    });
  });

  it('changes flowchart node type to database (cylinder) and if/else (rhombus)', async () => {
    const FLOW_DEMO = `flowchart TD\n    A[Alice] --> B[Bob]`;
    const viewer = await renderInEditMode(FLOW_DEMO, 'A[Alice] --> B[Bob]');
    expect(viewer.getAttribute('data-code')).toContain('A[Alice]');

    // Select node A
    fireEvent.click(screen.getByTestId('select-n:0'));

    const typeSelect = await screen.findByTestId('participant-kind-select');
    expect((typeSelect as HTMLSelectElement).value).toBe('rect');

    fireEvent.change(typeSelect, { target: { value: 'cylinder' } });

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A[(Alice)] --> B[Bob]');
    });

    fireEvent.change(typeSelect, { target: { value: 'rhombus' } });

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A{Alice} --> B[Bob]');
    });
  });

  it('toggles message activation for receiver and sender', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');

    // Select message m:0
    fireEvent.click(screen.getByTestId('select-m:0'));

    const activateTarget = await screen.findByTestId('activate-target-checkbox');
    fireEvent.click(activateTarget);

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('A->>+B: Hello');
    });

    const deactivateSource = screen.getByTestId('deactivate-source-checkbox');
    fireEvent.click(deactivateSource);

    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).toContain('deactivate A');
    });
  });

  it('groups multiple participants into a box block', async () => {
    const viewer = await renderInEditMode(DEMO, 'participant A as Alice');

    // Shift-click participant A (p:0) then B (p:1)
    fireEvent.click(screen.getByTestId('select-p:0'), { shiftKey: true });
    fireEvent.click(screen.getByTestId('select-p:1'), { shiftKey: true });

    const groupBoxBtn = await screen.findByTestId('group-box-button');
    const titleInput = screen.getByTestId('group-box-title');
    fireEvent.change(titleInput, { target: { value: 'Auth Services' } });

    fireEvent.click(groupBoxBtn);

    await waitFor(() => {
      const code = viewer.getAttribute('data-code') || '';
      expect(code).toContain('box Auth Services');
      expect(code).toContain('end');
    });
  });

  it('when a view is selected, copying mermaid copies the view and source code displays the view in read-only mode with explanation', async () => {
    const codeWithView = `%% CONFIG: {"version":1,"views":[{"name":"Checkout View","hiddenPaths":["flow=internal"]}]}
sequenceDiagram
    participant A as Alice
    participant B as Bob
%% @region-start: flow=internal
    A->>B: Secret Internal
%% @region-end
    A->>B: Public Checkout`;

    await renderInEditMode(codeWithView, 'A->>B: Public Checkout');
    (navigator.clipboard.writeText as import('vitest').Mock).mockClear();

    // Load view "Checkout View"
    const loadBtn = screen.getByTestId('load-view-btn-Checkout View');
    fireEvent.click(loadBtn);

    // Active view banner is displayed explaining the mode to the user
    const banner = await screen.findByTestId('active-view-banner');
    expect(banner.textContent).toContain('Checkout View');
    expect(banner.textContent).toContain('source code is read-only and copying the Mermaid will copy this view');

    // Active badge in saved views list
    expect(screen.getByTestId('active-view-badge').textContent).toBe('Active');

    // Copying mermaid from toolbar copies the view code (without hidden region)
    const copyBtn = screen.getByTestId('copy-mermaid');
    expect(copyBtn.getAttribute('title')).toContain('Checkout View');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copiedCode = (navigator.clipboard.writeText as import('vitest').Mock).mock.calls[0][0];
    expect(copiedCode).toContain('A->>B: Public Checkout');
    expect(copiedCode).not.toContain('Secret Internal');
    expect(copiedCode).not.toContain('%% @region-start');

    // Switch to Mermaid Source tab to verify SourceCodePanel behavior
    fireEvent.click(screen.getByTestId('tab-source'));

    // Source panel displays notice banner explaining the mode
    const sourceNotice = await screen.findByTestId('view-source-notice');
    expect(sourceNotice.textContent).toContain('Displaying view "Checkout View". The source code is read-only. Copying will copy this view.');

    // Source panel badge indicates read-only view mode
    expect(screen.getByTestId('code-mode-badge').textContent).toContain('Read-only (View: Checkout View)');

    // Textarea displays the view code and is read-only
    const textarea = screen.getByTestId('monaco-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('A->>B: Public Checkout');
    expect(textarea.value).not.toContain('Secret Internal');
    expect(textarea.readOnly).toBe(true);

    // Copying from source panel also copies the view code
    (navigator.clipboard.writeText as import('vitest').Mock).mockClear();
    fireEvent.click(screen.getByTestId('source-panel-copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect((navigator.clipboard.writeText as import('vitest').Mock).mock.calls[0][0]).not.toContain('Secret Internal');

    // Resetting to full diagram exits view mode
    fireEvent.click(screen.getByTestId('exit-view-banner-btn'));
    expect(screen.queryByTestId('active-view-banner')).toBeNull();
    expect(screen.queryByTestId('view-source-notice')).toBeNull();

    // Source code returns to raw code (contains Secret Internal)
    expect((screen.getByTestId('monaco-editor-textarea') as HTMLTextAreaElement).value).toContain('Secret Internal');
  });

  describe('markdown embedded diagrams', () => {
    const BLOCK0 = 'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: First diagram';
    const BLOCK1 = '%% CONFIG: {"version":1,"actors":{"A":{"color":"#e11d48"}}}\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Second diagram';

    const mockMarkdownFetch = (opts?: {
      diagrams?: Array<{ index: number; title: string; startLine: number; endLine: number }>;
      jobStatus?: 'done' | 'failed';
      jobCode?: string;
      jobError?: string;
    }) => {
      const mockFetch = global.fetch as import('vitest').Mock;
      const saveBodies: Array<Record<string, unknown>> = [];
      mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (init?.method === 'POST' && u.startsWith('/api/markdown/save')) {
          saveBodies.push(JSON.parse(init.body ?? '{}'));
          return { ok: true, status: 202, json: async () => ({ jobId: 'job_test_1' }) };
        }
        if (u.startsWith('/api/jobs/')) {
          if (opts?.jobStatus === 'failed') {
            return {
              ok: true,
              json: async () => ({ id: 'job_test_1', status: 'failed', code: opts.jobCode ?? 'conflict', error: opts.jobError ?? 'changed on disk' }),
            };
          }
          return { ok: true, json: async () => ({ id: 'job_test_1', status: 'done' }) };
        }
        if (u.startsWith('/api/markdown/diagrams')) {
          return {
            ok: true,
            json: async () => ({
              file: 'notes.md',
              diagrams: opts?.diagrams ?? [
                { index: 0, title: 'sequenceDiagram', startLine: 5, endLine: 9 },
                { index: 1, title: 'sequenceDiagram', startLine: 15, endLine: 20 },
              ],
            }),
          };
        }
        if (u.startsWith('/api/markdown/diagram?')) {
          const index = Number(new URL(`http://test${u}`).searchParams.get('index'));
          return { ok: true, json: async () => ({ file: 'notes.md', index, content: index === 1 ? BLOCK1 : BLOCK0 }) };
        }
        if (u.startsWith('/api/files')) {
          return { ok: true, json: async () => ({ files: ['demo.mmd'], markdownFiles: ['notes.md'] }) };
        }
        if (u.startsWith('/api/file/')) {
          return { ok: true, json: async () => ({ content: '' }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      return { saveBodies };
    };

    it('lists markdown files with their embedded diagrams in the Files menu', async () => {
      mockParams({ file: 'demo.mmd' });
      mockMarkdownFetch();
      render(<ClientPage />);

      // .mmd files are still listed
      expect(await screen.findByText('demo.mmd')).toBeTruthy();
      // the markdown file is a parent row with an MD badge
      const mdFile = await screen.findByTestId('md-file-notes.md');
      expect(mdFile.textContent).toContain('notes.md');
      expect(screen.getByTestId('md-badge-notes.md').textContent).toBe('MD');
      // its diagrams are nested children, clearly marked as md diagrams
      const d0 = await screen.findByTestId('md-diagram-notes.md-0');
      const d1 = await screen.findByTestId('md-diagram-notes.md-1');
      expect(d0.textContent).toContain('Diagram 1');
      expect(d1.textContent).toContain('Diagram 2');
      expect(d0.textContent).toContain('sequenceDiagram');
    });

    it('marks markdown files without mermaid diagrams in the menu', async () => {
      mockParams({ file: 'demo.mmd' });
      mockMarkdownFetch({ diagrams: [] });
      render(<ClientPage />);

      await screen.findByTestId('md-file-notes.md');
      expect(await screen.findByText('no mermaid diagrams')).toBeTruthy();
      expect(screen.queryByTestId('md-diagram-notes.md-0')).toBeNull();
    });

    it('opens an embedded diagram and loads only its block content (config line included)', async () => {
      mockParams({ file: 'notes.md', diagram: '1' });
      mockMarkdownFetch();
      render(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('A->>B: Second diagram');
      }, { timeout: 3000 });
      // the config comment is part of the loaded diagram
      expect(viewer.getAttribute('data-code')).toContain('%% CONFIG:');
      // the raw markdown file itself is never loaded into the editor
      const mockFetch = global.fetch as import('vitest').Mock;
      expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/markdown/diagram?'))).toBe(true);
      expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/file/notes.md'))).toBe(false);
      // the toolbar badge marks it as an md-embedded diagram
      const badge = await screen.findByTestId('embedded-diagram-badge');
      expect(badge.textContent).toContain('notes.md');
      expect(badge.textContent).toContain('Diagram 2');

      // clicking a child sets file + diagram params
      mockReplace.mockClear();
      fireEvent.click(screen.getByTestId('md-diagram-notes.md-0'));
      await waitFor(() => {
        const url = mockReplace.mock.calls.at(-1)?.[0] as string;
        expect(url).toContain('file=notes.md');
        expect(url).toContain('diagram=0');
      });
    });

    // A markdown file selected without a diagram opens the whole document in
    // the rich markdown editor: GET /api/file/<name> returns the full content,
    // and POST /api/file/<name> writes it back (whole-file save).
    const MD_DOC = [
      '# Notes',
      '',
      'Some prose.',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    A->>B: First',
      '```',
      '',
    ].join('\n');

    const mockMarkdownDocFetch = (doc: string) => {
      const mockFetch = global.fetch as import('vitest').Mock;
      const filePosts: string[] = [];
      mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (init?.method === 'POST' && u.startsWith('/api/file/notes.md')) {
          filePosts.push(JSON.parse(init.body ?? '{}').content ?? '');
          return { ok: true, json: async () => ({}) };
        }
        if (u.startsWith('/api/markdown/diagrams')) {
          return {
            ok: true,
            json: async () => ({
              file: 'notes.md',
              diagrams: [{ index: 0, title: 'sequenceDiagram', startLine: 5, endLine: 7 }],
            }),
          };
        }
        if (u.startsWith('/api/files')) {
          return { ok: true, json: async () => ({ files: ['demo.mmd'], markdownFiles: ['notes.md'] }) };
        }
        if (u.startsWith('/api/file/notes.md')) {
          return { ok: true, json: async () => ({ content: doc }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      return { filePosts };
    };

    it('opens a markdown file in the rich markdown editor (whole document loaded)', async () => {
      mockParams({ file: 'notes.md' });
      mockMarkdownDocFetch(MD_DOC);
      render(<ClientPage />);

      const editor = await screen.findByTestId('markdown-editor');
      await waitFor(() => {
        expect(editor.getAttribute('data-code')).toBe(MD_DOC);
      });
      expect(editor.getAttribute('data-file')).toBe('notes.md');
      expect(screen.queryByTestId('diagram-viewer')).toBeNull();
      // the whole file is loaded; no embedded diagram block is fetched
      const mockFetch = global.fetch as import('vitest').Mock;
      expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/file/notes.md'))).toBe(true);
      expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/markdown/diagram?'))).toBe(false);
      // the toolbar shows the markdown file badge instead of the diagram search
      expect(screen.getByTestId('markdown-file-badge').textContent).toContain('notes.md');
      expect(screen.queryByPlaceholderText('Search diagram...')).toBeNull();
    });

    // The markdown preview's per-block view/tag controls keep their state in
    // the URL (mdview.<i> / mdhide.<i> params) and report changes through
    // onViewStateChange, which ClientPage writes back to the URL.
    it('passes per-block view state from the URL (mdview.N/mdhide.N) to the markdown editor', async () => {
      mockParams({ file: 'notes.md', 'mdview.0': 'Backend only', 'mdhide.1': 'critical' });
      mockMarkdownDocFetch(MD_DOC);
      render(<ClientPage />);

      const editor = await screen.findByTestId('markdown-editor');
      await waitFor(() => {
        const states = JSON.parse(editor.getAttribute('data-viewstates') ?? 'null');
        expect(states).toEqual({
          0: { viewName: 'Backend only', hideKeys: [] },
          1: { viewName: null, hideKeys: ['critical'] },
        });
      });
    });

    it('writes per-block view state changes back to the URL', async () => {
      mockParams({ file: 'notes.md' });
      mockMarkdownDocFetch(MD_DOC);
      render(<ClientPage />);

      const editor = await screen.findByTestId('markdown-editor');
      await waitFor(() => {
        expect(editor.getAttribute('data-code')).toBe(MD_DOC);
      });

      mockReplace.mockClear();
      fireEvent.click(screen.getByTestId('markdown-viewstate-0'));
      await waitFor(() => {
        const url = mockReplace.mock.calls.at(-1)?.[0] as string;
        const params = new URLSearchParams(url.split('?')[1]);
        expect(params.get('mdhide.0')).toBe('backend');
        expect(params.get('mdview.0')).toBeNull();
        expect(params.get('file')).toBe('notes.md');
      });
    });

    it('auto-saves markdown edits to the .md file (whole-file POST)', async () => {
      mockParams({ file: 'notes.md' });
      const { filePosts } = mockMarkdownDocFetch(MD_DOC);
      render(<ClientPage />);

      const editor = await screen.findByTestId('markdown-editor');
      await waitFor(() => {
        expect(editor.getAttribute('data-code')).toBe(MD_DOC);
      });

      const edited = `${MD_DOC}More prose.\n`;
      fireEvent.change(screen.getByTestId('markdown-editor-source'), { target: { value: edited } });

      // the debounced auto-save writes the whole markdown file
      await waitFor(() => {
        expect(filePosts.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
      expect(filePosts[0]).toBe(edited);
      await waitFor(() => {
        expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
      }, { timeout: 5000 });
    }, 10000);

    it('selecting a diagram in the markdown editor opens that diagram for editing', async () => {
      mockParams({ file: 'notes.md' });
      mockMarkdownDocFetch(MD_DOC);
      render(<ClientPage />);

      await screen.findByTestId('markdown-editor');
      mockReplace.mockClear();
      fireEvent.click(screen.getByTestId('markdown-select-diagram-1'));
      await waitFor(() => {
        const url = mockReplace.mock.calls.at(-1)?.[0] as string;
        expect(url).toContain('file=notes.md');
        expect(url).toContain('diagram=1');
      });
    });

    it('switching from a markdown document to an embedded diagram never passes markdown prose to DiagramViewer', async () => {
      mockParams({ file: 'notes.md' });
      mockMarkdownDocFetch(MD_DOC);
      const mockFetch = global.fetch as import('vitest').Mock;
      const origImpl = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (u.startsWith('/api/markdown/diagram?')) {
          return { ok: true, json: async () => ({ file: 'notes.md', index: 0, content: BLOCK0 }) };
        }
        return origImpl(url, init);
      });

      const { rerender } = render(<ClientPage />);
      await screen.findByTestId('markdown-editor');

      mockParams({ file: 'notes.md', diagram: '0' });
      rerender(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      expect(viewer.getAttribute('data-code')).not.toContain('# Notes');
      expect(viewer.getAttribute('data-code')).not.toContain('Some prose');

      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('A->>B: First diagram');
      });
    });

    it('clicking a markdown file clears the diagram param', async () => {
      mockParams({ file: 'notes.md', diagram: '1' });
      mockMarkdownFetch();
      render(<ClientPage />);
      await screen.findByTestId('diagram-viewer');

      mockReplace.mockClear();
      fireEvent.click(screen.getByTestId('md-file-notes.md'));
      await waitFor(() => {
        const url = mockReplace.mock.calls.at(-1)?.[0] as string;
        expect(url).toContain('file=notes.md');
        expect(url).not.toContain('diagram=');
      });
    });

    it('saves an edit to an embedded diagram through the background job queue', async () => {
      mockParams({ file: 'notes.md', diagram: '1' });
      const { saveBodies } = mockMarkdownFetch();
      render(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('A->>B: Second diagram');
      }, { timeout: 3000 });

      fireEvent.click(screen.getByTestId('select-m:0'));
      const input = await screen.findByDisplayValue('Second diagram');
      fireEvent.change(input, { target: { value: 'Edited label' } });

      // the debounced auto-save enqueues a background job (POST /api/markdown/save)
      await waitFor(() => {
        expect(saveBodies.length).toBeGreaterThan(0);
      }, { timeout: 3000 });
      const body = saveBodies[0];
      expect(body.file).toBe('notes.md');
      expect(body.index).toBe(1);
      // the full diagram is stored, config comment first
      expect(String(body.content).startsWith('%% CONFIG:')).toBe(true);
      expect(body.content).toContain('A->>B: Edited label');
      expect(body.content).not.toContain('Second diagram');
      // compare-and-swap base: the originally loaded block content
      expect(body.expectedContent).toBe(BLOCK1);

      // the job status was polled and the save reported as saved
      const mockFetch = global.fetch as import('vitest').Mock;
      await waitFor(() => {
        expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('/api/jobs/'))).toBe(true);
      });
      await waitFor(() => {
        expect(screen.getByTestId('save-indicator').textContent).toBe('Saved');
      }, { timeout: 3000 });

      // the markdown file itself is never POSTed directly
      expect(
        mockFetch.mock.calls.some(c =>
          String(c[0]).startsWith('/api/file/notes.md') && (c[1] as { method?: string } | undefined)?.method === 'POST'
        )
      ).toBe(false);
    }, 10000);

    it('shows a conflict notice when the save job reports the diagram changed on disk', async () => {
      mockParams({ file: 'notes.md', diagram: '1' });
      mockMarkdownFetch({ jobStatus: 'failed', jobCode: 'conflict', jobError: 'changed on disk' });
      render(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('A->>B: Second diagram');
      }, { timeout: 3000 });

      fireEvent.click(screen.getByTestId('select-m:0'));
      const input = await screen.findByDisplayValue('Second diagram');
      fireEvent.change(input, { target: { value: 'Edited label' } });

      await waitFor(() => {
        expect(screen.getByTestId('save-indicator').textContent).toBe('Save failed');
      }, { timeout: 3000 });
      const conflict = await screen.findByTestId('save-conflict');
      expect(conflict.textContent).toContain('changed on disk');
    }, 10000);

    // A stateful fake disk that behaves like the real API routes: whole-file
    // GET/POST, embedded-diagram GET, and the background save job (run through
    // the real runMarkdownSaveJob so the compare-and-swap + splice logic is
    // the production one).
    const NOTES_MD = [
      '# Notes',
      '',
      'Intro prose that must survive.',
      '',
      '```mermaid',
      BLOCK0,
      '```',
      '',
      'Middle prose.',
      '',
      '```mermaid',
      BLOCK1,
      '```',
      '',
      'Trailing prose.',
      '',
    ].join('\n');

    const mockMarkdownDisk = (initial: string, opts?: { failSaveJob?: string }) => {
      const disk = { content: initial };
      const jobs = new Map<string, { status: string; code?: string; error?: string }>();
      const mockFetch = global.fetch as import('vitest').Mock;
      mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url);
        if (init?.method === 'POST' && u.startsWith('/api/file/notes.md')) {
          disk.content = JSON.parse(init.body ?? '{}').content ?? '';
          return { ok: true, json: async () => ({ success: true }) };
        }
        if (init?.method === 'POST' && u.startsWith('/api/markdown/save')) {
          const body = JSON.parse(init.body ?? '{}');
          const id = `job_${jobs.size + 1}`;
          if (opts?.failSaveJob) {
            jobs.set(id, { status: 'failed', code: 'verify-failed', error: opts.failSaveJob });
          } else {
            try {
              await runMarkdownSaveJob(
                { filePath: 'notes.md', index: body.index, content: body.content, expectedContent: body.expectedContent },
                { readFile: async () => disk.content, writeFileAtomic: async (_p, c) => { disk.content = c; } },
              );
              jobs.set(id, { status: 'done' });
            } catch (err) {
              jobs.set(id, { status: 'failed', code: (err as { code?: string }).code, error: (err as Error).message });
            }
          }
          return { ok: true, status: 202, json: async () => ({ jobId: id }) };
        }
        if (u.startsWith('/api/jobs/')) {
          const id = decodeURIComponent(u.slice('/api/jobs/'.length));
          return { ok: true, json: async () => ({ id, ...jobs.get(id) }) };
        }
        if (u.startsWith('/api/markdown/diagrams')) {
          return { ok: true, json: async () => ({ file: 'notes.md', diagrams: extractMermaidBlocks(disk.content).map(b => ({ index: b.index, title: b.title, startLine: b.startLine, endLine: b.endLine })) }) };
        }
        if (u.startsWith('/api/markdown/diagram?')) {
          const index = Number(new URL(`http://test${u}`).searchParams.get('index'));
          const block = extractMermaidBlocks(disk.content)[index];
          if (!block) return { ok: false, status: 404, json: async () => ({ error: 'Diagram index out of range' }) };
          return { ok: true, json: async () => ({ file: 'notes.md', index, content: block.content }) };
        }
        if (u.startsWith('/api/files')) {
          return { ok: true, json: async () => ({ files: [], markdownFiles: ['notes.md'] }) };
        }
        if (u.startsWith('/api/file/notes.md')) {
          return { ok: true, json: async () => ({ content: disk.content }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      return disk;
    };

    // Regression: saving a view on an embedded diagram POSTed the diagram
    // source to /api/file/notes.md, replacing the whole markdown document with
    // a single diagram. The corruption showed up when the document was opened.
    it('saving a view on an embedded diagram keeps the markdown file intact, then opening the document shows it', async () => {
      mockParams({ file: 'notes.md', diagram: '1' });
      const disk = mockMarkdownDisk(NOTES_MD);
      (window as unknown as { prompt: unknown }).prompt = vi.fn(() => 'My View');
      const { rerender } = render(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('A->>B: Second diagram');
      }, { timeout: 3000 });

      fireEvent.click(screen.getByTitle('Save Current View'));
      await waitFor(() => {
        expect(extractMermaidBlocks(disk.content)[1]?.content).toContain('"views"');
      }, { timeout: 5000 });

      // open the markdown document
      mockParams({ file: 'notes.md' });
      rerender(<ClientPage />);
      const editor = await screen.findByTestId('markdown-editor');
      await waitFor(() => {
        expect(editor.getAttribute('data-code')).toBe(disk.content);
      }, { timeout: 3000 });

      // the document on disk is intact: prose kept, both diagrams kept, only
      // block 1 gained the saved view
      expect(disk.content.startsWith('# Notes\n\nIntro prose that must survive.\n')).toBe(true);
      expect(disk.content).toContain('Middle prose.');
      expect(disk.content.endsWith('Trailing prose.\n')).toBe(true);
      const blocks = extractMermaidBlocks(disk.content);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].content).toBe(BLOCK0);
      expect(parseViewsData(blocks[1].content)?.views?.map(v => v.name)).toEqual(['My View']);
      // the markdown file was never overwritten wholesale
      const mockFetch = global.fetch as import('vitest').Mock;
      expect(mockFetch.mock.calls.some(c =>
        String(c[0]).startsWith('/api/file/notes.md') && (c[1] as { method?: string } | undefined)?.method === 'POST'
      )).toBe(false);
    }, 15000);

    it('deleting a view on an embedded diagram keeps the markdown file intact', async () => {
      const codeWithView = BLOCK1.replace(
        '{"version":1,"actors":{"A":{"color":"#e11d48"}}}',
        '{"version":1,"actors":{"A":{"color":"#e11d48"}},"views":[{"name":"To Delete","hiddenPaths":[]}]}',
      );
      const mdWithView = NOTES_MD.replace(BLOCK1, codeWithView);
      mockParams({ file: 'notes.md', diagram: '1' });
      const disk = mockMarkdownDisk(mdWithView);
      (window as unknown as { confirm: unknown }).confirm = vi.fn(() => true);
      render(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('To Delete');
      }, { timeout: 3000 });

      // Click delete view
      const deleteBtn = await screen.findByTestId('delete-view-btn-To Delete');
      fireEvent.click(deleteBtn);
      await waitFor(() => {
        expect(extractMermaidBlocks(disk.content)[1]?.content).not.toContain('To Delete');
      }, { timeout: 5000 });

      // Prose and other diagram are untouched
      expect(disk.content.startsWith('# Notes\n\nIntro prose that must survive.\n')).toBe(true);
      const blocks = extractMermaidBlocks(disk.content);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].content).toBe(BLOCK0);
    }, 15000);

    it('displays error message that contents aren\'t saved when verification fails', async () => {
      mockParams({ file: 'notes.md', diagram: '1' });
      mockMarkdownDisk(NOTES_MD, { failSaveJob: "Contents aren't saved: verification failed" });
      (window as unknown as { prompt: unknown }).prompt = vi.fn(() => 'My View');
      render(<ClientPage />);

      const viewer = await screen.findByTestId('diagram-viewer');
      await waitFor(() => {
        expect(viewer.getAttribute('data-code')).toContain('A->>B: Second diagram');
      }, { timeout: 3000 });

      fireEvent.click(screen.getByTitle('Save Current View'));
      await waitFor(() => {
        expect(screen.getByTestId('save-indicator').textContent).toBe('Save failed');
      }, { timeout: 5000 });

      const errorEl = await screen.findByTestId('save-error');
      expect(errorEl.textContent).toContain("Contents aren't saved");
    }, 15000);
  });
});



