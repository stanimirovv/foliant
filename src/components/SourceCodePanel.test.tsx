import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import SourceCodePanel from './SourceCodePanel';

describe('SourceCodePanel', () => {
  afterEach(() => {
    cleanup();
  });

  const sampleCode = 'sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello';

  it('renders read-only in visual edit mode with badge', () => {
    const onSwitchToCodeMode = vi.fn();
    const onSwitchToVisualMode = vi.fn();
    const onCodeChange = vi.fn();

    const { getByTestId, queryByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={true}
        theme="default"
        onCodeChange={onCodeChange}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={onSwitchToVisualMode}
      />
    );

    expect(getByTestId('code-mode-badge').textContent).toContain('Read-only (Visual Mode)');
    const textarea = getByTestId('monaco-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    expect(getByTestId('switch-to-code-mode')).toBeTruthy();
    expect(queryByTestId('switch-to-visual-mode')).toBeNull();
  });

  it('clicking Edit Code button switches to code mode', () => {
    const onSwitchToCodeMode = vi.fn();
    const onSwitchToVisualMode = vi.fn();
    const onCodeChange = vi.fn();

    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={true}
        theme="default"
        onCodeChange={onCodeChange}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={onSwitchToVisualMode}
      />
    );

    fireEvent.click(getByTestId('switch-to-code-mode'));
    expect(onSwitchToCodeMode).toHaveBeenCalled();
  });

  it('clicking editor container in visual mode switches to code mode', () => {
    const onSwitchToCodeMode = vi.fn();
    const onSwitchToVisualMode = vi.fn();
    const onCodeChange = vi.fn();

    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={true}
        theme="default"
        onCodeChange={onCodeChange}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={onSwitchToVisualMode}
      />
    );

    fireEvent.click(getByTestId('monaco-editor-mock'));
    expect(onSwitchToCodeMode).toHaveBeenCalled();
  });

  it('renders editable in code hand-edit mode and dispatches onCodeChange', () => {
    const onSwitchToCodeMode = vi.fn();
    const onSwitchToVisualMode = vi.fn();
    const onCodeChange = vi.fn();

    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={false}
        theme="dark"
        onCodeChange={onCodeChange}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={onSwitchToVisualMode}
      />
    );

    expect(getByTestId('code-mode-badge').textContent).toContain('Code Hand-Editing');
    const textarea = getByTestId('monaco-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);

    fireEvent.change(textarea, { target: { value: 'sequenceDiagram\n    participant A' } });
    expect(onCodeChange).toHaveBeenCalledWith('sequenceDiagram\n    participant A');

    fireEvent.click(getByTestId('switch-to-visual-mode'));
    expect(onSwitchToVisualMode).toHaveBeenCalled();
  });

  it('displays validation error banner when validationError is provided', () => {
    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={false}
        theme="default"
        validationError="Parsing failed: unexpected token at line 3"
        onCodeChange={vi.fn()}
        onSwitchToCodeMode={vi.fn()}
        onSwitchToVisualMode={vi.fn()}
      />
    );

    const errorBanner = getByTestId('code-validation-error');
    expect(errorBanner).toBeTruthy();
    expect(errorBanner.textContent).toContain('Parsing failed: unexpected token at line 3');
  });

  it('displays changed lines counter badge when changedLines are present', () => {
    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={true}
        changedLines={[3, 4]}
        theme="default"
        onCodeChange={vi.fn()}
        onSwitchToCodeMode={vi.fn()}
        onSwitchToVisualMode={vi.fn()}
      />
    );

    const counter = getByTestId('changed-lines-counter');
    expect(counter.textContent).toContain('2 changed');
  });

  it('displays changed lines counter badge in code hand-edit mode as well', () => {
    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={false}
        changedLines={[2, 3, 4]}
        theme="dark"
        onCodeChange={vi.fn()}
        onSwitchToCodeMode={vi.fn()}
        onSwitchToVisualMode={vi.fn()}
      />
    );

    const counter = getByTestId('changed-lines-counter');
    expect(counter.textContent).toContain('3 changed');
  });

  it('handles copy button click', async () => {
    const onCopy = vi.fn();
    const { getByTestId } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={true}
        theme="default"
        onCodeChange={vi.fn()}
        onSwitchToCodeMode={vi.fn()}
        onSwitchToVisualMode={vi.fn()}
        onCopy={onCopy}
      />
    );

    fireEvent.click(getByTestId('source-panel-copy'));
    expect(onCopy).toHaveBeenCalled();
  });

  it('renders read-only view mode badge and disables switching to code mode when viewName is provided', () => {
    const onSwitchToCodeMode = vi.fn();

    const { getByTestId, queryByTestId } = render(
      <SourceCodePanel
        code="sequenceDiagram\n    A->>B: Only View"
        isVisualEditMode={true}
        theme="default"
        onCodeChange={vi.fn()}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={vi.fn()}
        viewName="Checkout Flow"
      />
    );

    // Badge indicates view mode
    expect(getByTestId('code-mode-badge').textContent).toContain('Read-only (View: Checkout Flow)');

    // Textarea is read-only
    const textarea = getByTestId('monaco-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);

    // No view-mode notice banner is rendered
    expect(queryByTestId('view-source-notice')).toBeNull();

    // Edit code button is replaced with view mode indicator
    expect(queryByTestId('switch-to-code-mode')).toBeNull();
    expect(getByTestId('view-mode-indicator')).toBeTruthy();

    // Clicking editor container does not switch to code mode
    fireEvent.click(getByTestId('monaco-editor-mock'));
    expect(onSwitchToCodeMode).not.toHaveBeenCalled();
  });

  it('does not call onCodeChange or onSwitchToCodeMode when transitioning into a read-only view after mount', () => {
    const onCodeChange = vi.fn();
    const onSwitchToCodeMode = vi.fn();

    const { getByTestId, rerender } = render(
      <SourceCodePanel
        code={sampleCode}
        isVisualEditMode={true}
        theme="default"
        onCodeChange={onCodeChange}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={vi.fn()}
        viewName={null}
      />
    );

    // Rerender with viewCode and viewName="CurrentState" (simulates selecting a Saved View
    // while SourceCodePanel is already mounted). Real @monaco-editor/react fires onChange
    // on setValue when readOnly is true — SourceCodePanel must suppress it.
    rerender(
      <SourceCodePanel
        code="sequenceDiagram\n    participant MergedKey_core as Merged core"
        isVisualEditMode={true}
        theme="default"
        onCodeChange={onCodeChange}
        onSwitchToCodeMode={onSwitchToCodeMode}
        onSwitchToVisualMode={vi.fn()}
        viewName="CurrentState"
      />
    );

    expect(onCodeChange).not.toHaveBeenCalled();

    // Focusing the editor after viewName became non-null must not call onSwitchToCodeMode
    // (regression for stale closure in handleEditorDidMount).
    fireEvent.focus(getByTestId('monaco-editor-textarea'));
    expect(onSwitchToCodeMode).not.toHaveBeenCalled();
  });
});
