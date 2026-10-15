// Markdown persistence e2e (real server, real disk): saving a view on a
// diagram embedded in a markdown file must update only that fenced block, and
// opening the markdown document afterwards must show the intact file.
// Regression for the "markdown file got corrupted after saving a view" bug:
// the view save POSTed the diagram source to /api/file/<doc>.md, replacing
// the whole document with a single diagram. Uses a fresh temp directory.

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
  'Middle prose.',
  '',
  '```mermaid',
  CONFIG_LINE,
  'sequenceDiagram',
  '    participant A as Alice',
  '    participant B as Bob',
  '    A->>B: Second diagram',
  '```',
  '',
  'Trailing prose.',
  '',
].join('\n');

const appUrl = (dir: string, params: Record<string, string>) =>
  `/?dir=${encodeURIComponent(dir)}${Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`;

const countMermaidFences = (md: string) => (md.match(/^```mermaid$/gm) || []).length;

describe('Markdown persistence (e2e)', () => {
  it('saving a view on an embedded diagram then opening the document keeps the markdown file intact', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.writeFile(`${dir}/notes.md`, MD_CONTENT);
      })
      .then(() => {
        cy.visit(appUrl(dir, { file: 'notes.md', diagram: '1' }), {
          onBeforeLoad(win) {
            cy.stub(win, 'prompt').returns('My View');
          },
        });
        cy.get('#diagram-container', { timeout: 15000 }).contains('Second diagram').should('exist');

        cy.get('[title="Save Current View"]').click();
        cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

        // open the markdown document (the Files menu parent row)
        cy.get('[data-testid="md-file-notes.md"]').click();
        cy.get('[data-testid="markdown-editor"]', { timeout: 10000 }).should('be.visible');
        cy.get('[data-testid="markdown-preview"]', { timeout: 10000 }).should('contain.text', 'Intro prose that must survive.');

        // the file on disk: prose kept, both diagrams kept, only block 2 changed
        cy.readFile(`${dir}/notes.md`).then((md: string) => {
          expect(md.startsWith('# Architecture Notes\n\nIntro prose that must survive.\n')).to.eq(true);
          expect(md).to.contain('Middle prose.');
          expect(md.endsWith('Trailing prose.\n')).to.eq(true);
          expect(countMermaidFences(md)).to.eq(2);
          expect(md).to.contain('A->>B: First diagram');
          expect(md).to.contain('"name":"My View"');
        });
      });
  });
});
