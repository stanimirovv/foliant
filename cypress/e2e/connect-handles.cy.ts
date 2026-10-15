// Connect-handle e2e ("handles connect, body moves"): real mouse drags
// against the real rendered SVG in a real browser, verified through the real
// API (the saved .mmd file). Sequence: hovering an actor column reveals a
// fixed connect handle just below the top actor box; dragging from it creates
// a message, while dragging the lifeline body reorders the participant and can
// never create a message. Flowchart: hovering a node reveals four connect
// handles at the box edge midpoints; dragging from one onto another node
// creates an edge, while dragging the node body only moves it.
//
// Geometry is measured from the live DOM (getBoundingClientRect), never
// hard-coded: the SVG is scaled to fit the container, so absolute coordinates
// would be brittle. The overlays are viewport-fixed, so their coordinates live
// in the same space as getBoundingClientRect.

// Module scope: keeps these helpers out of the global script scope shared with
// the other spec files (tsc checks all of cypress/**).
export {};

const SEQ_CONTENT = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    A->>B: Hello
    B-->>C: Hi`;

// A TD branch: A on top, B and C side by side below. The side-by-side pair
// gives B and C distinct center X values, which the cross-axis reorder gesture
// (TD reorders along X) needs to be unambiguous.
const FLOW_CONTENT = `flowchart TD
    A[Alice]
    B[Bob]
    C[Charlie]
    A --> B
    A --> C`;

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// Waits for the debounced auto-save to complete (the indicator only renders
// once a save has actually run, so this cannot pass on a stale "Saved").
const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

interface Pt { x: number; y: number }

const rectOf = ($el: JQuery<HTMLElement>) =>
  ($el[0] as unknown as SVGElement).getBoundingClientRect();

// Hover the canvas at a viewport point (the hover affordances are geometric).
const hoverAt = (p: Pt) => {
  cy.get('#diagram-container').trigger('mousemove', { clientX: p.x, clientY: p.y });
};

// "translate(x, y)" -> { x, y }
const parseTranslate = (t: string | null | undefined): Pt => {
  const m = (t ?? '').match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: NaN, y: NaN };
};

// Creates a brand-new temp diagram through the real API and opens it in edit
// mode (edit mode is on by default when a diagram is opened).
const createAndVisit = (content: string, prefix: string) =>
  cy.task<string>('createTempDiagramDir').then((dir) => {
    const name = `${prefix}-${Date.now()}.mmd`;
    return cy
      .request('POST', fileApi(name, dir), { content })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('button[title="Exit edit mode"]').should('exist');
      })
      .then(() => ({ dir, name }));
  });

const getFileContent = (name: string, dir: string) =>
  cy.request(fileApi(name, dir)).then((res) => (res.body as { content: string }).content);

// Node group whose label contains the given text (real mermaid ids carry a
// random render prefix, so match by label, not by id suffix).
const nodeWithLabel = (label: string) =>
  cy.get('#diagram-container g.node').filter((i, el) => (el.textContent ?? '').includes(label));

describe('Connect handles (e2e)', () => {
  it('sequence: hover reveals a fixed connect handle; dragging it to another lifeline creates a message', () => {
    createAndVisit(SEQ_CONTENT, 'cypress-ch-seq-handle').then(({ dir, name }) => {
      cy.get('#diagram-container g[data-et="participant"]').should('have.length', 3);

      cy.get('g[data-et="participant"][data-id="A"]').then(($box) => {
        const box = rectOf($box);
        // The handle sits on the lifeline, 14px below the top actor box.
        const handlePt = { x: box.left + box.width / 2, y: box.bottom + 14 };

        // Hover the lifeline below the box: the handle appears at the fixed
        // spot, and the cursor hints grab (body) / crosshair (handle).
        hoverAt({ x: handlePt.x, y: box.bottom + 80 });
        cy.get('#diagram-container').should('have.css', 'cursor', 'grab');
        cy.get('[data-testid="sequence-connect-handle"]')
          .should('exist')
          .invoke('attr', 'transform')
          .then((t) => {
            const p = parseTranslate(t);
            expect(p.x).to.be.closeTo(handlePt.x, 1);
            expect(p.y).to.be.closeTo(handlePt.y, 1);
          });
        hoverAt(handlePt);
        cy.get('#diagram-container').should('have.css', 'cursor', 'crosshair');

        // Drag from the handle to B's lifeline, below the last message.
        cy.get('line.actor-line[data-id="B"]').then(($b) => {
          const b = rectOf($b);
          cy.get('#diagram-container text.messageText').eq(1).then(($msg) => {
            const msg = rectOf($msg);
            const target = { x: b.left + b.width / 2, y: msg.top + msg.height / 2 + 25 };

            // force: the lifeline is a zero-width line, invisible to Cypress's
            // visibility check — the event still targets the lifeline.
            cy.get('line.actor-line[data-id="A"]').trigger('mousedown', {
              button: 0, clientX: handlePt.x, clientY: handlePt.y, force: true,
            });
            cy.get('body').trigger('mousemove', { clientX: target.x, clientY: target.y });
            // Rubber band (starting at the grabbed handle) + insertion
            // indicator + snap highlight on B while dragging.
            cy.get('[data-testid="message-drag-line"]')
              .should('exist')
              .invoke('attr', 'x1')
              .then((x1) => expect(parseFloat(x1 as string)).to.be.closeTo(handlePt.x, 1));
            cy.get('[data-testid="message-drag-line"]')
              .invoke('attr', 'y1')
              .then((y1) => expect(parseFloat(y1 as string)).to.be.closeTo(handlePt.y, 1));
            cy.get('[data-testid="message-insert-indicator"]').should('exist');
            cy.get('[data-testid="target-lifeline-snap-rect"]').should('exist');
            cy.get('body').trigger('mouseup', { clientX: target.x, clientY: target.y });

            saved();
            getFileContent(name, dir).then((content) => {
              expect(content).to.contain('A->>B: New message');
            });
          });
        });
      });
    });
  });

  it('sequence: dragging connect handle to the line of the same actor creates a self-pointing arrow with placement in order', () => {
    createAndVisit(SEQ_CONTENT, 'cypress-ch-seq-self').then(({ dir, name }) => {
      cy.get('g[data-et="participant"][data-id="A"]').then(($box) => {
        const box = rectOf($box);
        const handlePt = { x: box.left + box.width / 2, y: box.bottom + 14 };

        cy.get('#diagram-container text.messageText').eq(1).then(($msg) => {
          const msg = rectOf($msg);
          // Target point on A's lifeline below the last message
          const target = { x: handlePt.x, y: msg.top + msg.height / 2 + 25 };

          cy.get('line.actor-line[data-id="A"]').trigger('mousedown', {
            button: 0, clientX: handlePt.x, clientY: handlePt.y, force: true,
          });
          cy.get('body').trigger('mousemove', { clientX: target.x, clientY: target.y });

          cy.get('[data-testid="message-drag-line"]').should('exist');
          cy.get('[data-testid="message-insert-indicator"]').should('exist');
          cy.get('[data-testid="target-lifeline-snap-rect"]').should('exist');
          cy.get('body').trigger('mouseup', { clientX: target.x, clientY: target.y });

          saved();
          getFileContent(name, dir).then((content) => {
            expect(content).to.contain('A->>A: New message');
          });
        });
      });
    });
  });

  it('sequence: dragging the lifeline body reorders the participant and never creates a message', () => {
    createAndVisit(SEQ_CONTENT, 'cypress-ch-seq-reorder').then(({ dir, name }) => {
      cy.get('rect.actor-bottom[name="A"]').then(($bottom) => {
        const bottom = rectOf($bottom);
        cy.get('line.actor-line[data-id="A"]').then(($line) => {
          const line = rectOf($line);
          // Press the lifeline near the bottom box — far from the connect
          // handle (top of the lifeline) and from every message endpoint.
          const from = { x: line.left + line.width / 2, y: bottom.top - 15 };
          cy.get('g[data-et="participant"][data-id="C"]').then(($c) => {
            const c = rectOf($c);
            // Drag A's lifeline past C's box: A moves to the end.
            const to = { x: c.right + 40, y: from.y };

            // force: the lifeline is a zero-width line, invisible to Cypress's
            // visibility check — the event still targets the lifeline.
            cy.get('line.actor-line[data-id="A"]').trigger('mousedown', {
              button: 0, clientX: from.x, clientY: from.y, force: true,
            });
            cy.get('body').trigger('mousemove', { clientX: to.x, clientY: to.y });
            cy.get('[data-testid="reorder-indicator"]').should('exist');
            // A reorder drag never shows a message rubber band.
            cy.get('[data-testid="message-drag-line"]').should('not.exist');
            cy.get('body').trigger('mouseup', { clientX: to.x, clientY: to.y });

            saved();
            getFileContent(name, dir).then((content) => {
              // Participant order is now B, C, A ...
              expect(content.indexOf('participant B')).to.be.lessThan(content.indexOf('participant C'));
              expect(content.indexOf('participant C')).to.be.lessThan(content.indexOf('participant A'));
              // ... and no message was created.
              expect(content).to.not.contain('New message');
              expect(content.match(/->>|-->>/g) ?? []).to.have.length(2);
            });
          });
        });
      });
    });
  });

  it('sequence: pressing empty space near a lifeline starts no drag and changes nothing', () => {
    createAndVisit(SEQ_CONTENT, 'cypress-ch-seq-empty').then(({ dir, name }) => {
      cy.get('rect.actor-bottom[name="A"]').then(($bottom) => {
        const bottom = rectOf($bottom);
        cy.get('line.actor-line[data-id="A"]').then(($line) => {
          const line = rectOf($line);
          // 12px to the right of the lifeline: in empty space (the press
          // targets the svg root, not the lifeline).
          const from = { x: line.left + line.width / 2 + 12, y: bottom.top - 15 };
          cy.get('line.actor-line[data-id="B"]').then(($b) => {
            const b = rectOf($b);
            const to = { x: b.left + b.width / 2, y: bottom.top - 15 };

            cy.get('#diagram-container svg').trigger('mousedown', {
              button: 0, clientX: from.x, clientY: from.y,
            });
            cy.get('body').trigger('mousemove', { clientX: to.x, clientY: to.y });
            // No drag overlay appears: message creation is handle-only.
            cy.get('[data-testid="drag-overlay"]').should('not.exist');
            cy.get('body').trigger('mouseup', { clientX: to.x, clientY: to.y });

            // Nothing was edited, so nothing is saved; the file is unchanged.
            cy.wait(1500); // past the 800 ms auto-save debounce
            getFileContent(name, dir).then((content) => {
              expect(content).to.eq(SEQ_CONTENT);
            });
          });
        });
      });
    });
  });

  it('flowchart: hover reveals four connect handles; dragging one onto another node creates an edge', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-ch-flow-connect').then(({ dir, name }) => {
      nodeWithLabel('Alice').then(($a) => {
        const a = rectOf($a);
        const center = { x: a.left + a.width / 2, y: a.top + a.height / 2 };

        hoverAt(center);
        cy.get('#diagram-container').should('have.css', 'cursor', 'grab');
        cy.get('[data-testid="node-connect-handle"]').should('have.length', 4);
        // Handles render top/right/bottom/left: the right one is at (right, centerY).
        cy.get('[data-testid="node-connect-handle"]').eq(1)
          .invoke('attr', 'transform')
          .then((t) => {
            const h = parseTranslate(t);
            expect(h.x).to.be.closeTo(a.right, 1);
            expect(h.y).to.be.closeTo(center.y, 1);

            const handlePt = { x: a.right, y: center.y };
            hoverAt(handlePt);
            cy.get('#diagram-container').should('have.css', 'cursor', 'crosshair');

            nodeWithLabel('Charlie').then(($c) => {
              const c = rectOf($c);
              const to = { x: c.left + c.width / 2, y: c.top + c.height / 2 };

              nodeWithLabel('Alice').trigger('mousedown', {
                button: 0, clientX: handlePt.x, clientY: handlePt.y,
              });
              cy.get('body').trigger('mousemove', { clientX: to.x, clientY: to.y });
              // Rubber band (starting at the grabbed handle) + snap highlight
              // on the target node while dragging.
              cy.get('[data-testid="message-drag-line"]')
                .should('exist')
                .invoke('attr', 'x1')
                .then((x1) => expect(parseFloat(x1 as string)).to.be.closeTo(handlePt.x, 1));
              cy.get('[data-testid="message-drag-line"]')
                .invoke('attr', 'y1')
                .then((y1) => expect(parseFloat(y1 as string)).to.be.closeTo(handlePt.y, 1));
              cy.get('[data-testid="target-lifeline-snap-rect"]').should('exist');
              cy.get('body').trigger('mouseup', { clientX: to.x, clientY: to.y });

              saved();
              getFileContent(name, dir).then((content) => {
                expect(content).to.contain('A -->|New message| C');
              });
            });
          });
      });
    });
  });

  it('flowchart: dragging a node body over another node moves it without creating an edge', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-ch-flow-move').then(({ dir, name }) => {
      nodeWithLabel('Bob').then(($b) => {
        const b = rectOf($b);
        const from = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        nodeWithLabel('Alice').then(($a) => {
          const a = rectOf($a);
          // Release over A's left half: B's declaration moves before A's.
          const to = { x: a.left + 10, y: a.top + a.height / 2 };

          nodeWithLabel('Bob').trigger('mousedown', {
            button: 0, clientX: from.x, clientY: from.y,
          });
          cy.get('body').trigger('mousemove', { clientX: to.x, clientY: to.y });
          // A body drag shows the reorder indicator — never an edge rubber band.
          cy.get('[data-testid="reorder-indicator"]').should('exist');
          cy.get('[data-testid="message-drag-line"]').should('not.exist');
          cy.get('body').trigger('mouseup', { clientX: to.x, clientY: to.y });

          saved();
          getFileContent(name, dir).then((content) => {
            // B's declaration moved before A's, A stays before C ...
            expect(content.indexOf('B[Bob]')).to.be.lessThan(content.indexOf('A[Alice]'));
            expect(content.indexOf('A[Alice]')).to.be.lessThan(content.indexOf('C[Charlie]'));
            // ... and no edge was created.
            expect(content).to.not.contain('New message');
            expect(content.match(/-->/g) ?? []).to.have.length(2);
          });
        });
      });
    });
  });
});
