// Keyboard-shortcut e2e (FEATURES_AND_QOL.md QoL 1): Delete/Backspace delete
// the selected canvas element, Escape clears the selection / cancels an active
// drag, and Cmd/Ctrl+Shift+Z redoes. Runs against brand-new temp diagrams
// created through the real API — never the committed demo fixtures.

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the other (script-style) specs occupy.
export {};

const SEQ_CONTENT = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// Waits for the debounced auto-save to complete.
const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

const readFile = (name: string, dir: string) =>
  cy.request(fileApi(name, dir)).then((res) => (res.body as { content: string }).content);

describe('Canvas keyboard shortcuts (e2e)', () => {
  it('Delete removes the selected message; Escape clears the selection', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-shortcuts-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: SEQ_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // click the first message -> the properties panel shows its label
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Hello');

        // Escape clears the selection without deleting anything
        cy.get('body').type('{esc}');
        cy.contains('Click an element in the diagram to edit it.').should('exist');
        cy.get('#diagram-container').contains('Hello').should('exist');

        // select again and delete with the Delete key
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Hello');
        cy.get('body').type('{del}');
        saved();
        cy.get('#diagram-container').contains('Hello').should('not.exist');
        cy.contains('Click an element in the diagram to edit it.').should('exist');

        // the file on disk lost the message (auto-save persisted the delete)
        readFile(name, dir).then((content) => {
          expect(content).to.not.contain('Hello');
          expect(content).to.contain('B-->>A: Hi there');
        });

        // Backspace removes the second message too
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Hi there');
        cy.get('body').type('{backspace}');
        saved();
        readFile(name, dir).then((content) => {
          expect(content).to.not.contain('Hi there');
        });
      });
  });

  it('Delete does nothing when nothing is selected', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-shortcuts-nosel-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: SEQ_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Hello').should('exist');

        cy.get('body').type('{del}');
        cy.get('body').type('{backspace}');
        // nothing was selected: the diagram is untouched
        cy.get('#diagram-container').contains('Hello').should('exist');
        readFile(name, dir).then((content) => {
          expect(content).to.equal(SEQ_CONTENT);
        });
      });
  });

  it('Ctrl+Shift+Z redoes an undone edit', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-shortcuts-redo-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: SEQ_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // rename the message through the panel. The native value setter +
        // input event makes React fire one onChange (one history entry), so a
        // single undo reverts the whole rename.
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('label', 'Label').find('input').then(($input) => {
          const el = $input[0] as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )!.set!;
          setter.call(el, 'Greetings');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        saved();
        cy.get('#diagram-container').contains('Greetings').should('exist');

        // undo with Ctrl+Z, redo with Ctrl+Shift+Z
        cy.get('body').type('{ctrl}z');
        cy.get('#diagram-container').contains('Hello').should('exist');
        cy.get('body').type('{ctrl}{shift}z');
        cy.get('#diagram-container').contains('Greetings').should('exist');
        saved();
        readFile(name, dir).then((content) => {
          expect(content).to.contain('A->>B: Greetings');
        });
      });
  });

  it('Escape cancels an in-progress participant drag (no reorder is applied)', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-shortcuts-drag-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: SEQ_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');

        // Sanity: a completed drag of A's box past B reorders the file.
        cy.get('#diagram-container g[data-et="participant"][data-id="A"]').then(($a) => {
          const a = ($a[0] as HTMLElement).getBoundingClientRect();
          cy.get('#diagram-container g[data-et="participant"][data-id="B"]').then(($b) => {
            const b = ($b[0] as HTMLElement).getBoundingClientRect();
            const fromX = a.left + a.width / 2;
            const fromY = a.top + a.height / 2;
            const toX = b.left + b.width / 2 + 60;
            cy.get('#diagram-container g[data-et="participant"][data-id="A"]')
              .trigger('mousedown', { button: 0, clientX: fromX, clientY: fromY });
            cy.get('body').trigger('mousemove', { clientX: toX, clientY: fromY + 40 });
            cy.get('body').trigger('mouseup', { clientX: toX, clientY: fromY + 40 });
          });
        });
        saved();
        readFile(name, dir).then((content) => {
          expect(content.indexOf('participant B as Bob')).to.be.lessThan(
            content.indexOf('participant A as Alice')
          );
        });

        // Reload, then start the same drag and cancel it with Escape: the
        // pending drop must never fire, so the file keeps its order.
        cy.reload();
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container g[data-et="participant"][data-id="A"]').then(($a) => {
          const a = ($a[0] as HTMLElement).getBoundingClientRect();
          const fromX = a.left + a.width / 2;
          const fromY = a.top + a.height / 2;
          cy.get('#diagram-container g[data-et="participant"][data-id="A"]')
            .trigger('mousedown', { button: 0, clientX: fromX, clientY: fromY });
          cy.get('body').trigger('mousemove', { clientX: fromX + 150, clientY: fromY + 40 });
          // the drag overlay is visible mid-drag
          cy.get('[data-testid="drag-overlay"]').should('exist');
          cy.get('body').type('{esc}');
          cy.get('[data-testid="drag-overlay"]').should('not.exist');
          cy.get('body').trigger('mouseup', { clientX: fromX + 150, clientY: fromY + 40 });
        });
        // no edit was committed: no auto-save POST follows the cancelled drag
        cy.wait(1500);
        readFile(name, dir).then((content) => {
          expect(content.indexOf('participant B as Bob')).to.be.lessThan(
            content.indexOf('participant A as Alice')
          );
        });
      });
  });
});
