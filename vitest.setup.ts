// jsdom does not implement the SVG geometry APIs that mermaid.render needs.
// Polyfill them with fixed geometry so render-level tests can run (the plan's
// render-level assertions are attribute-level; pixel-perfect layout checks are
// reserved for Cypress).
if (typeof SVGElement !== 'undefined') {
  // getBBox lives on SVGGraphicsElement in lib.dom; the polyfill targets SVGElement.
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = function getBBox() {
    return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON: () => ({}) } as DOMRect;
  };
  (SVGElement.prototype as unknown as { getComputedTextLength: () => number }).getComputedTextLength = function getComputedTextLength() {
    return 100;
  };
}

import React from 'react';
import { vi } from 'vitest';

vi.mock('@monaco-editor/react', () => {
  return {
    default: ({ value, onChange, options, onMount }: any) => {
      const prevValueRef = React.useRef(value);
      const focusCbRef = React.useRef<(() => void) | null>(null);

      React.useEffect(() => {
        if (onMount) {
          const fakeEditor = {
            revealLineInCenter: vi.fn(),
            setPosition: vi.fn(),
            focus: vi.fn(),
            deltaDecorations: vi.fn().mockReturnValue([]),
            onDidFocusEditorText: (cb: any) => {
              focusCbRef.current = cb;
              return { dispose: vi.fn() };
            },
            getValue: () => value,
            setValue: vi.fn(),
          };
          // Expose the instance so tests can assert imperative calls
          // (revealLineInCenter, setPosition, focus).
          (window as unknown as { __monacoEditorMock?: unknown }).__monacoEditorMock = fakeEditor;
          const fakeMonaco = {
            Range: class {
              constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
            },
            editor: {
              OverviewRulerLane: { Left: 1 },
            },
          };
          onMount(fakeEditor, fakeMonaco);
        }
      }, []);

      // Mirror real @monaco-editor/react behavior: when value prop changes while
      // readOnly is true, @monaco-editor/react calls editor.setValue(value) without
      // setting preventTriggerChangeEvent, which triggers onChange(value).
      React.useEffect(() => {
        if (prevValueRef.current !== value) {
          prevValueRef.current = value;
          if (options?.readOnly) {
            onChange?.(value);
          }
        }
      }, [value, options?.readOnly, onChange]);

      return React.createElement(
        'div',
        { 'data-testid': 'monaco-editor-mock' },
        React.createElement('textarea', {
          'data-testid': 'monaco-editor-textarea',
          value: value ?? '',
          readOnly: options?.readOnly,
          onFocus: () => focusCbRef.current?.(),
          onChange: (e: any) => onChange?.(e.target.value),
        })
      );
    },
  };
});

if (typeof window !== 'undefined') {
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  }
  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = vi.fn();
  }
}


