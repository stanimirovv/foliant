// Sticky-note selection e2e — sticky notes (the floating cards persisted in
// %% CONFIG: under "notes") must join the same selection/tag/hide pipeline as
// actors, messages and mermaid notes: click selects, Shift+click multi-selects
// (and lists the note under "Tags by Element"), tags ride on the note's own
// CONFIG keys, and By Key Off hides the card. Runs against the real browser:
// real DOM cards, real shift-modified click events, real API persistence.

// Module scope: keeps these helpers out of the global script scope shared with
// the other spec files (tsc checks all of cypress/**).
export {};

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// A sequence diagram with one sticky note at visible canvas coordinates,
// carrying one pre-existing tag ('legacy') so the By Key filter has a key.
const STICKY_DIAGRAM = `%% CONFIG: {"version":1,"notes":[{"id":"note_abc","x":120,"y":80,"text":"Remember the token","color":"blue","keys":["legacy"]}]}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi`;

let counter = 0;
const setup = (content: string) => {
  let dir = '';
  let name = '';
  return cy.task<string>('createTempDiagramDir')
    .then((d) => {
      dir = d;
      name = `cypress-sticky-${Date.now()}-${counter++}.mmd`;
      return cy.request('POST', fileApi(name, dir), { content });
    })
    .then(() => {
      cy.visit(appUrl(name, dir));
      cy.get('[data-testid="sticky-note-note_abc"]', { timeout: 30000 }).should('exist');
    })
    .then(() => ({ dir, name }));
};

const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

const card = () => cy.get('[data-testid="sticky-note-note_abc"]');

describe('Sticky note selection (e2e)', () => {
  it('clicking the card selects it: ring + panel fields', () => {
    setup(STICKY_DIAGRAM).then(() => {
      card().click();
      card().should('have.attr', 'data-selected', 'true');
      card().should('have.class', 'ring-blue-500');
      // the panel shows the sticky-note fields with the note's text
      cy.get('[data-testid="sticky-note-text"]').should('have.value', 'Remember the token');
      cy.get('[data-testid="editor-panel"]').contains('note_abc').should('exist');
      // the pre-existing tag is listed
      cy.get('[data-testid="sticky-note-tag-chips"]').contains('legacy').should('exist');
    });
  });

  it('clicking empty space deselects the card', () => {
    setup(STICKY_DIAGRAM).then(() => {
      card().click();
      card().should('have.attr', 'data-selected', 'true');
      cy.get('#diagram-container').click(10, 10);
      card().should('not.have.attr', 'data-selected');
      cy.get('[data-testid="sticky-note-text"]').should('not.exist');
    });
  });

  it('shift-click card + participant opens the multi panel and lists the note under Tags by Element', () => {
    setup(STICKY_DIAGRAM).then(() => {
      card().click({ shiftKey: true });
      cy.get('#diagram-container g[data-et="participant"][data-id="B"]').click({ shiftKey: true });
      cy.contains('Selected Elements (2)').should('exist');
      // the sticky note appears in the Tags by Element menu
      cy.get('[data-testid="multi-element-sticky:note_abc"]').should('exist');
      cy.get('[data-testid="multi-element-sticky:note_abc"]').contains('sticky note: Remember the token').should('exist');
      cy.get('[data-testid="multi-element-sticky:note_abc"]').contains('legacy').should('exist');
      // both cards/elements carry the selection affordance
      card().should('have.attr', 'data-selected', 'true');
    });
  });

  it('shift-clicking a selected card again removes it from the multi-selection', () => {
    setup(STICKY_DIAGRAM).then(() => {
      card().click({ shiftKey: true });
      cy.get('#diagram-container g[data-et="participant"][data-id="B"]').click({ shiftKey: true });
      cy.contains('Selected Elements (2)').should('exist');
      card().click({ shiftKey: true });
      // back to a single selection: the multi panel is gone, the remaining
      // element (participant B) is selected on its own
      cy.contains('Selected Elements (2)').should('not.exist');
      cy.get('[data-testid="multi-element-sticky:note_abc"]').should('not.exist');
      cy.contains('label', 'Label').find('input').should('have.value', 'Bob');
      card().should('not.have.attr', 'data-selected');
    });
  });

  it('tags the sticky note from the multi panel and persists to CONFIG', () => {
    setup(STICKY_DIAGRAM).then(({ dir, name }) => {
      card().click({ shiftKey: true });
      cy.get('#diagram-container g[data-et="participant"][data-id="B"]').click({ shiftKey: true });
      cy.get('[data-testid="multi-add-tag-input"]').type('edge-case');
      cy.get('[data-testid="multi-add-tag"]').click();
      // the chip appears on the note's row in Tags by Element
      cy.get('[data-testid="multi-element-sticky:note_abc"]').contains('edge-case').should('exist');
      saved();
      // the file on disk carries the tag on the note's own keys
      cy.request(fileApi(name, dir)).then((res) => {
        const content = (res.body as { content: string }).content;
        expect(content).to.contain('"keys":["legacy","edge-case"]');
      });
    });
  });

  it('adds and removes a tag from the single-selection panel', () => {
    setup(STICKY_DIAGRAM).then(({ dir, name }) => {
      card().click();
      cy.get('[data-testid="sticky-note-add-tag-input"]').type('edge-case{enter}');
      cy.get('[data-testid="sticky-note-tag-chips"]').contains('edge-case').should('exist');
      saved();
      cy.request(fileApi(name, dir)).then((res) => {
        const content = (res.body as { content: string }).content;
        expect(content).to.contain('"keys":["legacy","edge-case"]');
      });
      // removing it drops the tag again (the note itself stays)
      cy.get('[data-testid="remove-sticky-note-tag-edge-case"]').click();
      cy.get('[data-testid="sticky-note-tag-chips"]').contains('edge-case').should('not.exist');
      cy.get('[data-testid="sticky-note-tag-chips"]').contains('legacy').should('exist');
      saved();
      cy.request(fileApi(name, dir)).then((res) => {
        const content = (res.body as { content: string }).content;
        expect(content).to.contain('"keys":["legacy"]');
      });
    });
  });

  it('edits text and color from the panel and persists both', () => {
    setup(STICKY_DIAGRAM).then(({ dir, name }) => {
      card().click();
      cy.get('[data-testid="sticky-note-text"]').clear().type('Updated thought');
      cy.get('[data-testid="sticky-note-text"]').blur();
      cy.get('[data-testid="sticky-note-color-green"]').click();
      card().should('have.class', 'bg-emerald-100');
      saved();
      cy.request(fileApi(name, dir)).then((res) => {
        const content = (res.body as { content: string }).content;
        expect(content).to.contain('"text":"Updated thought"');
        expect(content).to.contain('"color":"green"');
      });
    });
  });

  it('hides the card when its tag is Off in By Key and restores it with On', () => {
    setup(STICKY_DIAGRAM).then(() => {
      // the note's own tag shows up in the By Key filter
      cy.contains('By Key').parent().contains('li', 'legacy').contains('button', 'Off').click();
      cy.url().should('include', 'hide_key=legacy');
      card().should('not.exist');
      // the card is still selected-aware: turning the key back On restores it
      cy.contains('By Key').parent().contains('li', 'legacy').contains('button', 'On').click();
      cy.url().should('not.include', 'hide_key');
      card().should('exist');
    });
  });

  it('double-click still opens the inline editor; single click does not', () => {
    setup(STICKY_DIAGRAM).then(() => {
      card().click();
      // single click selected, but no inline editor appeared
      cy.get('[data-testid="sticky-note-textarea-note_abc"]').should('not.exist');
      // double-click on the body opens the textarea
      cy.get('[data-testid="sticky-note-note_abc"]').dblclick();
      cy.get('[data-testid="sticky-note-textarea-note_abc"]').should('have.value', 'Remember the token');
    });
  });
});
