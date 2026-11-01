// Floating On-Canvas Context Toolbar & Command Palette (Cmd+K) e2e spec.
// Runs against brand-new temp diagrams created through the real API — never the
// committed demo fixtures.

export {};

const INITIAL_CONTENT = `%% CONFIG: {"version":1,"views":[{"name":"Overview","hiddenPaths":[],"hideKeys":["auth"]}],"actors":{"Alice":{"keys":["auth"]}}}
sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Login Request
    Bob-->>Alice: Login Response
`;

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

const readFile = (name: string, dir: string) =>
  cy.request(fileApi(name, dir)).then((res) => (res.body as { content: string }).content);

describe('Floating On-Canvas Context Toolbar & Command Palette (Cmd+K)', () => {
  it('shows floating context toolbar on participant selection and allows editing even with right sidebar hidden', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-ctx-participant-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: INITIAL_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // Hide the right sidebar to prove zero-sidebar canvas editing
        cy.get('[data-testid="toggle-sidebar"]').click();
        cy.get('[data-testid="editor-panel"]').should('not.exist');

        // Click participant Alice on the SVG canvas
        cy.get('#diagram-container g[data-et="participant"][data-id="Alice"]').first().click();

        // Floating toolbar appears with participant controls
        cy.get('[data-testid="canvas-context-toolbar"]').should('be.visible');
        cy.get('[data-testid="ctx-participant-kind"]').should('have.value', 'participant');

        // Change participant kind to actor via floating toolbar
        cy.get('[data-testid="ctx-participant-kind"]').select('actor');
        saved();
        readFile(name, dir).should('include', 'actor Alice');

        // Apply a color swatch from the floating toolbar
        cy.get('[data-testid="ctx-color-swatches"] button').first().click();
        saved();
        readFile(name, dir).should('include', '"color":');

        // Add a sequence note directly from the floating toolbar
        cy.get('[data-testid="ctx-add-note"]').click();
        saved();
        readFile(name, dir).should('include', 'Note over Alice');
      });
  });

  it('shows arrow controls in the floating toolbar and updates arrow animation', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-ctx-arrow-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: INITIAL_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // Click the first message label on the canvas
        cy.get('#diagram-container text.messageText').first().click();

        cy.get('[data-testid="canvas-context-toolbar"]').should('be.visible');
        cy.get('[data-testid="ctx-arrow-operator"]').should('be.visible');

        // Change animation preset to pulse
        cy.get('[data-testid="ctx-arrow-animation"]').select('pulse');
        saved();
        readFile(name, dir).should('include', 'pulse');
      });
  });

  it('supports multi-selection bulk actions (wrap in loop block) from the floating toolbar', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-ctx-multi-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: INITIAL_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // Click first message, then Shift+click second message
        cy.get('#diagram-container text.messageText').first().click();
        cy.get('#diagram-container text.messageText').eq(1).click({ shiftKey: true });

        cy.get('[data-testid="canvas-context-toolbar"]')
          .should('be.visible')
          .and('contain.text', '2 selected');

        cy.get('[data-testid="ctx-wrap-block-loop"]').click();
        saved();

        readFile(name, dir).then((content) => {
          expect(content).to.include('loop');
          expect(content).to.include('end');
        });
      });
  });

  it('opens the Cmd+K Command Palette, filters items, selects a participant, and switches views', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-cmd-palette-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: INITIAL_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // Open via top-bar trigger button
        cy.get('[data-testid="command-palette-trigger"]').click();
        cy.get('[data-testid="command-palette"]').should('be.visible');

        // Filter for participant Bob and press Enter
        cy.get('[data-testid="command-palette-input"]').type('Bob{enter}');

        // Command palette closes and Bob is selected in the floating context toolbar
        cy.get('[data-testid="command-palette"]').should('not.exist');
        cy.get('[data-testid="canvas-context-toolbar"]')
          .should('be.visible')
          .and('contain.text', 'Bob');

        // Re-open with keyboard shortcut Cmd+K / Ctrl+K and switch to saved view Overview
        cy.get('body').trigger('keydown', { key: 'k', metaKey: true });
        cy.get('[data-testid="command-palette"]').should('be.visible');
        cy.get('[data-testid="command-palette-input"]').type('Overview{enter}');
        cy.get('[data-testid="command-palette"]').should('not.exist');
      });
  });
});
