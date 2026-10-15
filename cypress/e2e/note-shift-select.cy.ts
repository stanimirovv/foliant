// Note shift-select e2e — regression for "I can't select the note with shift
// select". Runs against the real browser: real hit-testing, real SVG
// geometry, real shift-modified click events.
//
// Root cause being covered: mermaid paints participant lifelines ABOVE notes,
// so a click on a note where a lifeline crosses it (for "Note over A" that
// is dead center, right through the label) targets the lifeline. The app must
// resolve such clicks to the note, not the participant.

// Module scope: keeps these helpers out of the global script scope shared with
// the other spec files (tsc checks all of cypress/**).
export {};

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// Note over a single participant: the participant's lifeline crosses the
// note dead center, right through the label.
const SOLO_NOTE = `sequenceDiagram
    participant A
    participant B
    A->>B: Hello
    Note over A: Solo note
    B-->>A: Hi`;

// Note spanning two participants (editing-demo style).
const SPAN_NOTE = `sequenceDiagram
    participant C as Client
    participant API as API Gateway
    participant Auth as Auth Service
    C->>API: POST /login
    API->>Auth: Validate Credentials
    Auth-->>API: JWT Token
    Note over C,API: Demo diagram for visual editing
    API-->>C: 200 OK`;

let counter = 0;
const setup = (content: string) => {
  let dir = '';
  let name = '';
  return cy.task<string>('createTempDiagramDir')
    .then((d) => {
      dir = d;
      name = `cypress-note-shift-${Date.now()}-${counter++}.mmd`;
      return cy.request('POST', fileApi(name, dir), { content });
    })
    .then(() => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container g[data-et="note"]', { timeout: 30000 }).should('exist');
    });
};

const notePanel = () =>
  cy.get('[data-testid="note-add-tag-input"]', { timeout: 10000 }).should('exist');

// Shift-clicks participant A's lifeline at the note's vertical center — the
// exact point a user hits when clicking the middle of a "Note over A" (the
// lifeline paints above the note, so the browser targets the lifeline). The
// lifeline is 0.5px wide, so Cypress's visibility check needs force: true;
// the event still dispatches on the lifeline at the note-center coordinates,
// which is exactly what a real user's click produces there.
const shiftClickLifelineAtNoteCenter = () => {
  cy.get('#diagram-container g[data-et="note"] rect').then(($rect) => {
    const r = $rect[0].getBoundingClientRect();
    const noteCenterY = r.top + r.height / 2;
    cy.get('#diagram-container line.actor-line[data-id="A"]').then(($ll) => {
      const lb = $ll[0].getBoundingClientRect();
      cy.get('#diagram-container line.actor-line[data-id="A"]')
        .click(lb.width / 2, noteCenterY - lb.top, { shiftKey: true, force: true });
    });
  });
};

describe('Note shift-select (e2e)', () => {
  it('shift-click a note where a lifeline crosses it (the note center) selects the note', () => {
    setup(SOLO_NOTE).then(() => {
      shiftClickLifelineAtNoteCenter();
      notePanel();
      cy.get('[data-testid="editor-panel"]').contains('Solo note');
      cy.get('.editor-selected').should('have.length', 1);
    });
  });

  it('shift-click a note away from the lifeline selects the note', () => {
    setup(SOLO_NOTE).then(() => {
      // 15px from the rect's top-left corner: inside the note, off the lifeline
      cy.get('#diagram-container g[data-et="note"] rect').click(15, 15, { shiftKey: true });
      notePanel();
      cy.get('.editor-selected').should('have.length', 1);
    });
  });

  it('shift-click a note label away from the lifeline selects the note', () => {
    setup(SOLO_NOTE).then(() => {
      cy.get('#diagram-container g[data-et="note"] text').then(($text) => {
        const b = $text[0].getBoundingClientRect();
        // 20% into the label ("Solo note"): over the first word, clear of
        // the lifeline that crosses the label's center
        cy.get('#diagram-container g[data-et="note"] text')
          .click(b.width * 0.2, b.height / 2, { shiftKey: true });
      });
      notePanel();
      cy.get('.editor-selected').should('have.length', 1);
    });
  });

  it('shift-click note (lifeline crossing) + message joins the multi-selection', () => {
    setup(SOLO_NOTE).then(() => {
      shiftClickLifelineAtNoteCenter();
      cy.get('#diagram-container text.messageText').first().click({ shiftKey: true });
      cy.contains('Selected Elements (2)').should('exist');
      cy.get('.editor-selected').should('have.length', 2);
    });
  });

  it('shift-click a spanning note (over two participants) selects the note', () => {
    setup(SPAN_NOTE).then(() => {
      cy.get('#diagram-container g[data-et="note"] text').click({ shiftKey: true });
      notePanel();
      cy.get('[data-testid="editor-panel"]').contains('Demo diagram for visual editing');
      cy.get('.editor-selected').should('have.length', 1);
    });
  });

  it('shift-click spanning note + message joins the multi-selection', () => {
    setup(SPAN_NOTE).then(() => {
      cy.get('#diagram-container g[data-et="note"] text').click({ shiftKey: true });
      cy.get('#diagram-container text.messageText').first().click({ shiftKey: true });
      cy.contains('Selected Elements (2)').should('exist');
      cy.get('.editor-selected').should('have.length', 2);
    });
  });

  it('a shift-selected note can be tagged from the panel', () => {
    setup(SOLO_NOTE).then(() => {
      shiftClickLifelineAtNoteCenter();
      notePanel();
      cy.get('[data-testid="note-add-tag-input"]').type('edge-case');
      cy.get('[data-testid="note-add-tag"]').click();
      cy.get('[data-testid="note-tag-chips"]').contains('edge-case').should('exist');
      // debounced auto-save persists the CONFIG noteTags entry
      cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');
    });
  });
});
