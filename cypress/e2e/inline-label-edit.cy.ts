// Double-click inline label editing e2e (FEATURES_AND_QOL.md QoL 3):
// double-clicking a participant box, flowchart node, or message/edge label
// opens a floating input over the element; Enter/blur commits, Escape
// cancels. Runs against brand-new temp diagrams created through the real API
// — never the committed demo fixtures.

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the other (script-style) specs occupy.
export {};

const SEQ_CONTENT = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const FLOW_CONTENT = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| C[Charlie]`;

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

const createDiagram = (prefix: string, content: string) => {
  const state = { dir: '', name: '' };
  return cy.task<string>('createTempDiagramDir')
    .then((d) => {
      state.dir = d;
      state.name = `${prefix}-${Date.now()}.mmd`;
      return cy.request('POST', fileApi(state.name, state.dir), { content });
    })
    .then(() => state);
};

// Waits for the debounced auto-save to complete (the indicator starts as
// "idle", so "Saved" can only appear after an actual save).
const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

const readFile = (name: string, dir: string) =>
  cy.request(fileApi(name, dir)).then((res) => (res.body as { content: string }).content);

// The exact message-text element for a label.
const messageText = (label: string) =>
  cy.get('#diagram-container text.messageText').filter(
    (_, el) => (el.textContent ?? '').trim() === label
  );

describe('Double-click inline label editing (e2e)', () => {
  it('double-clicking a participant box renames it; Enter commits and saves', () => {
    createDiagram('cypress-inline-p', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      const actorText = () =>
        cy.get('#diagram-container g[data-et="participant"][data-id="A"] text.actor').first();

      actorText().dblclick();

      // the floating editor opens over the clicked label, prefilled
      cy.get('[data-testid="inline-label-editor"]')
        .should('be.visible')
        .and('have.value', 'Alice');
      actorText().then(($t) => {
        const tr = ($t[0] as HTMLElement).getBoundingClientRect();
        cy.get('[data-testid="inline-label-editor"]').then(($e) => {
          const er = ($e[0] as HTMLElement).getBoundingClientRect();
          expect(er.left).to.be.at.most(tr.right);
          expect(er.right).to.be.at.least(tr.left);
          expect(er.top).to.be.at.most(tr.bottom);
          expect(er.bottom).to.be.at.least(tr.top);
        });
      });

      cy.get('[data-testid="inline-label-editor"]').clear().type('Alicia{enter}');

      // the editor closed and the canvas shows the new label
      cy.get('[data-testid="inline-label-editor"]').should('not.exist');
      cy.get('#diagram-container').contains('Alicia').should('exist');
      cy.get('#diagram-container').contains('Alice').should('not.exist');

      // the rename was auto-saved to disk
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('participant A as Alicia');
      });
    });
  });

  it('double-clicking a message text edits its label; clicking away (blur) commits', () => {
    createDiagram('cypress-inline-m', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      messageText('Hello').dblclick();
      cy.get('[data-testid="inline-label-editor"]')
        .should('be.visible')
        .and('have.value', 'Hello');
      cy.get('[data-testid="inline-label-editor"]').clear().type('Hi there');

      // clicking empty canvas space blurs the editor -> commit
      cy.get('#diagram-container').click('topLeft');

      cy.get('[data-testid="inline-label-editor"]').should('not.exist');
      messageText('Hi there').should('exist');
      messageText('Hello').should('not.exist');

      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('A->>B: Hi there');
      });
    });
  });

  it('Escape cancels the edit: no label change, no save', () => {
    createDiagram('cypress-inline-esc', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      messageText('Hello').dblclick();
      cy.get('[data-testid="inline-label-editor"]').clear().type('Ignored{esc}');

      cy.get('[data-testid="inline-label-editor"]').should('not.exist');
      messageText('Hello').should('exist');
      messageText('Ignored').should('not.exist');

      // wait past the 800ms auto-save debounce; the file is untouched
      cy.wait(1200);
      readFile(name, dir).then((content) => {
        expect(content).to.contain('A->>B: Hello');
        expect(content).to.not.contain('Ignored');
      });
    });
  });

  it('double-clicking a flowchart node renames it', () => {
    createDiagram('cypress-inline-node', FLOW_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      cy.get('#diagram-container g.node')
        .filter((_, el) => (el.querySelector('span.nodeLabel')?.textContent ?? '').includes('Alice'))
        .find('span.nodeLabel')
        .dblclick();

      cy.get('[data-testid="inline-label-editor"]')
        .should('be.visible')
        .and('have.value', 'Alice');
      cy.get('[data-testid="inline-label-editor"]').clear().type('Alicia{enter}');

      cy.get('#diagram-container').contains('Alicia').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('A[Alicia] --> B[Bob]');
      });
    });
  });

  it('double-clicking a flowchart edge label edits it', () => {
    createDiagram('cypress-inline-edge', FLOW_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      cy.get('#diagram-container g.edgeLabel span.edgeLabel')
        .filter((_, el) => (el.textContent ?? '').includes('Reply'))
        .dblclick();

      cy.get('[data-testid="inline-label-editor"]')
        .should('be.visible')
        .and('have.value', 'Reply');
      cy.get('[data-testid="inline-label-editor"]').clear().type('OK{enter}');

      cy.get('#diagram-container').contains('OK').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('B -->|OK| C[Charlie]');
      });
    });
  });

  it('does nothing in view mode (edit=0)', () => {
    createDiagram('cypress-inline-view', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(`${appUrl(name, dir)}&edit=0`);
      cy.get('#diagram-container svg').should('exist');

      messageText('Hello').dblclick();
      cy.get('[data-testid="inline-label-editor"]').should('not.exist');
      messageText('Hello').should('exist');
    });
  });
});
