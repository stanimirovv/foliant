// Edge hit targets (e2e): an unlabeled flowchart edge renders as a single
// ~2px-stroke path with fill:none and no label box, so its only click target
// is the stroke itself. The render pipeline (addEdgeHitPaths) injects an
// invisible fat hit path per edge (transparent 12px non-scaling stroke), and
// hovering it shows a translucent band (the .edge-hover affordance). These
// tests click/hover at real coordinates against the real rendered SVG and
// verify selection through the real editor panel.
//
// Geometry is measured from the live DOM (getBoundingClientRect), never
// hard-coded: the SVG is scaled to fit the container, so absolute coordinates
// would be brittle.

// Module scope: keeps these helpers out of the global script scope shared with
// the other spec files (tsc checks all of cypress/**).
export {};

// Obfuscated actors (never the user's real diagram data). One unlabeled edge
// (W --> X) and one labeled edge (X -->|ships to| Y).
const FLOW_CONTENT = `flowchart LR
    W["Widget"] --> X["Gadget"]
    X -->|ships to| Y["Doohickey"]`;

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

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

// A viewport point on the unlabeled edge's centerline, offset 4px
// perpendicular: inside the 12px hit band, outside the 2px visible stroke.
const bandPointOf = ($path: JQuery<HTMLElement>) => {
  const r = ($path[0] as unknown as SVGElement).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 + 4 };
};

const unlabeledEdge = () =>
  cy.get('#diagram-container path[data-et="edge"][data-id="L_W_X_0"]');

const unlabeledHitPath = () =>
  cy.get('#diagram-container path.edge-hit[data-id="L_W_X_0"]');

describe('Edge hit targets (e2e)', () => {
  it('clicking inside the hit band (off the 2px stroke) selects the unlabeled edge', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-edge-hit-select').then(() => {
      unlabeledHitPath().should('exist');
      unlabeledEdge().then(($path) => {
        const p = bandPointOf($path);
        cy.get('#diagram-container').then(($c) => {
          const c = $c[0].getBoundingClientRect();
          cy.get('#diagram-container').click(p.x - c.left, p.y - c.top);
        });
      });
      // the editor panel switched to the edge (unlabeled: empty Label field)
      cy.contains('span.font-mono', 'W --> X').should('exist');
      cy.contains('label', 'Label').find('input').should('have.value', '');
      // and the visible edge carries the selection highlight
      unlabeledEdge().should('have.class', 'editor-selected');
    });
  });

  it('hovering the hit band shows the hover affordance; leaving clears it', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-edge-hit-hover').then(() => {
      unlabeledHitPath().should('exist');
      // The unzoomed diagram is small, so the whole hit band sits inside the
      // node hover pads (within NODE_HOVER_PAD of a node box the connect
      // handles win, by design). Zoom in once — the band's middle then lies
      // beyond the pads, exactly as on a real (larger) diagram.
      unlabeledEdge().then(($path) => {
        const r = ($path[0] as unknown as SVGElement).getBoundingClientRect();
        const centerX = r.left + r.width / 2;
        const centerY = r.top + r.height / 2;
        cy.get('#diagram-container svg').trigger('wheel', { deltaY: -120, clientX: centerX, clientY: centerY });
      });
      cy.wait(400); // the library's smooth zoom settles
      unlabeledEdge().then(($path) => {
        const p = bandPointOf($path);
        // the hover detection is target-based: the browser reports the hit
        // path as the event target within its band. force: the hit path is
        // invisible (transparent stroke, no fill) — a zero-height bounding
        // box fails Cypress's visibility check even though it is the target.
        unlabeledHitPath().trigger('mousemove', { clientX: p.x, clientY: p.y, force: true });
      });
      unlabeledHitPath().should('have.class', 'edge-hover');
      unlabeledEdge().should('have.class', 'edge-hover');
      // moving over empty space clears the affordance
      cy.get('#diagram-container svg').trigger('mousemove', { clientX: 1, clientY: 1 });
      unlabeledHitPath().should('not.have.class', 'edge-hover');
      unlabeledEdge().should('not.have.class', 'edge-hover');
    });
  });

  it('pressing inside the hit band selects the edge and does not pan the canvas', () => {
    createAndVisit(FLOW_CONTENT, 'cypress-edge-hit-nopan').then(() => {
      unlabeledHitPath().should('exist');
      cy.get('#diagram-container .react-transform-component').then(($t) => {
        const before = $t[0].getAttribute('style') ?? '';
        unlabeledEdge().then(($path) => {
          const p = bandPointOf($path);
          // force: the hit path is invisible (see the hover test)
          unlabeledHitPath()
            .trigger('mousedown', { clientX: p.x, clientY: p.y, button: 0, force: true })
            .trigger('mousemove', { clientX: p.x + 120, clientY: p.y + 80, force: true })
            .trigger('mouseup', { clientX: p.x + 120, clientY: p.y + 80, force: true });
        });
        // select-on-press: the edge is selected, and the canvas transform is
        // untouched (the press never reached the pan handler)
        unlabeledEdge().should('have.class', 'editor-selected');
        cy.get('#diagram-container .react-transform-component').should(($t2) => {
          expect($t2[0].getAttribute('style') ?? '').to.eq(before);
        });
      });
    });
  });
});
