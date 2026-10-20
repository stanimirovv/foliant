// Sequence notes e2e (SEQUENCE_NOTES_AND_BLOCKS.plan.md Step 8, E2E-N1…N10):
// first-class native notes — creation from the toolbar, placement/span/text
// editing from the panel, CONFIG tag retargeting, and delete-with-confirmation.
// Everything runs against brand-new temp diagrams created through the real API
// (never the committed demo fixtures) and asserts both the UI and the file on
// disk after the auto-save indicator settles.

// Module scope: keeps these helpers out of the global script scope shared with
// the other spec files (tsc checks all of cypress/**).
export {};

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// Waits for the debounced auto-save to complete.
const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

const readFile = (name: string, dir: string) =>
  cy.request(fileApi(name, dir)).then((res) => (res.body as { content: string }).content);

// Plan §5 baseline seed: participants, a message with an `activate` companion,
// a reply, and a spanning note.
const SEQ_BASE = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    activate B
    B-->>A: Hi
    Note over A,B: greeting`;

// A single-actor note (placement left of / right of is legal for it).
const SOLO_NOTE = `sequenceDiagram
    participant A
    participant B
    A->>B: Hello
    Note over A: Solo note
    B-->>A: Hi`;

// No participant lines: actors exist only implicitly through the messages.
const IMPLICIT_ACTORS = `sequenceDiagram
    A->>B: one
    B-->>A: two`;

// Two identical notes: editing the second must retarget its CONFIG tag to
// occurrence 1, never steal occurrence 0 from the untouched first note.
const DUP_NOTES = `sequenceDiagram
    participant A
    participant B
    A->>B: Hello
    Note over A: dup
    Note over A: dup`;

const FLOW_CONTENT = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A`;

let counter = 0;
const setup = (content: string) => {
  let dir = '';
  let name = '';
  return cy.task<string>('createTempDiagramDir')
    .then((d) => {
      dir = d;
      name = `cypress-seq-notes-${Date.now()}-${counter++}.mmd`;
      return cy.request('POST', fileApi(name, dir), { content });
    })
    .then(() => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg', { timeout: 30000 }).should('exist');
    })
    .then(() => ({ dir, name }));
};

// Clicks a message label by its text and selects it.
const clickMessage = (label: string, shift = false) =>
  cy.get('#diagram-container text.messageText').contains(label).click({ shiftKey: shift });

// Selects a note by its label text. force: true — for a single-actor note the
// label sits dead center on the lifeline, which paints above the note, so
// Cypress's coverage check refuses a plain click (the same geometry the
// note-shift-select spec works around); the event still dispatches on the
// note's text, which the svgmap resolves to the note.
const clickNote = (label: string) =>
  cy.get('#diagram-container g[data-et="note"] text').contains(label).click({ force: true });

describe('Sequence notes (e2e)', () => {
  it('E2E-N1: creates a note from the toolbar over the first participant', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      cy.get('[data-testid="add-sequence-note"]').click();
      // the new note renders and its fields open in the panel
      cy.get('#diagram-container g[data-et="note"]', { timeout: 10000 }).should('have.length', 2);
      cy.get('[data-testid="note-text"]', { timeout: 10000 }).should('have.value', 'New note');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note over A: New note');
      });
    });
  });

  it('E2E-N2: a selected message anchors the new note directly after it', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hi');
      cy.get('[data-testid="add-sequence-note"]').click();
      cy.get('[data-testid="note-text"]', { timeout: 10000 }).should('have.value', 'New note');
      cy.get('#diagram-container g[data-et="note"]').contains('New note').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        const lines = content.split('\n');
        const hiIdx = lines.findIndex((l) => l.includes('B-->>A: Hi'));
        expect(hiIdx).to.be.greaterThan(-1);
        expect(lines[hiIdx + 1]).to.contain('Note over A: New note');
      });
    });
  });

  it('E2E-N3: the new note hops over trailing activate/deactivate companion lines (N9)', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello');
      cy.get('[data-testid="add-sequence-note"]').click();
      cy.get('#diagram-container g[data-et="note"]').contains('New note').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        const lines = content.split('\n');
        const helloIdx = lines.findIndex((l) => l.includes('A->>B: Hello'));
        expect(helloIdx).to.be.greaterThan(-1);
        // the note lands AFTER `activate B`, never between the message and it
        expect(lines[helloIdx + 1]).to.contain('activate B');
        expect(lines[helloIdx + 2]).to.contain('Note over A: New note');
      });
    });
  });

  it('E2E-N4: edits the note text from the panel; the canvas label updates', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickNote('greeting');
      cy.get('[data-testid="note-text"]', { timeout: 10000 }).should('have.value', 'greeting');
      cy.get('[data-testid="note-text"]').clear().type('Contains: colon #hash').blur();
      // mermaid strips everything from `#` onward when rendering note text
      // (its `#`-directive syntax), so the canvas shows the prefix; the raw
      // file keeps the full text — asserted below.
      cy.get('#diagram-container g[data-et="note"]').contains('Contains: colon').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note over A,B: Contains: colon #hash');
      });
    });
  });

  it('E2E-N5: switches placement over → left of for a single-actor note', () => {
    setup(SOLO_NOTE).then(({ dir, name }) => {
      clickNote('Solo note');
      cy.get('[data-testid="note-placement"]', { timeout: 10000 })
        .should('not.be.disabled')
        .and('have.value', 'over');
      cy.get('[data-testid="note-placement"]').select('left of');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note left of A: Solo note');
        expect(content).to.not.contain('Note over A: Solo note');
      });
    });
  });

  it('E2E-N6: the placement select is disabled while the note spans two actors', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickNote('greeting');
      cy.get('[data-testid="note-placement"]', { timeout: 10000 })
        .should('be.disabled')
        .and('have.value', 'over');
      // nothing was edited: the file is byte-identical to the seed
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SEQ_BASE);
      });
    });
  });

  it('E2E-N7: edits the spanned actors via the span chips', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickNote('greeting');
      cy.get('[data-testid="note-span-chips"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="note-span-A"]').should('be.checked');
      cy.get('[data-testid="note-span-B"]').should('be.checked');
      // uncheck B → the note spans A only
      cy.get('[data-testid="note-span-B"]').click();
      cy.get('[data-testid="note-span-B"]').should('not.be.checked');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note over A: greeting');
        expect(content).to.not.contain('Note over A,B: greeting');
      });
      // re-check B → back to the two-actor span
      cy.get('[data-testid="note-span-B"]').click();
      cy.get('[data-testid="note-span-B"]').should('be.checked');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note over A,B: greeting');
      });
    });
  });

  it('E2E-N8: creates a note over the first implicit actor when no participants exist (N10)', () => {
    setup(IMPLICIT_ACTORS).then(({ dir, name }) => {
      cy.get('[data-testid="add-sequence-note"]').should('not.be.disabled').click();
      cy.get('[data-testid="note-text"]', { timeout: 10000 }).should('have.value', 'New note');
      // the span chips list the implicit actor ids
      cy.get('[data-testid="note-span-A"]').should('exist');
      cy.get('[data-testid="note-span-B"]').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note over A: New note');
      });
    });
  });

  it('E2E-N9: CONFIG note tags follow note edits, including duplicate-note occurrences (R-04, N8)', () => {
    setup(DUP_NOTES).then(({ dir, name }) => {
      // select the SECOND of the two identical notes and tag it (force: the
      // label sits on the lifeline, see clickNote)
      cy.get('#diagram-container g[data-et="note"]').last().find('text').click({ force: true });
      cy.get('[data-testid="note-text"]', { timeout: 10000 }).should('have.value', 'dup');
      cy.get('[data-testid="note-add-tag-input"]').type('k1{enter}');
      cy.get('[data-testid="note-tag-chips"]').contains('k1').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        // the tag landed on the SECOND of the two identical notes
        expect(content).to.contain('"keys":["k1"]');
        expect(content).to.contain('"occurrence":1');
      });

      // edit the tagged note's text — the tag must follow the edited note
      cy.get('[data-testid="note-text"]').clear().type('edited text').blur();
      cy.get('#diagram-container g[data-et="note"]').contains('edited text').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('Note over A: edited text');
        expect(content).to.contain('"text":"edited text"');
        expect(content).to.contain('"keys":["k1"]');
        // the two notes no longer match, so the occurrence disambiguator is
        // no longer needed and is dropped (occurrence 0 is omitted)
        expect(content).to.not.contain('"occurrence"');
      });

      // reload: the tag chip is still on the edited note
      cy.reload();
      cy.get('#diagram-container svg', { timeout: 30000 }).should('exist');
      cy.get('#diagram-container g[data-et="note"]').last().find('text').click({ force: true });
      cy.get('[data-testid="note-tag-chips"]', { timeout: 10000 }).contains('k1').should('exist');
    });
  });

  it('E2E-N10: deletes a note with confirmation (panel button and Delete key); undo restores it', () => {
    setup(SOLO_NOTE).then(({ dir, name }) => {
      clickNote('Solo note');
      cy.get('[data-testid="note-text"]', { timeout: 10000 }).should('have.value', 'Solo note');

      // the Delete key opens the same confirm dialog as the panel button
      cy.get('body').type('{del}');
      cy.get('[data-testid="delete-dialog"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="delete-dialog"]').contains('note over A: Solo note').should('exist');
      cy.get('[data-testid="delete-dialog"]').contains('button', 'Cancel').click();
      cy.get('#diagram-container g[data-et="note"]').should('have.length', 1);

      // the panel Delete button → confirm removes the note from canvas + file
      cy.get('[data-testid="panel-delete"]').click();
      cy.get('[data-testid="confirm-delete"]').click();
      cy.get('#diagram-container g[data-et="note"]').should('not.exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.not.contain('Solo note');
        expect(content).to.contain('A->>B: Hello');
      });

      // undo restores the note byte-identically
      cy.get('body').type('{ctrl}z');
      cy.get('#diagram-container g[data-et="note"]').contains('Solo note').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SOLO_NOTE);
      });
    });
  });

  it('regression guard: flowcharts have no Note toolbar button (NFR-03)', () => {
    setup(FLOW_CONTENT).then(() => {
      cy.get('#diagram-container g.node', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="add-sequence-note"]').should('not.exist');
    });
  });
});
