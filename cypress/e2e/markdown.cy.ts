// Markdown-embedded diagrams e2e: mermaid blocks inside .md files are listed
// in the Files menu under their markdown file, open in the editor like .mmd
// diagrams, and saving writes the edited diagram back into the markdown file
// through a background job — replacing only that fenced block. Uses fresh temp
// directories; never touches the committed demo fixtures.

const CONFIG_LINE = '%% CONFIG: {"version":1,"actors":{"A":{"color":"#e11d48"}}}';

const MD_CONTENT = [
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
  '```mermaid',
  CONFIG_LINE,
  'sequenceDiagram',
  '    participant A as Alice',
  '    participant B as Bob',
  '    A->>B: Second diagram',
  '```',
  '',
  '```js',
  'console.log("not a diagram")',
  '```',
  '',
  'Trailing prose.',
  '',
].join('\n');

const mdFileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const mdAppUrl = (dir: string, params: Record<string, string>) =>
  `/?dir=${encodeURIComponent(dir)}${Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`;

// Waits for the debounced auto-save + background job + status poll.
const mdSaved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

// Polls a background job until it reaches a terminal state.
type JobStatus = { status: string; code?: string; error?: string };
const waitForJob = (jobId: string): Cypress.Chainable<JobStatus> =>
  cy.request(`/api/jobs/${jobId}`).then(res => {
    const body = res.body as JobStatus;
    if (body.status === 'queued' || body.status === 'running') {
      return cy.wait(300).then(() => waitForJob(jobId));
    }
    return cy.wrap(body);
  });

describe('Markdown embedded diagrams (e2e)', () => {
  it('lists embedded diagrams under their markdown file and opens them', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdFileApi('notes.md', dir), { content: MD_CONTENT });
      })
      .then(() => {
        return cy.request('POST', mdFileApi('plain.md', dir), { content: '# Plain\n\nNo diagrams here.\n' });
      })
      .then(() => {
        cy.visit(mdAppUrl(dir, {}));

        // the markdown files are listed as parent rows with an MD badge
        cy.get('[data-testid="md-file-notes.md"]').should('be.visible').and('contain.text', 'notes.md');
        cy.get('[data-testid="md-badge-notes.md"]').should('have.text', 'MD');
        cy.get('[data-testid="md-file-plain.md"]').should('be.visible');
        // a markdown file without mermaid blocks is marked as such
        cy.contains('no mermaid diagrams').should('be.visible');

        // the detected diagrams are nested children, clearly marked as md diagrams
        cy.get('[data-testid="md-diagram-notes.md-0"]').should('be.visible').and('contain.text', 'Diagram 1');
        cy.get('[data-testid="md-diagram-notes.md-1"]').should('be.visible').and('contain.text', 'Diagram 2');

        // with no .mmd files the first .md file is auto-selected: the rich
        // markdown editor opens on the whole document
        cy.get('[data-testid="markdown-editor"]', { timeout: 10000 })
          .should('be.visible');
        cy.get('[data-testid="markdown-file-badge"]').should('contain.text', 'notes.md');

        // select the second embedded diagram
        cy.get('[data-testid="md-diagram-notes.md-1"]').click();
        cy.url().should('include', 'file=notes.md');
        cy.url().should('include', 'diagram=1');
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Second diagram').should('exist');
        cy.get('[data-testid="embedded-diagram-badge"]').should('contain.text', 'Diagram 2');

        // switch to the first diagram
        cy.get('[data-testid="md-diagram-notes.md-0"]').click();
        cy.url().should('include', 'diagram=0');
        cy.get('#diagram-container').contains('First diagram').should('exist');
        cy.get('#diagram-container').contains('Second diagram').should('not.exist');
      });
  });

  it('visualizes the markdown document and opens a diagram by selecting it in the preview', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdFileApi('notes.md', dir), { content: MD_CONTENT });
      })
      .then(() => {
        cy.visit(mdAppUrl(dir, { file: 'notes.md' }));

        // the rich markdown editor shows the whole document
        cy.get('[data-testid="markdown-editor"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="markdown-file-badge"]').should('contain.text', 'notes.md');

        // prose renders as rich text (retry-safe assertions: the preview
        // re-renders asynchronously while the mermaid blocks mount)
        cy.get('[data-testid="markdown-preview"]', { timeout: 10000 }).should('contain.text', 'Architecture Notes');
        cy.get('[data-testid="markdown-preview"]').should('contain.text', 'bold');
        // the non-mermaid fenced block renders as code
        cy.get('[data-testid="markdown-preview"]').should('contain.text', 'console.log("not a diagram")');

        // both embedded mermaid diagrams render as SVGs
        cy.get('[data-testid="md-mermaid-svg-0"] svg', { timeout: 10000 }).should('exist');
        cy.get('[data-testid="md-mermaid-svg-1"] svg', { timeout: 10000 }).should('exist');

        // selecting a diagram in the preview opens it in the diagram editor
        // (the same select-to-edit flow as the Files menu)
        cy.get('[data-testid="md-mermaid-block-1"]').click();
        cy.url().should('include', 'file=notes.md');
        cy.url().should('include', 'diagram=1');
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Second diagram').should('exist');
        cy.get('[data-testid="embedded-diagram-badge"]').should('contain.text', 'Diagram 2');
      });
  });

  it('keeps the last good render when a diagram becomes invalid, and leaks no stray error diagrams', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdFileApi('notes.md', dir), { content: MD_CONTENT });
      })
      .then(() => {
        cy.visit(mdAppUrl(dir, { file: 'notes.md' }));

        // both diagrams render
        cy.get('[data-testid="md-mermaid-svg-0"] svg', { timeout: 10000 }).should('exist');
        cy.get('[data-testid="md-mermaid-svg-1"] svg', { timeout: 10000 }).should('exist');
        cy.get('[data-testid="md-mermaid-error-chip-0"]').should('not.exist');

        // the file changes on disk to an invalid diagram (SSE reload, like
        // a transient state while typing): the last good render stays on
        // screen, marked with a syntax-error chip — no destructive error
        // box, and no stray mermaid error diagram leaked into the page
        const broken = MD_CONTENT.replace(
          'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: First diagram',
          'this is not a diagram',
        );
        return cy.request('POST', mdFileApi('notes.md', dir), { content: broken }).then(() => {
          cy.get('[data-testid="md-mermaid-error-chip-0"]', { timeout: 10000 }).should('contain.text', 'Syntax error');
          cy.get('[data-testid="md-mermaid-svg-0"] svg').should('exist');
          cy.get('[data-testid="md-mermaid-error-0"]').should('not.exist');
          cy.get('body').then($body => {
            expect($body.find('div[id^="dmd-mermaid-"]').length).to.eq(0);
          });

          // the file recovers: the chip clears and the diagram re-renders
          return cy.request('POST', mdFileApi('notes.md', dir), { content: MD_CONTENT });
        }).then(() => {
          cy.get('[data-testid="md-mermaid-error-chip-0"]', { timeout: 10000 }).should('not.exist');
          cy.get('[data-testid="md-mermaid-svg-0"] svg').should('exist');
        });
      });
  });

  it('edits an embedded diagram and the background save updates only that block in the md file', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdFileApi('notes.md', dir), { content: MD_CONTENT });
      })
      .then(() => {
        cy.visit(mdAppUrl(dir, { file: 'notes.md', diagram: '1' }));

        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Second diagram').should('exist');

        // edit the message label through the visual editor
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Second diagram');
        cy.contains('label', 'Label').find('input').clear().type('Edited label');

        // the save runs as a background task: the indicator reports Saved
        mdSaved();

        // a second edit saves again (the queue does not wedge)
        cy.contains('label', 'Label').find('input').clear().type('Edited again');
        mdSaved();
      })
      .then(() => {
        // the markdown file on disk: everything outside the edited block is
        // byte-identical, the other diagram is untouched, and the edited
        // block keeps the config comment as its first line
        return cy.request('GET', mdFileApi('notes.md', dir)).then(res => {
          const md = res.body.content as string;
          expect(md.startsWith('# Architecture Notes\n\nIntro prose that must survive.')).to.eq(true);
          expect(md).to.contain('Middle prose with **bold** text.');
          expect(md).to.contain('console.log("not a diagram")');
          expect(md.endsWith('Trailing prose.\n')).to.eq(true);
          expect(md.match(/```mermaid/g)).to.have.length(2);
          // block 0 is byte-identical
          expect(md).to.contain('```mermaid\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: First diagram\n```');
          // block 1: config first line preserved, label edited
          expect(md).to.contain(`\`\`\`mermaid\n${CONFIG_LINE}\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Edited again\n\`\`\``);
        });
      })
      .then(() => {
        // the API serves the edited block with the config comment first
        return cy.request('GET', `/api/markdown/diagram?file=notes.md&index=1&dir=${encodeURIComponent(dir)}`);
      })
      .then(res => {
        const content = res.body.content as string;
        expect(content.split('\n')[0]).to.eq(CONFIG_LINE);
        expect(content).to.contain('A->>B: Edited again');
      });
  });

  it('rejects a save when the diagram changed on disk (conflict; the file is untouched)', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdFileApi('notes.md', dir), { content: MD_CONTENT });
      })
      .then(() => {
        // save with a stale compare-and-swap base
        return cy.request('POST', `/api/markdown/save?dir=${encodeURIComponent(dir)}`, {
          file: 'notes.md',
          index: 0,
          content: 'sequenceDiagram\n    A->>B: Overwrite',
          expectedContent: 'this is not what is on disk',
        });
      })
      .then(res => {
        expect(res.status).to.eq(202);
        return waitForJob(res.body.jobId).then(job => {
          expect(job.status).to.eq('failed');
          expect(job.code).to.eq('conflict');
        });
      })
      .then(() => {
        // the markdown file is byte-identical to the original
        return cy.request('GET', mdFileApi('notes.md', dir));
      })
      .then(res => {
        expect(res.body.content).to.eq(MD_CONTENT);
      });
  });
});
