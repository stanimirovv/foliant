// Editor e2e (EDITING_PLAN.md Step 14): the editing round trip against
// brand-new temp diagrams created through the real API — never the committed
// demo fixtures. Verified through the real UI, the real API and the real
// rendered SVG.

const SEQ_CONTENT = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const FLOW_CONTENT = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A`;

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string) =>
  `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// Waits for the debounced auto-save to complete.
const saved = () =>
  cy.get('[data-testid="save-indicator"]', { timeout: 10000 }).should('have.text', 'Saved');

// Sets the panel's controlled <input type="color"> the way a real picker
// does: through the native value setter + a bubbling 'input' event (the same
// pattern as canvas-shortcuts.cy.ts). A plain .invoke('val', ...) goes
// through React's value tracker, so React detects no change and the field's
// onChange never fires.
const setColorPicker = (hex: string) => {
  cy.contains('label', 'Color').find('input').then(($input) => {
    const el = $input[0] as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )!.set!;
    setter.call(el, hex);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('Visual editing (e2e)', () => {
  it('sequence: edit -> auto-save -> reload renders the styled arrow; add, tag+merge, delete cascade, undo', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-editing-seq-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: SEQ_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Hello').should('exist');

        // edit mode is on by default when a diagram is opened
        cy.get('button[title="Exit edit mode"]').should('exist');
        // the toggle opts out (edit=0) and back in (param removed)
        cy.get('button[title="Exit edit mode"]').click();
        cy.url().should('include', 'edit=0');
        cy.get('button[title="Edit diagram"]').should('exist');
        cy.get('button[title="Edit diagram"]').click();
        cy.url().should('not.include', 'edit=0');
        cy.get('button[title="Exit edit mode"]').should('exist');
        cy.get('[data-testid="copy-mermaid"]').should('exist').and('contain.text', 'Copy');

        // click the first message -> the panel shows its fields
        // (the message <line> has zero height, so click its text label instead;
        // the svgmap resolves text.messageText back to the message element)
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Hello');

        // change label / type / color / width / dash
        cy.contains('label', 'Label').find('input').clear().type('Greetings');
        cy.contains('label', 'Type').find('select').select('-->>');
        setColorPicker('#e11d48');
        cy.contains('label', 'Width').find('input').clear().type('3');
        cy.contains('label', 'Dash').find('select').select('dashed');

        // the auto-save completes
        saved();

        // the file on disk carries the new operator/label and the CONFIG entry
        cy.request(fileApi(name, dir)).then((res) => {
          const content = (res.body as { content: string }).content;
          expect(content).to.contain('%% CONFIG:');
          expect(content).to.contain('A-->>B: Greetings');
          expect(content).to.contain('"from":"A"');
          expect(content).to.contain('"to":"B"');
          expect(content).to.contain('"label":"Greetings"');
          expect(content).to.contain('"color":"#e11d48"');
          expect(content).to.contain('"width":3');
          expect(content).to.contain('"dash":"dashed"');
        });

        // reload: the rendered SVG carries the styled stroke
        cy.reload();
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Greetings').should('exist');
        cy.get('#diagram-container [data-et="message"]').first().should(($el) => {
          const el = $el[0] as unknown as SVGElement;
          expect(el.style.stroke).to.eq('rgb(225, 29, 72)');
          // the width is applied as a unitless CSS value ('3', not '3px')
          expect(parseFloat(el.style.strokeWidth)).to.eq(3);
          // CSSOM serializes the dasharray separator as a comma ('8, 6')
          expect(el.style.strokeDasharray.replace(/,/g, '')).to.eq('8 6');
          expect(el.getAttribute('marker-end')).to.contain('--styled-');
        });

        // add a participant and a message
        cy.get('button[title="Add Participant"]').click();
        cy.get('#diagram-container').contains('New Participant').should('exist');
        cy.get('button[title="Add Message"]').click();
        cy.get('#diagram-container [data-et="message"]').should('have.length', 3);

        // tag both participants
        cy.get('#diagram-container g[data-et="participant"][data-id="A"]').click();
        cy.get('input[placeholder="Add tag..."]').type('backend{enter}');
        cy.get('button[aria-label="Remove tag backend"]').should('exist');
        cy.get('#diagram-container g[data-et="participant"][data-id="B"]').click();
        cy.get('input[placeholder="Add tag..."]').type('backend{enter}');
        cy.get('button[aria-label="Remove tag backend"]').should('exist');

        // merge by that key: A and B collapse into one participant (the
        // untagged New Participant is unaffected), and the styled arrow
        // follows the merge and renders as a styled self-call (R-07)
        cy.contains('By Key').parent().parent().contains('li', 'backend').contains('button', 'Merged').click();
        cy.url().should('include', 'merge_key=backend');
        cy.get('#diagram-container g[data-et="participant"]').should('have.length', 2);
        cy.get('#diagram-container [data-et="message"]').first().should(($el) => {
          expect(($el[0] as unknown as SVGElement).style.stroke).to.eq('rgb(225, 29, 72)');
        });

        // delete the merged participant: deleted immediately, cascade included
        cy.get('#diagram-container g[data-et="participant"]').first().click();
        cy.get('[data-testid="panel-delete"]').click();
        cy.get('[data-testid="delete-dialog"]').should('not.exist');
        cy.get('#diagram-container [data-et="message"]').should('have.length', 0);

        // undo reverts the delete
        cy.get('button[title="Undo (Ctrl+Z)"]').click();
        cy.get('#diagram-container [data-et="message"]').should('have.length', 3);
        cy.get('#diagram-container [data-et="message"]').first().should(($el) => {
          expect(($el[0] as unknown as SVGElement).style.stroke).to.eq('rgb(225, 29, 72)');
        });

        // message tags & inheritance (Increment 3b)
        cy.get('#diagram-container text.messageText').first().click();
        cy.contains('span[title="Inherited from A"]', 'backend').should('not.exist');
        cy.get('input[placeholder="Add tag..."]').type('critical{enter}');
        cy.get('button[aria-label="Remove tag critical"]').should('exist');
        saved();

        // toggle inherit service tags to On -> inherited chip appears
        cy.get('[data-testid="arrow-inherit-on"]').click();
        cy.contains('span[title="Inherited from A"]', 'backend').should('exist');
        saved();

        // toggle inherit service tags back to Off
        cy.get('[data-testid="arrow-inherit-off"]').click();
        cy.contains('span[title="Inherited from A"]', 'backend').should('not.exist');
        saved();

        // hiding the message's tag 'critical' hides the message
        cy.contains('By Key').parent().parent().contains('li', 'critical').contains('button', 'Off').click();
        cy.get('#diagram-container text.messageText').contains('Greetings').should('not.exist');
        // un-hiding restores it
        cy.contains('By Key').parent().parent().contains('li', 'critical').contains('button', 'On').click();
        cy.get('#diagram-container text.messageText').contains('Greetings').should('exist');
      });
  });

  it('flowchart: node color + edge style, add node/edge, delete cascade', () => {
    let dir = '';
    let name = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        name = `cypress-editing-flow-${Date.now()}.mmd`;
        return cy.request('POST', fileApi(name, dir), { content: FLOW_CONTENT });
      })
      .then(() => {
        cy.visit(appUrl(name, dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Alice').should('exist');

        // edit mode is on by default when a diagram is opened
        cy.get('button[title="Exit edit mode"]').should('exist');

        // node color
        cy.contains('#diagram-container g.node', 'Alice').click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Alice');
        setColorPicker('#e11d48');
        saved();
        cy.request(fileApi(name, dir)).then((res) => {
          const content = (res.body as { content: string }).content;
          expect(content).to.contain('"A":{"color":"#e11d48"}');
        });
        // the node fill changed in the rendered SVG
        cy.contains('#diagram-container g.node', 'Alice').find('.label-container').should(($el) => {
          expect(($el[0] as unknown as SVGElement).style.fill).to.eq('rgb(225, 29, 72)');
        });

        // edge style (the labeled edge)
        cy.contains('#diagram-container g.edgeLabel', 'Reply').click();
        cy.contains('label', 'Label').find('input').should('have.value', 'Reply');
        setColorPicker('#0ea5e9');
        cy.contains('label', 'Width').find('input').clear().type('2');
        cy.contains('label', 'Dash').find('select').select('dotted');
        saved();
        cy.request(fileApi(name, dir)).then((res) => {
          const content = (res.body as { content: string }).content;
          expect(content).to.contain('"from":"B"');
          expect(content).to.contain('"to":"A"');
          expect(content).to.contain('"label":"Reply"');
          expect(content).to.contain('"color":"#0ea5e9"');
          expect(content).to.contain('"width":2');
          expect(content).to.contain('"dash":"dotted"');
        });
        cy.get('#diagram-container path[data-et="edge"]').should(($paths) => {
          const styled = Array.from($paths).find(
            (p) => (p as unknown as SVGElement).style.stroke === 'rgb(14, 165, 233)'
          );
          expect(styled, 'the styled edge carries its stroke').to.exist;
        });

        // add a node and an edge
        cy.get('button[title="Add Participant"]').click();
        cy.get('#diagram-container').contains('New Participant').should('exist');
        cy.get('button[title="Add Message"]').click();
        cy.get('#diagram-container path[data-et="edge"]').should('have.length', 3);

        // delete node A: deleted immediately without asking confirmation
        cy.contains('#diagram-container g.node', 'Alice').click();
        cy.get('[data-testid="panel-delete"]').click();
        cy.get('[data-testid="delete-dialog"]').should('not.exist');
        cy.get('#diagram-container g.node').should('have.length', 2);
        cy.get('#diagram-container path[data-et="edge"]').should('have.length', 0);
      });
  });

  it('new diagram: the dialog creates a file (name + type) and opens it', () => {
    const name = `e2e-new-${Date.now()}.mmd`;
    cy.task<string>('createTempDiagramDir').then((dir) => {
      // an empty directory: no file selected yet
      cy.visit(`/?dir=${encodeURIComponent(dir)}`);
      cy.get('[data-testid="new-diagram"]').should('be.visible').click();
      // the user types the name without the extension: it is normalized
      cy.get('[data-testid="new-diagram-name"]').type(name.replace(/\.mmd$/, ''));
      cy.get('[data-testid="new-diagram-type"]').select('flowchart');
      cy.get('[data-testid="new-diagram-create"]').click();

      // the app navigates to the new file and renders it
      cy.url().should('include', `file=${name}`);
      cy.get('#diagram-container svg').should('exist');
      cy.get('#diagram-container').contains('Alice').should('exist');
      cy.get('#diagram-container').contains('Reply').should('exist');

      // the file exists on disk with the template content
      cy.request(fileApi(name, dir)).then((res) => {
        const content = (res.body as { content: string }).content;
        expect(content).to.contain('flowchart TD');
        expect(content).to.contain('A[Alice] --> B[Bob]');
      });
    });
  });

  it('new file: the dialog creates a .md architecture document and opens it in the markdown editor', () => {
    const name = `e2e-new-doc-${Date.now()}.md`;
    cy.task<string>('createTempDiagramDir').then((dir) => {
      // an empty directory: no file selected yet
      cy.visit(`/?dir=${encodeURIComponent(dir)}`);
      cy.get('[data-testid="new-diagram"]').should('be.visible').click();
      // the user types the name without the extension: it is normalized
      cy.get('[data-testid="new-diagram-name"]').type(name.replace(/\.md$/, ''));
      cy.get('[data-testid="new-diagram-type"]').select('markdown');
      cy.get('[data-testid="new-diagram-create"]').click();

      // the app navigates to the new document and shows the WYSIWYG editor
      cy.url().should('include', `file=${name}`);
      cy.get('[data-testid="wysiwyg-editor"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="wysiwyg-block-0"]').should('contain.text', 'Architecture');
      // the embedded diagram renders as a preview SVG
      cy.get('[data-testid="md-mermaid-svg-0"] svg', { timeout: 10000 }).should('exist');
      // the file is listed in the Files menu as a markdown file
      cy.get('[data-testid="md-file-' + name + '"]').should('contain.text', name);

      // the file exists on disk with the architecture document template
      cy.request(fileApi(name, dir)).then((res) => {
        const content = (res.body as { content: string }).content;
        expect(content).to.contain('# Architecture');
        expect(content).to.contain('```mermaid');
        expect(content).to.contain('sequenceDiagram');
        expect(content).to.contain('A->>B: Hello');
      });
    });
  });
});
