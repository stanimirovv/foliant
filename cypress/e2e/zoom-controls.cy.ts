// Zoom-controls e2e (FEATURES_AND_QOL.md QoL 2): the floating bottom-left
// canvas pill zooms in/out in absolute steps, clamps at the minimum, and "Fit
// to Screen" restores the whole diagram; typing in the search box auto-pans
// the canvas to the first match and the prev/next buttons cycle the matches
// with wrap-around. Runs against brand-new temp diagrams created through the
// real API — never the committed demo fixtures.

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the other (script-style) specs occupy.
export {};

const SEQ_CONTENT = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

// A taller diagram: at 400% zoom the first message sits above the viewport,
// which is what makes the search auto-pan observable.
const TALL_CONTENT = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: m1
    B-->>A: m2
    A->>B: m3
    B-->>A: m4
    A->>B: m5
    B-->>A: m6
    A->>B: m7
    B-->>A: m8
    A->>B: m9
    B-->>A: m10`;

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

const zoomLevel = () => cy.get('[data-testid="zoom-level"]');

const zoomButton = (testid: string) => cy.get(`[data-testid="${testid}"]`);

// Click a pill button and wait for the 200ms zoom animation to settle at the
// expected level before the next click.
const clickZoomTo = (testid: string, expectedLevel: string) => {
  zoomButton(testid).click();
  zoomLevel().should('have.text', expectedLevel);
};

const rectOf = ($el: JQuery<HTMLElement>) => ($el[0] as HTMLElement).getBoundingClientRect();

// True when `inner` lies fully inside `outer` (2px tolerance for rounding).
const rectWithin = (inner: DOMRect, outer: DOMRect) =>
  inner.left >= outer.left - 2 &&
  inner.right <= outer.right + 2 &&
  inner.top >= outer.top - 2 &&
  inner.bottom <= outer.bottom + 2;

// The exact message-text element for a label (substring matches would confuse
// m1 with m10).
const messageText = (label: string) =>
  cy.get('#diagram-container text.messageText').filter(
    (_, el) => el.textContent?.trim() === label
  );

describe('Zoom controls & search auto-pan (e2e)', () => {
  it('zoom in/out step the level in absolute increments and clamp at the minimum', () => {
    createDiagram('cypress-zoom-step', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      zoomLevel().should('have.text', '100%');
      zoomButton('zoom-in').should('not.be.disabled');
      zoomButton('zoom-out').should('not.be.disabled');

      clickZoomTo('zoom-in', '150%');
      clickZoomTo('zoom-out', '100%');

      // 100% -> 50% -> clamped at the 20% minimum, then the button disables
      clickZoomTo('zoom-out', '50%');
      clickZoomTo('zoom-out', '20%');
      zoomButton('zoom-out').should('be.disabled');
      zoomButton('zoom-out').click({ force: true });
      zoomLevel().should('have.text', '20%');

      // zoom back in from the clamped minimum
      clickZoomTo('zoom-in', '70%');
    });
  });

  it('fit to screen restores the whole diagram after zooming in', () => {
    createDiagram('cypress-zoom-fit', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      clickZoomTo('zoom-in', '150%');
      clickZoomTo('zoom-in', '200%');
      clickZoomTo('zoom-in', '250%');
      clickZoomTo('zoom-in', '300%');

      // at 300% the diagram overflows the canvas
      cy.get('#diagram-container svg').then(($svg) => {
        cy.get('#diagram-container').then(($container) => {
          const svgRect = rectOf($svg);
          const containerRect = rectOf($container);
          expect(
            svgRect.width > containerRect.width || svgRect.height > containerRect.height
          ).to.be.true;
        });
      });

      zoomButton('zoom-fit').click();
      cy.wait(700); // let the 200ms fit animation settle

      // back at the default 100% view with the whole diagram visible
      zoomLevel().should('have.text', '100%');
      cy.get('#diagram-container svg').then(($svg) => {
        cy.get('#diagram-container').then(($container) => {
          expect(rectWithin(rectOf($svg), rectOf($container))).to.be.true;
        });
      });
    });
  });

  it('search auto-pans to the first match; prev/next cycle with wrap-around', () => {
    createDiagram('cypress-zoom-search', TALL_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      // zoom deep in so the first message starts above the viewport
      clickZoomTo('zoom-in', '150%');
      clickZoomTo('zoom-in', '200%');
      clickZoomTo('zoom-in', '250%');
      clickZoomTo('zoom-in', '300%');
      clickZoomTo('zoom-in', '350%');
      clickZoomTo('zoom-in', '400%');

      messageText('m1').then(($m1) => {
        cy.get('#diagram-container').then(($container) => {
          // sanity: the first match is off-screen before the search pans
          expect(rectOf($m1).top).to.be.lessThan(rectOf($container).top);
        });
      });

      // typing pans the canvas to the first match: the query lands in the URL,
      // the pill shows 1/10, and after the 200ms pan animation the previously
      // off-screen message sits inside the viewport, highlighted red.
      cy.get('input[placeholder="Search diagram..."]').type('m');
      cy.get('[data-testid="search-match-count"]').should('have.text', '1/10');
      cy.url().should('include', 'q=m');
      cy.wait(700); // let the 200ms auto-pan animation settle

      cy.get('#diagram-container').then(($container) => {
        messageText('m1').then(($m1) => {
          expect(rectWithin(rectOf($m1), rectOf($container))).to.be.true;
          expect($m1[0].style.fill).to.equal('red');
        });
      });

      // next/prev cycle through the ten matches and wrap around, panning to
      // each newly active match
      const expectMatchVisible = (label: string) => {
        cy.get('#diagram-container').then(($container) => {
          messageText(label).then(($m) => {
            expect(rectWithin(rectOf($m), rectOf($container))).to.be.true;
          });
        });
      };

      zoomButton('search-next').click();
      cy.get('[data-testid="search-match-count"]').should('have.text', '2/10');
      cy.wait(700);
      expectMatchVisible('m2');

      zoomButton('search-prev').click();
      cy.get('[data-testid="search-match-count"]').should('have.text', '1/10');
      cy.wait(700);
      expectMatchVisible('m1');

      // wrap backwards to the last match, then forwards to the first
      zoomButton('search-prev').click();
      cy.get('[data-testid="search-match-count"]').should('have.text', '10/10');
      cy.wait(700);
      expectMatchVisible('m10');

      zoomButton('search-next').click();
      cy.get('[data-testid="search-match-count"]').should('have.text', '1/10');
      cy.wait(700);
      expectMatchVisible('m1');
    });
  });

  it('shows 0/0 and disables prev/next when the query matches nothing', () => {
    createDiagram('cypress-zoom-nomatch', SEQ_CONTENT).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      cy.get('input[placeholder="Search diagram..."]').type('z');
      cy.get('[data-testid="search-match-count"]').should('have.text', '0/0');
      zoomButton('search-next').should('be.disabled');
      zoomButton('search-prev').should('be.disabled');

      // clearing the query removes the search segment from the pill
      cy.get('input[placeholder="Search diagram..."]').clear();
      cy.get('[data-testid="search-match-count"]').should('not.exist');
    });
  });
});
