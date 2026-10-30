// Pan regression e2e: react-zoom-pan-pinch receives bare class names in
// `panning.excluded`. An invalid selector entry (the old
// `[data-et="message"]`) made the library's window-level mousedown handler
// throw — an uncaught error in the app, and silently broken drag-panning in
// edit mode in real browsers.

const panSeqContent = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const panFileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const panAppUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

const panVisitDiagram = () => {
  let dir = '';
  let name = '';
  cy.task<string>('createTempDiagramDir')
    .then((d) => {
      dir = d;
      name = `cypress-pan-${Date.now()}.mmd`;
      return cy.request('POST', panFileApi(name, dir), { content: panSeqContent });
    })
    .then(() => {
      cy.visit(panAppUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');
      // edit mode is on by default when a diagram is opened
      cy.get('button[title="Exit edit mode"]').should('exist');
      // draggable elements carry the pan-exclusion class
      cy.get('#diagram-container g[data-et="participant"]').should('have.class', 'pan-exclude');
    });
};

describe('Diagram panning (e2e)', () => {
  it('dragging empty canvas draws a selection box in edit mode and does not pan', () => {
    panVisitDiagram();
    cy.get('#diagram-container').then(($c) => {
      const r = ($c[0] as HTMLElement).getBoundingClientRect();
      const x0 = Math.round(r.left + 15);
      const y0 = Math.round(r.top + 15);
      cy.get('.react-transform-component').invoke('css', 'transform').then((initial) => {
        cy.window().then((win) => {
          const svg = win.document.querySelector('#diagram-container svg') as unknown as SVGElement;
          svg.dispatchEvent(new win.MouseEvent('mousedown', { button: 0, buttons: 1, clientX: x0, clientY: y0, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mousemove', { buttons: 1, clientX: x0 + 100, clientY: y0 + 80, bubbles: true, cancelable: true }));
        });
        cy.get('[data-testid="selection-marquee"]').should('exist');
        cy.window().then((win) => {
          win.document.body.dispatchEvent(new win.MouseEvent('mouseup', { button: 0, buttons: 0, clientX: x0 + 100, clientY: y0 + 80, bubbles: true, cancelable: true }));
        });
        cy.get('.react-transform-component').should(($el) => {
          expect($el.css('transform')).to.eq(initial);
        });
      });
    });
  });

  it('Space + drag pans the diagram in edit mode', () => {
    panVisitDiagram();
    cy.get('#diagram-container').then(($c) => {
      const r = ($c[0] as HTMLElement).getBoundingClientRect();
      const x0 = Math.round(r.left + 15);
      const y0 = Math.round(r.top + 15);
      cy.get('.react-transform-component').invoke('css', 'transform').then((initial) => {
        cy.window().then((win) => {
          win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
          const svg = win.document.querySelector('#diagram-container svg') as unknown as SVGElement;
          svg.dispatchEvent(new win.MouseEvent('mousedown', { button: 0, buttons: 1, clientX: x0, clientY: y0, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mousemove', { buttons: 1, clientX: x0 + 100, clientY: y0 + 80, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mouseup', { button: 0, buttons: 0, clientX: x0 + 100, clientY: y0 + 80, bubbles: true, cancelable: true }));
          win.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
        });
        cy.get('.react-transform-component').should(($el) => {
          expect($el.css('transform')).to.not.eq(initial);
        });
      });
    });
  });

  it('middle-click drag pans the diagram in edit mode', () => {
    panVisitDiagram();
    cy.get('#diagram-container').then(($c) => {
      const r = ($c[0] as HTMLElement).getBoundingClientRect();
      const x0 = Math.round(r.left + 15);
      const y0 = Math.round(r.top + 15);
      cy.get('.react-transform-component').invoke('css', 'transform').then((initial) => {
        cy.window().then((win) => {
          const svg = win.document.querySelector('#diagram-container svg') as unknown as SVGElement;
          svg.dispatchEvent(new win.MouseEvent('mousedown', { button: 1, buttons: 4, clientX: x0, clientY: y0, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mousemove', { buttons: 4, clientX: x0 + 100, clientY: y0 + 80, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mouseup', { button: 1, buttons: 0, clientX: x0 + 100, clientY: y0 + 80, bubbles: true, cancelable: true }));
        });
        cy.get('.react-transform-component').should(($el) => {
          expect($el.css('transform')).to.not.eq(initial);
        });
      });
    });
  });

  it('right-click (secondary button) drag pans the diagram in edit mode (Lucid-style)', () => {
    panVisitDiagram();
    cy.get('#diagram-container').then(($c) => {
      const r = ($c[0] as HTMLElement).getBoundingClientRect();
      const x0 = Math.round(r.left + 15);
      const y0 = Math.round(r.top + 15);
      cy.get('.react-transform-component').invoke('css', 'transform').then((initial) => {
        cy.window().then((win) => {
          const svg = win.document.querySelector('#diagram-container svg') as unknown as SVGElement;
          svg.dispatchEvent(new win.MouseEvent('mousedown', { button: 2, buttons: 2, clientX: x0, clientY: y0, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mousemove', { button: 2, buttons: 2, clientX: x0 + 120, clientY: y0 + 90, bubbles: true, cancelable: true }));
          win.document.body.dispatchEvent(new win.MouseEvent('mouseup', { button: 2, buttons: 0, clientX: x0 + 120, clientY: y0 + 90, bubbles: true, cancelable: true }));
        });
        cy.get('.react-transform-component').should(($el) => {
          expect($el.css('transform')).to.not.eq(initial);
        });
      });
    });
  });

  it('dragging a participant does not pan the diagram in edit mode', () => {
    panVisitDiagram();
    cy.get('.react-transform-component').invoke('css', 'transform').then((initial) => {
      cy.get('#diagram-container g[data-et="participant"]').first()
        .trigger('mousedown', { button: 0, clientX: 200, clientY: 100 });
      cy.get('body').trigger('mousemove', { clientX: 215, clientY: 105 });
      cy.get('body').trigger('mouseup', { clientX: 215, clientY: 105 });
      cy.get('.react-transform-component').should(($el) => {
        expect($el.css('transform')).to.eq(initial);
      });
    });
  });
});
