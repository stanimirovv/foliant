// Sequence blocks e2e (SEQUENCE_NOTES_AND_BLOCKS.plan.md Step 8, E2E-B1…B10):
// wrap-in-block / wrap-in-region (with the W1/W2/W8/W9 refusals), block
// selection via the label box, title/type editing, unwrap, delete-with-content
// cascade, undo round trip, and persistence across reload. Everything runs
// against brand-new temp diagrams created through the real API (never the
// committed demo fixtures) and asserts both the UI and the file on disk after
// the auto-save indicator settles.

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

// Plan §5 baseline seed.
const SEQ_BASE = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    activate B
    B-->>A: Hi
    Note over A,B: greeting`;

// Plan §5 SEQ_ALT: an alt with two arms around two messages.
const SEQ_ALT = `sequenceDiagram
    participant A
    participant B
    A->>B: ping
    alt success
        B-->>A: ok
    else failure
        B-->>A: error
    end
    A->>B: done`;

// An alt-with-else plus a plain loop (for convert/rename/unwrap/delete).
const ALT_AND_LOOP = `sequenceDiagram
    participant A
    participant B
    alt success
        B-->>A: ok
    else failure
        B-->>A: error
    end
    loop retry
        A->>B: work
        B-->>A: ack
    end`;

// An existing region between three messages (for the W9 refusal).
const WITH_REGION = `sequenceDiagram
    participant A
    participant B
    %% @region-start: existing
    A->>B: one
    A->>B: two
    %% @region-end
    A->>B: three`;

const FLOW_CONTENT = `flowchart TD
    A[Alice] --> B[Bob]
    C[Charlie]
    A --> B`;

let counter = 0;
const setup = (content: string) => {
  let dir = '';
  let name = '';
  return cy.task<string>('createTempDiagramDir')
    .then((d) => {
      dir = d;
      name = `cypress-seq-blocks-${Date.now()}-${counter++}.mmd`;
      return cy.request('POST', fileApi(name, dir), { content });
    })
    .then(() => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg', { timeout: 30000 }).should('exist');
    })
    .then(() => ({ dir, name }));
};

// Clicks a message label by its text (shift adds it to the selection).
const clickMessage = (label: string, shift = false) =>
  cy.get('#diagram-container text.messageText').contains(label).click({ shiftKey: shift });

// Clicks a control-structure block's label box (index 0 = first in source
// order). The svgmap resolves the label-box click to the block element (B1).
const clickBlockLabel = (index: number) =>
  cy.get('#diagram-container g[data-et="control-structure"] polygon.labelBox')
    .eq(index)
    .then(($box) => {
      const r = $box[0].getBoundingClientRect();
      cy.wrap($box).click(r.width / 2, r.height / 2, { force: true });
    });

describe('Sequence blocks (e2e)', () => {
  it('E2E-B1: wraps two shift-selected messages in a loop block', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello', true);
      clickMessage('Hi', true);
      cy.get('[data-testid="wrap-block-button"]', { timeout: 10000 })
        .should('contain.text', 'Wrap in Block (2 elements)')
        .and('not.be.disabled');
      cy.get('[data-testid="wrap-block-type"]').select('loop');
      cy.get('[data-testid="wrap-block-title"]').type('retry');
      cy.get('[data-testid="wrap-block-button"]').click();

      // the frame renders with its label, and the new block is selected
      cy.get('#diagram-container g[data-et="control-structure"]', { timeout: 10000 }).should('exist');
      cy.get('#diagram-container text.loopText').contains('retry').should('exist');
      cy.get('[data-testid="block-title"]', { timeout: 10000 }).should('have.value', 'retry');

      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('loop retry');
        // content indented +4, companion line absorbed, note untouched
        expect(content).to.contain('        A->>B: Hello');
        expect(content).to.contain('        activate B');
        expect(content).to.contain('        B-->>A: Hi');
        expect(content).to.match(/^\s*end\s*$/m);
        expect(content).to.contain('    Note over A,B: greeting');
      });
    });
  });

  it('E2E-B2: wraps the selection in a rect block with the default color (W11)', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello', true);
      clickMessage('Hi', true);
      cy.get('[data-testid="wrap-block-button"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="wrap-block-type"]').select('rect');
      // rect swaps the title input for a color input defaulting to rgb(...)
      cy.get('[data-testid="wrap-block-title"]').should('not.exist');
      cy.get('[data-testid="wrap-block-color"]').should('have.value', 'rgb(200,150,255)');
      cy.get('[data-testid="wrap-block-button"]').click();

      // the frame is tinted on the canvas
      cy.get('#diagram-container rect.rect', { timeout: 10000 }).should('exist');
      cy.get('#diagram-container rect.rect').then(($rect) => {
        const fill = ($rect[0].getAttribute('fill') ?? '').replace(/\s+/g, '');
        expect(fill).to.contain('rgb(200,150,255)');
      });

      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('rect rgb(200,150,255)');
      });
    });
  });

  it('E2E-B3: refuses a non-contiguous selection with the reason shown (W1)', () => {
    setup(SEQ_ALT).then(({ dir, name }) => {
      clickMessage('ping', true);
      clickMessage('done', true);
      cy.get('[data-testid="wrap-block-button"]', { timeout: 10000 })
        .should('be.disabled')
        .and('contain.text', 'Wrap in Block (2 elements)');
      cy.get('[data-testid="wrap-reason"]').should('contain.text', 'not contiguous');
      // attempting the wrap changes nothing
      cy.get('[data-testid="wrap-block-button"]').click({ force: true });
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SEQ_ALT);
      });
    });
  });

  it('E2E-B4: refuses a selection across the two alt arms (W2)', () => {
    setup(SEQ_ALT).then(({ dir, name }) => {
      clickMessage('ok', true);
      clickMessage('error', true);
      cy.get('[data-testid="wrap-block-button"]', { timeout: 10000 }).should('be.disabled');
      cy.get('[data-testid="wrap-reason"]').should('contain.text', 'else');
      cy.get('[data-testid="wrap-block-button"]').click({ force: true });
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SEQ_ALT);
      });
    });
  });

  it('E2E-B5: wraps the selection in a %% @region; hiding the region hides the messages (W10)', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello', true);
      clickMessage('Hi', true);
      cy.get('[data-testid="wrap-region-button"]', { timeout: 10000 }).should('not.be.disabled');
      cy.get('[data-testid="wrap-region-type"]').clear().type('flow');
      cy.get('[data-testid="wrap-region-value"]').type('auth');
      cy.get('[data-testid="wrap-region-button"]').click();

      // the tags land in the raw file around byte-identical content
      saved();
      readFile(name, dir).then((content) => {
        const startIdx = content.indexOf('%% @region-start: flow=auth');
        const endIdx = content.indexOf('%% @region-end');
        expect(startIdx).to.be.greaterThan(-1);
        expect(endIdx).to.be.greaterThan(startIdx);
        const inside = content.slice(startIdx, endIdx);
        expect(inside).to.contain('    A->>B: Hello');
        expect(inside).to.contain('    B-->>A: Hi');
        // the note outside the region is untouched
        expect(content).to.contain('    Note over A,B: greeting');
      });

      // the region shows up in the Filters tree; unchecking it hides the
      // wrapped messages (the note outside the region stays)
      cy.contains('label', 'flow=auth', { timeout: 10000 })
        .find('input[type="checkbox"]')
        .uncheck();
      cy.get('#diagram-container').contains('Hello').should('not.exist');
      cy.get('#diagram-container').contains('Hi').should('not.exist');
      cy.get('#diagram-container').contains('greeting').should('exist');

      // checking it again brings the messages back
      cy.contains('label', 'flow=auth').find('input[type="checkbox"]').check();
      cy.get('#diagram-container').contains('Hello').should('exist');
      cy.get('#diagram-container').contains('Hi').should('exist');
    });
  });

  it('E2E-B6: validates region names (W8); an empty value is a bare region', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello', true);
      clickMessage('Hi', true);
      cy.get('[data-testid="wrap-region-button"]', { timeout: 10000 }).should('exist');

      // invalid type → refused with a warning, file unchanged
      cy.get('[data-testid="wrap-region-type"]').clear().type('bad type!');
      cy.get('[data-testid="wrap-region-button"]').click();
      cy.get('[data-testid="editor-panel"]')
        .contains('Region type must be non-empty', { timeout: 10000 })
        .should('exist');
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SEQ_BASE);
      });

      // invalid value → refused with a warning, file unchanged
      cy.get('[data-testid="wrap-region-type"]').clear().type('flow');
      cy.get('[data-testid="wrap-region-value"]').type('bad value!');
      cy.get('[data-testid="wrap-region-button"]').click();
      cy.get('[data-testid="editor-panel"]')
        .contains('Region value must use only letters, digits, _ and -', { timeout: 10000 })
        .should('exist');
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SEQ_BASE);
      });

      // empty value with a valid type → a bare region
      cy.get('[data-testid="wrap-region-value"]').clear();
      cy.get('[data-testid="wrap-region-button"]').click();
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('%% @region-start: flow\n');
        expect(content).to.contain('%% @region-end');
      });
    });
  });

  it('E2E-B6b: refuses a region wrap spanning an existing %% @region-end (W9)', () => {
    setup(WITH_REGION).then(({ dir, name }) => {
      // select all three messages: the span contains the existing @region-end
      clickMessage('one', true);
      clickMessage('two', true);
      clickMessage('three', true);
      cy.get('[data-testid="wrap-region-button"]', { timeout: 10000 }).should('be.disabled');
      cy.get('[data-testid="wrap-region-reason"]').should('contain.text', '@region-end');
      readFile(name, dir).then((content) => {
        expect(content).to.equal(WITH_REGION);
      });
    });
  });

  it('E2E-B7: selects the block via its label box; a message inside still selects the message (B1)', () => {
    setup(SEQ_ALT).then(() => {
      clickBlockLabel(0);
      cy.get('[data-testid="block-title"]', { timeout: 10000 }).should('have.value', 'success');
      cy.get('[data-testid="block-type"]').should('have.value', 'alt');
      // clicking a message inside the frame selects the message, not the block
      clickMessage('ok');
      cy.contains('label', 'Label').find('input').should('have.value', 'ok');
    });
  });

  it('E2E-B8: convert refusal (B5), rename, convert, unwrap, delete-with-content cascade', () => {
    setup(ALT_AND_LOOP).then(({ dir, name }) => {
      // the alt has an else: converting it to opt is refused with a warning
      clickBlockLabel(0);
      cy.get('[data-testid="block-title"]', { timeout: 10000 }).should('have.value', 'success');
      cy.get('[data-testid="block-type"]').select('opt');
      cy.get('[data-testid="editor-panel"]')
        .contains('else/and separator', { timeout: 10000 })
        .should('exist');
      readFile(name, dir).then((content) => {
        expect(content).to.contain('alt success');
      });

      // the plain loop: rename the title (canvas label follows)
      clickBlockLabel(1);
      cy.get('[data-testid="block-title"]', { timeout: 10000 }).should('have.value', 'retry');
      cy.get('[data-testid="block-title"]').clear().type('retry all').blur();
      cy.get('#diagram-container text.loopText').contains('retry all').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('loop retry all');
      });

      // convert loop → opt (no else: allowed)
      cy.get('[data-testid="block-type"]').select('opt');
      cy.get('#diagram-container text.labelText').contains('opt').should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('opt retry all');
      });

      // unwrap: frame gone, content intact and de-indented, alt untouched
      cy.get('[data-testid="block-unwrap"]').click();
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.not.contain('opt retry all');
        expect(content).to.contain('    A->>B: work');
        expect(content).to.contain('    B-->>A: ack');
        expect(content).to.contain('alt success');
        expect(content).to.contain('else failure');
      });
      cy.get('#diagram-container g[data-et="control-structure"]').should('have.length', 1);

      // tag a message inside the alt, then delete the block with its content:
      // the dialog lists the contained messages and the CONFIG tag is pruned
      clickMessage('ok');
      cy.get('input[placeholder="Add tag..."]').type('k1{enter}');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('"keys":["k1"]');
      });

      clickBlockLabel(0);
      cy.get('[data-testid="panel-delete"]', { timeout: 10000 }).click();
      cy.get('[data-testid="delete-dialog"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="delete-dialog"]').contains('message B -->> A: ok').should('exist');
      cy.get('[data-testid="delete-dialog"]').contains('message B -->> A: error').should('exist');
      cy.get('[data-testid="confirm-delete"]').click();

      cy.get('#diagram-container g[data-et="control-structure"]').should('not.exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.not.contain('B-->>A: ok');
        expect(content).to.not.contain('B-->>A: error');
        expect(content).to.not.contain('alt success');
        expect(content).to.not.contain('"keys":["k1"]');
        expect(content).to.contain('A->>B: work');
        expect(content).to.contain('B-->>A: ack');
      });
    });
  });

  it('E2E-B9: undo after a wrap restores the pre-wrap bytes; redo reapplies (W14)', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello', true);
      clickMessage('Hi', true);
      cy.get('[data-testid="wrap-block-button"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="wrap-block-type"]').select('loop');
      cy.get('[data-testid="wrap-block-title"]').type('retry');
      cy.get('[data-testid="wrap-block-button"]').click();
      cy.get('#diagram-container g[data-et="control-structure"]', { timeout: 10000 }).should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('loop retry');
      });

      // undo → byte-identical to the seed
      cy.get('body').type('{ctrl}z');
      cy.get('#diagram-container g[data-et="control-structure"]').should('not.exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.equal(SEQ_BASE);
      });

      // redo → the block returns
      cy.get('body').type('{ctrl}{shift}z');
      cy.get('#diagram-container g[data-et="control-structure"]', { timeout: 10000 }).should('exist');
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('loop retry');
      });
    });
  });

  it('E2E-B10: a wrapped block persists across reload (frame, selection, editing)', () => {
    setup(SEQ_BASE).then(({ dir, name }) => {
      clickMessage('Hello', true);
      clickMessage('Hi', true);
      cy.get('[data-testid="wrap-block-button"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="wrap-block-type"]').select('loop');
      cy.get('[data-testid="wrap-block-title"]').type('retry');
      cy.get('[data-testid="wrap-block-button"]').click();
      cy.get('#diagram-container g[data-et="control-structure"]', { timeout: 10000 }).should('exist');
      saved();

      // reload: the frame renders from the persisted file
      cy.reload();
      cy.get('#diagram-container g[data-et="control-structure"]', { timeout: 30000 }).should('exist');
      cy.get('#diagram-container text.loopText').contains('retry').should('exist');

      // the block is still selectable via its label and editable
      clickBlockLabel(0);
      cy.get('[data-testid="block-title"]', { timeout: 10000 }).should('have.value', 'retry');
      cy.get('[data-testid="block-title"]').clear().type('persisted').blur();
      saved();
      readFile(name, dir).then((content) => {
        expect(content).to.contain('loop persisted');
      });
    });
  });

  it('regression guard: flowcharts have no wrap sections (NFR-03)', () => {
    setup(FLOW_CONTENT).then(() => {
      const nodeWithLabel = (label: string) =>
        cy.get('#diagram-container g.node').filter((i, el) => (el.textContent ?? '').includes(label));
      nodeWithLabel('Alice').click();
      nodeWithLabel('Bob').click({ shiftKey: true });
      // the subgraph grouping shows, the sequence-only wrap sections do not
      cy.get('[data-testid="group-subgraph-button"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="wrap-block-button"]').should('not.exist');
      cy.get('[data-testid="wrap-region-button"]').should('not.exist');
    });
  });
});
