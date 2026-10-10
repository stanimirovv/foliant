import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ClientPage from './ClientPage';
import { parseModel } from '@/lib/model';
import { parseViewsData } from '@/lib/views';
import { createSequenceDiagram } from '@/lib/editorTestHarness';

const mockReplace = vi.fn();
const mockGet = vi.fn();
const mockSearchParams = {
  get: mockGet,
  toString: () => 'dir=/old/dir'
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
// selection through onSelect (processed keys, like real clicks).
vi.mock('./DiagramViewer', () => ({
  __esModule: true,
  default: (props: {
    code: string;
    editMode?: boolean;
    selection?: string | null;
    onSelect?: (key: string | null) => void;
  }) => (
    <div
      data-testid="diagram-viewer"
      data-code={props.code}
      data-edit-mode={String(props.editMode ?? false)}
      data-selection={props.selection ?? ''}
    >
      {['p:0', 'p:1', 'p:2', 'm:0', 'm:1', 'm:2'].map(k => (
        <button key={k} data-testid={`select-${k}`} onClick={() => props.onSelect?.(k)}>
          select {k}
        </button>
      ))}
    </div>
  ),
}));

global.fetch = vi.fn();

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close() {}
}
(global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

const DEMO = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const mockFetchWithFile = (content: string) => {
  const mockFetch = global.fetch as import('vitest').Mock;
  mockFetch.mockImplementation(async (url: unknown) => ({
    json: async () => {
      if (String(url).startsWith('/api/file/')) return { content };
      return { files: ['demo.mmd'] };
    },
  }));
};

const mockParams = (params: Record<string, string>) => {
  mockGet.mockImplementation((key: string) => params[key] ?? null);
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

  it('edit toggle sets the edit URL param', async () => {
    mockParams({ file: 'demo.mmd' });
    mockFetchWithFile(DEMO);

    render(<ClientPage />);

    const button = await screen.findByTitle('Edit diagram');
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('edit=1'), { scroll: false });
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

  it('deleting a message asks for confirmation and removes it', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    fireEvent.click(screen.getByTestId('panel-delete'));
    const dialog = await screen.findByTestId('delete-dialog');
    expect(dialog.textContent).toContain('message A ->> B: Hello');
    expect(dialog.textContent).not.toContain('referencing');

    fireEvent.click(screen.getByTestId('confirm-delete'));
    await waitFor(() => {
      expect(viewer.getAttribute('data-code')).not.toContain('Hello');
    }, { timeout: 3000 });
    // the selection was cleared with the element
    await screen.findByText(/Click an element in the diagram/);
  });

  it('deleting a participant lists cascaded messages and removes them all', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-p:0'));
    await screen.findByDisplayValue('Alice');

    fireEvent.click(screen.getByTestId('panel-delete'));
    const dialog = await screen.findByTestId('delete-dialog');
    expect(dialog.textContent).toContain('participant A (Alice)');
    expect(dialog.textContent).toContain('2 referencing elements');
    expect(dialog.textContent).toContain('message A ->> B: Hello');
    expect(dialog.textContent).toContain('message B -->> A: Hi there');

    fireEvent.click(screen.getByTestId('confirm-delete'));
    await waitFor(() => {
      const code = viewer.getAttribute('data-code') ?? '';
      expect(code).not.toContain('participant A');
      expect(code).not.toContain('Hello');
      expect(code).not.toContain('Hi there');
      expect(code).toContain('participant B as Bob');
    }, { timeout: 3000 });
  });

  it('cancelling the delete dialog keeps the diagram unchanged', async () => {
    const viewer = await renderInEditMode(DEMO, 'A->>B: Hello');
    fireEvent.click(screen.getByTestId('select-m:0'));
    await screen.findByDisplayValue('Hello');

    fireEvent.click(screen.getByTestId('panel-delete'));
    await screen.findByTestId('delete-dialog');
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByTestId('delete-dialog')).toBeNull();
    expect(viewer.getAttribute('data-code')).toContain('A->>B: Hello');
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

    // delete a participant -> cascade confirm lists its messages -> gone after confirm.
    // A is colored, so transformActors regroups it into a box block injected
    // after the uncolored participants: the processed order is B, New1, A,
    // i.e. processed key p:2 is A.
    fireEvent.click(screen.getByTestId('select-p:2'));
    await screen.findByDisplayValue('Alice');
    fireEvent.click(screen.getByTestId('panel-delete'));
    const dialog = await screen.findByTestId('delete-dialog');
    expect(dialog.textContent).toContain('participant A (Alice)');
    expect(dialog.textContent).toContain('3 referencing elements');
    fireEvent.click(screen.getByTestId('confirm-delete'));
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
});
