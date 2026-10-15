import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import mermaid from 'mermaid';
import MarkdownEditor from './MarkdownEditor';

// No mermaid mock here: this exercises the real mermaid 12 render pipeline in
// jsdom (SVG geometry is polyfilled in vitest.setup.ts). Regression test for
// the reported bug where the committed demo file produced a mermaid error
// diagram: "Syntax error in text — No diagram type detected matching given
// configuration for text: # Markdown Demo …" (markdown prose was passed to
// mermaid.render instead of a diagram).

describe('MarkdownEditor with the real mermaid renderer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders every embedded diagram of the committed demo file as an SVG, with no mermaid error', async () => {
    const demo = readFileSync(join(process.cwd(), 'diagrams/markdown-demo.md'), 'utf8');
    render(
      <MarkdownEditor
        code={demo}
        theme="default"
        fileName="markdown-demo.md"
        onCodeChange={() => {}}
        onSelectDiagram={() => {}}
      />,
    );

    const svg0 = await screen.findByTestId('md-mermaid-svg-0', undefined, { timeout: 14000 });
    expect(svg0.querySelector('svg')).toBeTruthy();
    const svg1 = await screen.findByTestId('md-mermaid-svg-1', undefined, { timeout: 14000 });
    expect(svg1.querySelector('svg')).toBeTruthy();

    // No error boxes, no syntax-error chips, no not-a-diagram notes, and no
    // leaked mermaid temp elements (#d<id> error diagrams).
    expect(screen.queryByTestId('md-mermaid-error-0')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-error-1')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-error-chip-0')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-error-chip-1')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-not-diagram-0')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-not-diagram-1')).toBeNull();
    expect(document.querySelector('div[id^="dmd-mermaid-"]')).toBeNull();

    // The rendered SVGs are the actual diagrams, not mermaid error diagrams
    // (mermaid 12 renders parse failures as an SVG containing this text).
    expect(svg0.textContent).not.toContain('Syntax error');
    expect(svg1.textContent).not.toContain('Syntax error');
    expect(svg0.textContent).toContain('Client');
    expect(svg1.textContent).toContain('Gateway');
  }, 30000);

  it('an unclosed mermaid fence at the top of the document never produces a mermaid error diagram', async () => {
    // Same reported bug, end to end with the real renderer: the unclosed fence
    // swallows the document prose as block content. Without the not-a-diagram
    // guard, mermaid.render receives that prose and mermaid 12 paints an error
    // diagram ("No diagram type detected … for text: # Markdown Demo …") and
    // leaks its temp element (#d<id>) into the DOM.
    const demo = readFileSync(join(process.cwd(), 'diagrams/markdown-demo.md'), 'utf8');
    render(
      <MarkdownEditor
        code={'```mermaid\n' + demo}
        theme="default"
        fileName="markdown-demo.md"
        onCodeChange={() => {}}
        onSelectDiagram={() => {}}
      />,
    );

    const note = await screen.findByTestId('md-mermaid-not-diagram-0', undefined, { timeout: 14000 });
    expect(note.textContent).toContain('not a mermaid diagram');

    expect(screen.queryByTestId('md-mermaid-svg-0')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-error-0')).toBeNull();
    expect(screen.queryByTestId('md-mermaid-error-chip-0')).toBeNull();
    expect(document.body.textContent).not.toContain('No diagram type detected');
    expect(document.querySelector('div[id^="dmd-mermaid-"]')).toBeNull();
  }, 30000);

  it('real mermaid rejects document prose with the reported error (why the guard exists)', async () => {
    // Pin down the failure mode the not-a-diagram guard prevents: feeding
    // markdown prose to mermaid.render makes mermaid 12 throw exactly the
    // error the user reported ("No diagram type detected matching given
    // configuration for text: # Markdown Demo …").
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    const prose = '# Markdown Demo — Embedded Mermaid Diagrams\n\nThis file is a committed sample.\n';
    await expect(mermaid.render('repro-prose', prose)).rejects.toThrow(/No diagram type detected/);
    // mermaid 12 leaves its error-diagram temp element (#d<id>) behind on failure.
    document.getElementById('drepro-prose')?.remove();
  }, 30000);
});
