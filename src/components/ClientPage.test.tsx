import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClientPage from './ClientPage';

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

vi.mock('@/lib/preprocessor', () => ({
  processMermaid: () => ({ code: 'processed', warnings: [] }),
  transformActors: () => 'transformed',
}));

vi.mock('@/lib/views', () => ({
  parseViewsData: () => ({ version: 1, actors: {}, views: [] }),
  updateViewsData: vi.fn(),
}));

vi.mock('./DiagramViewer', () => ({
  __esModule: true,
  default: () => <div data-testid="diagram-viewer" />
}));

global.fetch = vi.fn();

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close() {}
}
(global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

describe('ClientPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
