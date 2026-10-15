// Markdown preview view/tag controls e2e: in the markdown file viewer's
// Preview mode, each embedded mermaid block whose %% CONFIG carries saved
// views or tags gets a view dropdown and tag toggle chips in its header bar.
// Toggling applies the diagram editor's view/tag pipeline to that block's
// render only, the state lives in the URL (mdview.<i> / mdhide.<i> params),
// and toggling never opens the diagram editor or writes the file. Uses fresh
// temp directories; never touches the committed demo fixtures.

const MD_VIEWS_CONFIG_LINE = '%% CONFIG: {"version":1,"actors":{"Client":{"keys":["frontend"]},"Auth":{"keys":["backend"]}},"views":[{"name":"Backend only","hideKeys":["frontend"]}]}';

const MD_VIEWS_CONTENT = [
  '# Notes',
  '',
  '```mermaid',
  MD_VIEWS_CONFIG_LINE,
  'sequenceDiagram',
  '    participant Client as Client',
  '    participant Auth as Auth Service',
  '    Client->>Auth: Login',
  '    Auth->>Client: Token',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  '    participant X',
  '    participant Y',
  '    X->>Y: Second',
  '```',
  '',
].join('\n');

const mdViewsFileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const mdViewsAppUrl = (dir: string, params: Record<string, string>) =>
  `/?dir=${encodeURIComponent(dir)}${Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`;

// The block SVG re-renders (debounced) after a toggle; retry until the text
// reflects the applied view/tag state.
const svg0Contains = (text: string) =>
  cy.get('[data-testid="md-mermaid-svg-0"]', { timeout: 10000 }).should('contain.text', text);
const svg0Omits = (text: string) =>
  cy.get('[data-testid="md-mermaid-svg-0"]', { timeout: 10000 }).should('not.contain.text', text);

describe('Markdown preview view/tag controls (e2e)', () => {
  it('applies a saved view to one block only, without opening the editor', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdViewsFileApi('notes.md', dir), { content: MD_VIEWS_CONTENT });
      })
      .then(() => {
        cy.visit(mdViewsAppUrl(dir, { file: 'notes.md' }));

        // both diagrams render in full
        svg0Contains('Client');
        svg0Contains('Auth');
        cy.get('[data-testid="md-mermaid-svg-1"]').should('contain.text', 'X');

        // the first block has the controls; the second (no CONFIG) has none
        cy.get('[data-testid="md-mermaid-view-controls-0"]').should('be.visible');
        cy.get('[data-testid="md-mermaid-view-controls-1"]').should('not.exist');
        cy.get('[data-testid="md-mermaid-tag-0-frontend"]').should('be.visible');
        cy.get('[data-testid="md-mermaid-tag-0-backend"]').should('be.visible');

        // apply the saved view: the frontend actor and its messages disappear
        // from block 0 only; the URL records the per-block view
        cy.get('[data-testid="md-mermaid-view-select-0"]').select('Backend only');
        cy.url().should('include', 'mdview.0=');
        svg0Omits('Client');
        svg0Omits('Login');
        svg0Contains('Auth');
        cy.get('[data-testid="md-mermaid-svg-1"]').should('contain.text', 'X');
        // still the markdown viewer — the controls did not open the editor
        cy.url().should('not.include', 'diagram=');
        cy.get('[data-testid="markdown-editor"]').should('be.visible');

        // back to the default: the full diagram returns
        cy.get('[data-testid="md-mermaid-view-select-0"]').select('All (default)');
        cy.url().should('not.include', 'mdview.0=');
        svg0Contains('Client');
      });
  });

  it('toggles a tag on/off per block and records it in the URL', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdViewsFileApi('notes.md', dir), { content: MD_VIEWS_CONTENT });
      })
      .then(() => {
        cy.visit(mdViewsAppUrl(dir, { file: 'notes.md' }));

        svg0Contains('Auth');
        // hide the backend tag: Auth and every message mentioning it disappear
        cy.get('[data-testid="md-mermaid-tag-0-backend"]').click();
        cy.url().should('include', 'mdhide.0=backend');
        svg0Omits('Auth');
        svg0Omits('Login');
        svg0Contains('Client');
        // the chip shows the off state
        cy.get('[data-testid="md-mermaid-tag-0-backend"]').should('have.attr', 'data-state', 'off');
        // the other diagram is unaffected
        cy.get('[data-testid="md-mermaid-svg-1"]').should('contain.text', 'X');
        // toggling the chip did not open the diagram editor
        cy.url().should('not.include', 'diagram=');

        // toggle back on
        cy.get('[data-testid="md-mermaid-tag-0-backend"]').click();
        cy.url().should('not.include', 'mdhide.0=');
        svg0Contains('Auth');
      });
  });

  it('exits view mode when a tag chip is clicked, and survives a reload', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then(d => {
        dir = d;
        return cy.request('POST', mdViewsFileApi('notes.md', dir), { content: MD_VIEWS_CONTENT });
      })
      .then(() => {
        cy.visit(mdViewsAppUrl(dir, { file: 'notes.md' }));

        // select the view, then click a tag chip: the view is replaced by the
        // manual tag state (seeded from the view's hidden tags)
        cy.get('[data-testid="md-mermaid-view-select-0"]').select('Backend only');
        cy.url().should('include', 'mdview.0=');
        cy.get('[data-testid="md-mermaid-tag-0-backend"]').click();
        cy.url().should('include', 'mdhide.0=');
        cy.url().should('not.include', 'mdview.0=');
        svg0Omits('Client');
        svg0Omits('Auth');

        // the per-block state survives a reload (it lives in the URL)
        cy.reload();
        cy.get('[data-testid="markdown-editor"]', { timeout: 10000 }).should('be.visible');
        svg0Omits('Client');
        svg0Omits('Auth');
        cy.get('[data-testid="md-mermaid-tag-0-frontend"]').should('have.attr', 'data-state', 'off');
        cy.get('[data-testid="md-mermaid-tag-0-backend"]').should('have.attr', 'data-state', 'off');
      });
  });
});
