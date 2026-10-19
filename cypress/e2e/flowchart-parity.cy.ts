// Flowchart parity (e2e): two features the sequence diagram editor already
// had, now for flowcharts —
//   1. Edge endpoint retargeting: a selected flowchart edge shows head/tail
//      drag handles; dragging one onto another node rewrites the edge's
//      endpoint (moveEdgeEndpoint), splitting chained lines so the rest of
//      the chain stays intact.
//   2. Subgraph grouping: Shift-selecting 2+ flowchart nodes enables
//      "Group into Subgraph" in the multi-selection panel, wrapping the
//      nodes' declarations in a `subgraph <title> ... end` block and feeding
//      the zero-config subgraph tag pipeline (an inherited tag chip appears).
//
// Everything is verified through the real API (the saved .mmd file), with
// geometry measured from the live DOM — never hard-coded coordinates.

// Module scope: keeps these helpers out of the global script scope shared with
// the other spec files (tsc checks all of cypress/**).
export {};

// A TD flowchart: A on top, B and C side by side below, D further down. The
// A --> B edge is diagonal, so its endpoints sit clear of the connect handles
// at the box edge midpoints.
const FLOW_CONTENT = `flowchart TD
    A[Alice]
    B[Bob]
    C[Charlie]
    D[Dave]
    A --> B`;

// A chained edge line: retargeting one link must split the chain, keeping the
// other link byte-identical.
const CHAIN_CONTENT = `flowchart TD
    A --> B --> C
    D[Dave]`;

// Nodes declared standalone (their declaration lines move into the subgraph).
const STANDALONE_NODES = `flowchart TD
    A[Alice]
    B[Bob]
    C[Charlie]
    A --> B`;

// Nodes first declared on an edge line (the group inserts declarations and
// leaves the edge line untouched).
const EDGE_DECLARED_NODES = `flowchart TD
    A[Alice] --> B[Bob]
    C[Charlie]`;

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

// Clicks the edge with the given data-id (e.g. "L_A_B_0") through its
// invisible hit band: the click lands on the path's bbox center, inside the
// 12px hit path that addEdgeHitPaths injected above the visible stroke.
const clickEdge = (dataId: string) => {
  cy.get(`#diagram-container path[data-et="edge"][data-id="${dataId}"]`).then(($path) => {
    const r = rectOf($path);
    const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    cy.get('#diagram-container').then(($c) => {
      const c = $c[0].getBoundingClientRect();
      cy.get('#diagram-container').click(p.x - c.left, p.y - c.top);
    });
  });
};

// Viewport coordinates of one of the selected edge's drag handles.
const handlePoint = (testId: string) =>
  cy.get(`[data-testid="${testId}"]`)
    .invoke('attr', 'cx')
    .then((cx) =>
      cy.get(`[data-testid="${testId}"]`)
        .invoke('attr', 'cy')
        .then((cy) => ({ x: parseFloat(cx as string), y: parseFloat(cy as string) })),
    );

// Drags from a point to another point: press on the canvas at `from`, move to
// `to`, release. Asserts the endpoint-drag overlay (drag line + snap rect)
// while over a valid target node.
const dragEndpoint = (from: Pt, to: Pt, expectSnap: boolean) => {
  cy.get('#diagram-container').trigger('mousedown', {
    button: 0, clientX: from.x, clientY: from.y,
  });
  cy.get('body').trigger('mousemove', { clientX: to.x, clientY: to.y });
  cy.get('[data-testid="endpoint-drag-line"]').should('exist');
  if (expectSnap) {
    cy.get('[data-testid="endpoint-snap-rect"]').should('exist');
  } else {
    cy.get('[data-testid="endpoint-snap-rect"]').should('not.exist');
  }
  cy.get('body').trigger('mouseup', { clientX: to.x, clientY: to.y });
};

const centerOfNode = (label: string) =>
  nodeWithLabel(label).then(($n) => {
    const r = rectOf($n);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

describe('Flowchart edge endpoint retargeting (e2e)', () => {
  it('shows head/tail handles on the selected edge; dragging the head onto another node retargets the edge', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-parity-retarget-head').then(({ dir, name }) => {
      // No handles before the edge is selected.
      cy.get('[data-testid="selected-edge-handles"]').should('not.exist');

      clickEdge('L_A_B_0');
      cy.get('[data-testid="selected-edge-handles"]').should('exist');
      cy.get('[data-testid="edge-tail-handle"]').should('exist');
      cy.get('[data-testid="edge-head-handle"]').should('exist');

      handlePoint('edge-head-handle').then((head) => {
        centerOfNode('Dave').then((dave) => {
          dragEndpoint(head, dave, true);

          saved();
          getFileContent(name, dir).then((content) => {
            expect(content).to.contain('A --> D');
            expect(content).to.not.contain('A --> B');
            // The retargeted edge stays selected (handles still rendered).
            cy.get('[data-testid="selected-edge-handles"]').should('exist');
          });
        });
      });
    });
  });

  it('dragging the tail onto another node retargets the origin', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-parity-retarget-tail').then(({ dir, name }) => {
      clickEdge('L_A_B_0');
      cy.get('[data-testid="selected-edge-handles"]').should('exist');

      handlePoint('edge-tail-handle').then((tail) => {
        centerOfNode('Charlie').then((charlie) => {
          dragEndpoint(tail, charlie, true);

          saved();
          getFileContent(name, dir).then((content) => {
            expect(content).to.contain('C --> B');
            expect(content).to.not.contain('A --> B');
          });
        });
      });
    });
  });

  it('retargeting one link of a chained edge line splits the chain and keeps the other link intact', () => {
    createAndVisit(CHAIN_CONTENT, 'cypress-parity-retarget-chain').then(({ dir, name }) => {
      // Select the FIRST link (A --> B) of the chained line A --> B --> C.
      clickEdge('L_A_B_0');
      cy.get('[data-testid="selected-edge-handles"]').should('exist');

      handlePoint('edge-head-handle').then((head) => {
        centerOfNode('Dave').then((dave) => {
          dragEndpoint(head, dave, true);

          saved();
          getFileContent(name, dir).then((content) => {
            // The chain split: the retargeted link points at D, the second
            // link is untouched (B --> C), and the original single line is gone.
            expect(content).to.contain('A --> D');
            expect(content).to.contain('B --> C');
            expect(content).to.not.contain('A --> B --> C');
            const lines = content.split('\n');
            expect(lines.indexOf('    A --> D')).to.be.lessThan(lines.indexOf('    B --> C'));
          });
        });
      });
    });
  });

  it('releasing the head over empty space cancels the retarget (file unchanged)', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-parity-retarget-cancel').then(({ dir, name }) => {
      clickEdge('L_A_B_0');
      cy.get('[data-testid="selected-edge-handles"]').should('exist');

      handlePoint('edge-head-handle').then((head) => {
        // The container's top-left corner: empty canvas, far from every node
        // (the SVG is centered with padding).
        cy.get('#diagram-container').then(($c) => {
          const c = $c[0].getBoundingClientRect();
          dragEndpoint(head, { x: c.left + 30, y: c.top + 30 }, false);

          // Nothing was edited, so nothing is saved; the file is unchanged.
          cy.wait(1500); // past the 800 ms auto-save debounce
          getFileContent(name, dir).then((content) => {
            expect(content).to.eq(FLOW_CONTENT);
          });
        });
      });
    });
  });
});

describe('Flowchart subgraph grouping (e2e)', () => {
  it('shift-selecting 2+ nodes enables "Group into Subgraph" and wraps their declarations in a subgraph block', () => {
    createAndVisit(STANDALONE_NODES, 'cypress-parity-subgraph-standalone').then(({ dir, name }) => {
      nodeWithLabel('Alice').click();
      nodeWithLabel('Bob').click({ shiftKey: true });
      cy.contains('Selected Elements (2)').should('exist');

      // The sequence-only "Group into Box" section stays hidden for nodes.
      cy.get('[data-testid="group-box-button"]').should('not.exist');
      cy.get('[data-testid="group-subgraph-title"]').should('exist');

      cy.get('[data-testid="group-subgraph-title"]').clear().type('Core Services');
      cy.get('[data-testid="group-subgraph-button"]').click();

      saved();
      getFileContent(name, dir).then((content) => {
        expect(content).to.eq(`flowchart TD
    subgraph Core Services
        A[Alice]
        B[Bob]
    end
    C[Charlie]
    A --> B`);
      });
      // The zero-config subgraph tag pipeline: the grouped nodes carry the
      // kebab-case title as an inherited (read-only) tag — no CONFIG written.
      cy.get('[data-testid="editor-panel"]').contains('core-services').should('exist');
      getFileContent(name, dir).then((content) => {
        expect(content).to.not.contain('CONFIG');
      });
    });
  });

  it('groups nodes declared on an edge line by inserting declarations and leaving the edge line untouched', () => {
    createAndVisit(EDGE_DECLARED_NODES, 'cypress-parity-subgraph-edgedecl').then(({ dir, name }) => {
      nodeWithLabel('Alice').click();
      nodeWithLabel('Bob').click({ shiftKey: true });
      cy.contains('Selected Elements (2)').should('exist');

      cy.get('[data-testid="group-subgraph-title"]').clear().type('Services');
      cy.get('[data-testid="group-subgraph-button"]').click();

      saved();
      getFileContent(name, dir).then((content) => {
        expect(content).to.eq(`flowchart TD
    subgraph Services
        A[Alice]
        B[Bob]
    end
    A[Alice] --> B[Bob]
    C[Charlie]`);
      });
    });
  });

  it('a single node selection shows no grouping section', () => {
    createAndVisit(STANDALONE_NODES, 'cypress-parity-subgraph-single').then(() => {
      nodeWithLabel('Alice').click();
      cy.get('[data-testid="editor-panel"]').should('exist');
      cy.get('[data-testid="group-subgraph-button"]').should('not.exist');
      cy.get('[data-testid="group-box-button"]').should('not.exist');
    });
  });
});
