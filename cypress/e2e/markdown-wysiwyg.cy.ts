// WYSIWYG markdown editor e2e: the preview pane is an interactive editing
// surface. Text blocks render as styled HTML and can be clicked to edit
// inline (textarea with the block's markdown source); saving re-renders the
// block and auto-saves to disk. Mermaid blocks keep their click-to-edit flow.
// Uses fresh temp directories; never touches the committed demo fixtures.

const WYSIWYG_MD = [
  '# Architecture Notes',
  '',
  'Intro prose that must survive.',
  '',
  '```mermaid',
  'sequenceDiagram',
  '    participant A as Alice',
  '    participant B as Bob',
  '    A->>B: First diagram',
  '```',
  '',
  'Middle prose with **bold** text.',
  '',
  'Trailing prose.',
  '',
].join('\n');

const wysiwygFileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const wysiwygAppUrl = (dir: string, params: Record<string, string>) =>
  `/?dir=${encodeURIComponent(dir)}${Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`;

// Waits for the debounced auto-save + status indicator.
const wysiwygSaved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

describe('WYSIWYG markdown editor (e2e)', () => {
  it('edits a paragraph inline and auto-saves to disk', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));

        // The WYSIWYG editor is visible
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');

        // Block 1 is "Intro prose that must survive." — click to edit
        cy.get('[data-testid="wysiwyg-block-1"]').click();
        cy.get('[data-testid="wysiwyg-block-editor-1"]').should('be.visible').clear().type('Edited intro prose.');

        // Save with Cmd/Ctrl+Enter
        cy.get('[data-testid="wysiwyg-block-editor-1"]').type('{ctrl+enter}');

        // The block re-renders with the new content
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'Edited intro prose.');
        cy.get('[data-testid="wysiwyg-block-1"]').should('not.contain.text', 'Intro prose that must survive.');

        // Auto-save fires
        wysiwygSaved();
      })
      .then(() => {
        // Verify the file on disk
        return cy.request('GET', wysiwygFileApi('notes.md', dir)).then(res => {
          const md = res.body.content as string;
          expect(md).to.contain('Edited intro prose.');
          expect(md).not.to.contain('Intro prose that must survive.');
          // surrounding content preserved
          expect(md).to.contain('# Architecture Notes');
          expect(md).to.contain('```mermaid');
          expect(md).to.contain('Trailing prose.');
        });
      });
  });

  it('inserts a new block via the + button', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');

        // Click the insert button after block 0 (the heading) → position 1
        cy.get('[data-testid="wysiwyg-insert-1"]').click();

        // A pending block appears in edit mode
        cy.get('[data-testid="wysiwyg-block-editor-1"]').should('be.visible').type('Inserted paragraph.');
        cy.get('[data-testid="wysiwyg-block-save-1"]').click();

        // The new block renders
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'Inserted paragraph.');
        wysiwygSaved();
      })
      .then(() => {
        return cy.request('GET', wysiwygFileApi('notes.md', dir)).then(res => {
          const md = res.body.content as string;
          expect(md).to.contain('Inserted paragraph.');
          // It's between the heading and the intro prose
          const headingPos = md.indexOf('# Architecture Notes');
          const insertedPos = md.indexOf('Inserted paragraph.');
          const introPos = md.indexOf('Edited intro prose.') >= 0 ? md.indexOf('Edited intro prose.') : md.indexOf('Intro prose');
          expect(headingPos).to.be.lessThan(insertedPos);
          expect(insertedPos).to.be.lessThan(introPos);
        });
      });
  });

  it('deletes a block', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');

        // Block 4 is "Middle prose with **bold** text." — delete it
        // (block indices: 0=heading, 1=intro, 2=mermaid, 3=middle prose, 4=trailing)
        // Actually: 0=heading, 1=intro, 2=mermaid, 3=middle, 4=trailing
        cy.get('[data-testid="wysiwyg-block-3"]').trigger('mouseover');
        cy.get('[data-testid="wysiwyg-block-delete-3"]').click({ force: true });

        // The block is removed
        cy.get('[data-testid="wysiwyg-block-3"]').should('not.contain.text', 'Middle prose');
        wysiwygSaved();
      })
      .then(() => {
        return cy.request('GET', wysiwygFileApi('notes.md', dir)).then(res => {
          const md = res.body.content as string;
          expect(md).not.to.contain('Middle prose with **bold** text.');
          expect(md).to.contain('# Architecture Notes');
          expect(md).to.contain('Trailing prose.');
        });
      });
  });

  it('undo/redo works for WYSIWYG edits', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');

        // Edit block 1 (intro prose)
        cy.get('[data-testid="wysiwyg-block-1"]').click();
        cy.get('[data-testid="wysiwyg-block-editor-1"]').clear().type('Edited once.');
        cy.get('[data-testid="wysiwyg-block-save-1"]').click();
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'Edited once.');

        // Undo → reverts to original
        cy.get('[data-testid="markdown-undo"]').click();
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'Intro prose that must survive.');

        // Redo → reapplies the edit
        cy.get('[data-testid="markdown-redo"]').click();
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'Edited once.');
      });
  });

  it('block type switching converts the block', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');

        // Edit block 1 (intro prose) and change its type to Heading 2
        cy.get('[data-testid="wysiwyg-block-1"]').click();
        cy.get('[data-testid="wysiwyg-block-type-1"]').select('heading2');
        cy.get('[data-testid="wysiwyg-block-save-1"]').click();

        // The block now renders as an h2
        cy.get('[data-testid="wysiwyg-block-1"] h2').should('contain.text', 'Intro prose that must survive.');
        wysiwygSaved();
      })
      .then(() => {
        return cy.request('GET', wysiwygFileApi('notes.md', dir)).then(res => {
          const md = res.body.content as string;
          expect(md).to.contain('## Intro prose that must survive.');
        });
      });
  });

  it('mermaid blocks still open in the diagram editor', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');

        // The mermaid block renders as SVG
        cy.get('[data-testid="md-mermaid-svg-0"] svg', { timeout: 10000 }).should('exist');

        // Click it → opens the diagram editor
        cy.get('[data-testid="md-mermaid-block-0"]').click();
        cy.url().should('include', 'file=notes.md');
        cy.url().should('include', 'diagram=0');
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('First diagram').should('exist');
      });
  });

  it('switches between preview (WYSIWYG) and edit (Monaco) modes', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));

        // Preview is the default mode: WYSIWYG visible, no source pane, no split button
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="markdown-source-pane"]').should('not.exist');
        cy.get('[data-testid="markdown-mode-split"]').should('not.exist');

        // Edit in WYSIWYG → auto-saves
        cy.get('[data-testid="wysiwyg-block-1"]').click();
        cy.get('[data-testid="wysiwyg-block-editor-1"]').clear().type('SyncedEdit.');
        cy.get('[data-testid="wysiwyg-block-save-1"]').click();
        wysiwygSaved();

        // Edit mode: the raw source (Monaco) replaces the WYSIWYG document
        cy.get('[data-testid="markdown-mode-edit"]').click();
        cy.get('[data-testid="markdown-source-pane"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="markdown-source-pane"] .monaco-editor', { timeout: 10000 }).should('exist');
        cy.get('[data-testid="markdown-source-pane"]').contains('SyncedEdit.');
        cy.get('[data-testid="wysiwyg-editor"]').should('not.exist');

        // Back to preview: the edit is reflected in the WYSIWYG document
        cy.get('[data-testid="markdown-mode-preview"]').click();
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'SyncedEdit.');
      });
  });

  it('empty document shows an insert affordance', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('empty.md', dir), { content: '' });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'empty.md' }));
        cy.get('[data-testid="wysiwyg-empty"]', { timeout: 10000 }).should('contain.text', 'empty document');

        // Click + and type
        cy.get('[data-testid="wysiwyg-insert-0"]').click();
        cy.get('[data-testid="wysiwyg-block-editor-0"]').type('First content.');
        cy.get('[data-testid="wysiwyg-block-save-0"]').click();

        cy.get('[data-testid="wysiwyg-block-0"]').should('contain.text', 'First content.');
        wysiwygSaved();
      })
      .then(() => {
        return cy.request('GET', wysiwygFileApi('empty.md', dir)).then(res => {
          expect(res.body.content as string).to.contain('First content.');
        });
      });
  });

  it('external change updates the WYSIWYG surface (SSE)', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: WYSIWYG_MD });
      })
      .then(() => {
        cy.visit(wysiwygAppUrl(dir, { file: 'notes.md' }));
        cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="wysiwyg-block-1"]').should('contain.text', 'Intro prose that must survive.');

        // Modify the file on disk (simulates external change)
        const updated = WYSIWYG_MD.replace(
          'Intro prose that must survive.',
          'Externally changed prose.',
        );
        return cy.request('POST', wysiwygFileApi('notes.md', dir), { content: updated }).then(() => {
          // The WYSIWYG surface updates via SSE
          cy.get('[data-testid="wysiwyg-block-1"]', { timeout: 10000 }).should('contain.text', 'Externally changed prose.');
        });
      });
  });
});
