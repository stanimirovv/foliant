import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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

// Stateful file mock: POST persists the body (like the real API) and GET
// returns the current content; postControl.fail simulates a failing write.
const fileContent = { current: '' };
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
  const mockFetch = global.fetch as import('vitest').Mock;
  mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      if (postControl.fail) return { ok: false, status: 500, json: async () => ({}) };
      fileContent.current = JSON.parse(init.body ?? '{}').content ?? '';
      return { ok: true, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => {
        if (String(url).startsWith('/api/file/')) return { content: fileContent.current };
        return { files: ['demo.mmd'] };
      },
    };
  });
};

const postCalls = () => {
  const mockFetch = global.fetch as import('vitest').Mock;
  return mockFetch.mock.calls.filter(c => (c[1] as { method?: string } | undefined)?.method === 'POST');
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
    fileContent.current = '';
    postControl.fail = false;
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
});
