// Step-by-step interactive flow player (walkthrough player) E2E suite.
// Covers sequence diagrams (step per message), flowcharts (step 1 level of depth
// at a time), edit-mode & canvas coexistence, markdown preview embedded blocks,
// and robustness/state. All tests create temporary diagrams via the real API
// and never touch committed fixtures.

export {};

const fileApi = (name: string, dir: string) =>
  `/api/file/${name}?dir=${encodeURIComponent(dir)}`;

const appUrl = (name: string, dir: string, extraParams: Record<string, string> = {}) => {
  const qs = Object.entries(extraParams)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('');
  return `/?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(name)}${qs}`;
};

let seqCounter = 0;

const createFile = (prefix: string, ext: 'mmd' | 'md', content: string) => {
  const state = { dir: '', name: '' };
  return cy
    .task<string>('createTempDiagramDir')
    .then((d) => {
      state.dir = d;
      state.name = `${prefix}-${Date.now()}-${seqCounter++}.${ext}`;
      return cy.request('POST', fileApi(state.name, state.dir), { content });
    })
    .then(() => state);
};

const createDiagram = (prefix: string, content: string) =>
  createFile(prefix, 'mmd', content);

const createMarkdown = (prefix: string, content: string) =>
  createFile(prefix, 'md', content);

const rectOf = ($el: JQuery<HTMLElement>) =>
  ($el[0] as HTMLElement).getBoundingClientRect();

// True when `inner` lies inside `outer` (with 4px rounding tolerance).
const rectWithin = (inner: DOMRect, outer: DOMRect) =>
  inner.left >= outer.left - 4 &&
  inner.right <= outer.right + 4 &&
  inner.top >= outer.top - 4 &&
  inner.bottom <= outer.bottom + 4;

const bar = () => cy.get('[data-testid="walkthrough-step-count"]');

// Fixtures
const SEQ_CONFIG = JSON.stringify({
  version: 1,
  arrows: [{ from: 'B', to: 'C', label: 'Forward to C', keys: ['tag-m2'] }],
  notes: [
    { id: 'note_tagged', x: 80, y: 60, text: 'Tagged sticky', color: 'blue', keys: ['tag-m2'] },
    { id: 'note_free', x: 240, y: 60, text: 'Free sticky', color: 'yellow' },
  ],
});

const SEQ = [
  `%% CONFIG: ${SEQ_CONFIG}`,
  'sequenceDiagram',
  '    participant A as Alice',
  '    participant B as Bob',
  '    participant C as Charlie',
  '    Note over A,B: PreNote',
  '    A->>B: Hello Bob',
  '    Note over A,B: MidNote',
  '    B->>C: Forward to C',
  '    C-->>B: Reply from C',
  '    B-->>A: Done Alice',
  '    Note over B,C: PostNote',
].join('\n');

const SEQ_NUM = [
  'sequenceDiagram',
  '    autonumber',
  '    participant A as Alice',
  '    participant B as Bob',
  '    A->>B: First call',
  '    B-->>A: Second call',
].join('\n');

const FLOW = [
  'flowchart TD',
  '    A[Start] --> B[Left]',
  '    A --> C[Right]',
  '    B -->|b-to-d| D[Join]',
  '    C -->|c-to-d| D',
  '    D -->|retry| B',
  '    ISO[Isolated Node]',
  '    subgraph SG[Worker Pool]',
  '        B',
  '        C',
  '    end',
].join('\n');

const FLOW_WIDE = [
  'flowchart TD',
  '    A[Start] --> B1[Branch 1]',
  '    A --> B2[Branch 2]',
  '    A --> B3[Branch 3]',
  '    A -->|alt| B1',
  '    B1 --> D[Join]',
  '    B2 --> D',
  '    B3 --> D',
  '    D --> B1',
].join('\n');

const FLOW_SKIP = [
  'flowchart TD',
  '    A[Start] --> B[Mid]',
  '    B --> D[End]',
  '    A --> D',
].join('\n');

const FLOW_CHAIN_PARALLEL = [
  'flowchart TD',
  '    A[Start] -->|p1| B[Mid] --> C[End]',
  '    A -->|p2| B',
].join('\n');

const MD = [
  '# Walkthrough Demo',
  '',
  'Introductory paragraph.',
  '',
  '```mermaid',
  'sequenceDiagram',
  '    participant A as Client',
  '    participant B as Server',
  '    A->>B: Request',
  '    Note over A,B: MidCheck',
  '    B-->>A: Response',
  '    A->>B: Ack',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  '    A[Entry] --> B[Left]',
  '    A --> C[Right]',
  '    B --> D[Exit]',
  '    C --> D',
  '```',
  '',
  '```mermaid',
  'pie',
  '    "Apples" : 40',
  '    "Oranges" : 60',
  '```',
].join('\n');

const MD_BAD = [
  '# Broken Blocks',
  '',
  '```mermaid',
  '```',
  '',
  '```mermaid',
  'not a mermaid diagram at all',
  '```',
].join('\n');

describe('A. Diagram editor — sequence walkthrough', () => {
  it('A1 & A2: enters/exits presentation mode and steps with toolbar/bar buttons', () => {
    createDiagram('walk-seq-a1', SEQ).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      // Enter presentation mode
      cy.get('[data-testid="present-toggle"]').click();
      bar().should('have.text', 'Step 1/4');
      cy.get('[data-testid="walkthrough-step-label"]').should('have.text', 'Hello Bob');

      // Prev is disabled at 1/4
      cy.get('[data-testid="walkthrough-prev"]').should('be.disabled');
      cy.get('[data-testid="walkthrough-next"]').should('not.be.disabled');
      cy.get('[data-testid="walkthrough-play"]').should('not.be.disabled');

      // Message 1 is active, messages 2..4 are dimmed; participants carry neither
      cy.get('#diagram-container [data-et="message"]').should('have.length', 4);
      cy.get('#diagram-container [data-et="message"]').first().should('have.class', 'walkthrough-active');
      cy.get('#diagram-container [data-et="message"]').filter('.walkthrough-dimmed').should('have.length', 3);
      cy.get('#diagram-container [data-et="participant"].walkthrough-dimmed').should('have.length', 0);
      cy.get('#diagram-container [data-et="participant"].walkthrough-active').should('have.length', 0);

      // Step to 2/4
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 2/4');
      cy.get('[data-testid="walkthrough-prev"]').should('not.be.disabled');
      cy.get('#diagram-container [data-et="message"]').eq(1).should('have.class', 'walkthrough-active');
      cy.get('#diagram-container [data-et="message"]').filter('.walkthrough-dimmed').should('have.length', 2);

      // Step to 4/4 -> next and play both disabled
      cy.get('[data-testid="walkthrough-next"]').click();
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 4/4');
      cy.get('[data-testid="walkthrough-next"]').should('be.disabled');
      cy.get('[data-testid="walkthrough-play"]').should('be.disabled');
      cy.get('#diagram-container [data-et="message"]').filter('.walkthrough-dimmed').should('have.length', 0);

      // Exit presentation mode -> bar gone and classes removed
      cy.get('[data-testid="walkthrough-exit"]').click();
      cy.get('[data-testid="walkthrough-bar"]').should('not.exist');
      cy.get('#diagram-container .walkthrough-dimmed').should('have.length', 0);
      cy.get('#diagram-container .walkthrough-active').should('have.length', 0);
    });
  });

  it('A3 & A4: steps with keyboard arrows/Escape and ignores keys when search input is focused', () => {
    createDiagram('walk-seq-a3', SEQ).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      cy.get('[data-testid="present-toggle"]').click();
      bar().should('have.text', 'Step 1/4');

      // Keyboard ArrowRight / ArrowLeft
      cy.get('body').type('{rightArrow}');
      bar().should('have.text', 'Step 2/4');
      cy.get('body').type('{leftArrow}');
      bar().should('have.text', 'Step 1/4');

      // A4: Focus search input -> arrows, Space, Escape do not step, toggle play, or exit
      cy.get('input[placeholder="Search diagram..."]').focus().type('{rightArrow} {esc}');
      bar().should('have.text', 'Step 1/4');
      cy.get('[data-testid="walkthrough-bar"]').should('exist');

      // Blur input and press Escape on body -> exits
      cy.get('input[placeholder="Search diagram..."]').blur();
      cy.get('body').type('{esc}');
      cy.get('[data-testid="walkthrough-bar"]').should('not.exist');
      cy.get('#diagram-container .walkthrough-dimmed').should('have.length', 0);
    });
  });

  it('A5: autoplay advances every 1600ms, pauses on manual step, and stops at N/N', () => {
    createDiagram('walk-seq-a5', SEQ).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      cy.get('[data-testid="present-toggle"]').click();
      bar().should('have.text', 'Step 1/4');

      // Start autoplay -> advances on 1600ms tick
      cy.clock();
      cy.get('[data-testid="walkthrough-play"]').click();
      cy.get('[data-testid="walkthrough-play"]').should('have.attr', 'aria-label', 'Pause');
      cy.tick(1600);
      bar().should('have.text', 'Step 2/4');

      // Manual next pauses autoplay
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 3/4');
      cy.get('[data-testid="walkthrough-play"]').should('have.attr', 'aria-label', 'Play');
      cy.tick(1600);
      bar().should('have.text', 'Step 3/4');

      // Resume autoplay -> reaches 4/4 and stops automatically
      cy.get('[data-testid="walkthrough-play"]').click();
      cy.tick(1600);
      bar().should('have.text', 'Step 4/4');
      cy.get('[data-testid="walkthrough-play"]').should('be.disabled');
    });
  });

  it('A6, A7 & A8: auto-pans active message into viewport, reveals Note over by step, and dims tagged sticky notes until their step', () => {
    createDiagram('walk-seq-a6', SEQ).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      // Ensure sticky notes are shown
      cy.get('[data-testid="present-toggle"]').click();
      bar().should('have.text', 'Step 1/4');
      cy.wait(250);

      // A6: active message label 'Hello Bob' is within #diagram-container viewport
      cy.get('#diagram-container').then(($container) => {
        const containerRect = rectOf($container);
        cy.get('#diagram-container text.messageText')
          .filter((_, el) => el.textContent?.trim() === 'Hello Bob')
          .then(($label) => {
            expect(rectWithin(rectOf($label), containerRect)).to.equal(true);
          });
      });

      // A7: PreNote and MidNote (attached to step 0) are not dimmed; PostNote (attached to step 3) is dimmed
      cy.get('#diagram-container g[data-et="note"]').should('have.length', 3);
      cy.get('#diagram-container g[data-et="note"]').eq(0).should('not.have.class', 'walkthrough-dimmed');
      cy.get('#diagram-container g[data-et="note"]').eq(1).should('not.have.class', 'walkthrough-dimmed');
      cy.get('#diagram-container g[data-et="note"]').eq(2).should('have.class', 'walkthrough-dimmed');

      // A8: Sticky note tagged to m2 ('Forward to C', step 2) is dimmed at step 1; untagged note is not dimmed
      cy.get('[data-testid="sticky-note-wrapper-note_tagged"]').should('have.class', 'walkthrough-dimmed');
      cy.get('[data-testid="sticky-note-wrapper-note_free"]').should('not.have.class', 'walkthrough-dimmed');

      // Advance to step 2 -> 'Forward to C' revealed -> tagged sticky note becomes visible
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 2/4');
      cy.get('[data-testid="sticky-note-wrapper-note_tagged"]').should('not.have.class', 'walkthrough-dimmed');
      cy.get('[data-testid="sticky-note-wrapper-note_free"]').should('not.have.class', 'walkthrough-dimmed');

      // Advance to step 4 -> PostNote revealed
      cy.get('[data-testid="walkthrough-next"]').click();
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 4/4');
      cy.get('#diagram-container g[data-et="note"]').eq(2).should('not.have.class', 'walkthrough-dimmed');
    });
  });

  it('A9 & A10: syncs ?present=1 in URL, restarts at 1/N on reload, and never writes to disk', () => {
    createDiagram('walk-seq-a9', SEQ_NUM).then(({ dir, name }) => {
      // A10: Visit with ?present=1 -> starts in presentation mode at 1/2
      cy.visit(appUrl(name, dir, { present: '1' }));
      cy.get('#diagram-container svg').should('exist');
      bar().should('have.text', 'Step 1/2');

      // Step to 2/2 and reload -> restarts at 1/2
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 2/2');
      cy.reload();
      cy.get('#diagram-container svg').should('exist');
      bar().should('have.text', 'Step 1/2');

      // Exit -> removes present param from URL
      cy.get('[data-testid="walkthrough-exit"]').click();
      cy.location('search').should('not.include', 'present');

      // A9: Verify file on disk is byte-for-byte identical to SEQ_NUM
      cy.request('GET', fileApi(name, dir)).then((res) => {
        expect(res.body.content).to.equal(SEQ_NUM);
      });
    });
  });
});

describe('B. Diagram editor — flowchart walkthrough (1 level of depth per step)', () => {
  it('B1, B4, B5 & B6: steps FLOW by depth level (1/3), keeps ISO and g.cluster undimmed, dims/reveals edge labels with edges, and auto-pans', () => {
    createDiagram('walk-flow-b1', FLOW).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      cy.get('[data-testid="present-toggle"]').click();
      // FLOW has depths 0 (A), 1 (B, C), 2 (D) -> 3 steps
      bar().should('have.text', 'Step 1/3');

      // B4: Subgraph container g.cluster and isolated node ISO are NEVER dimmed
      cy.get('#diagram-container g.cluster.walkthrough-dimmed').should('have.length', 0);
      cy.get('#diagram-container g.node[id*="-ISO-"]').should('not.have.class', 'walkthrough-dimmed');

      // At Step 1: A is active; B, C, D are dimmed; all 5 edges are dimmed
      cy.get('#diagram-container g.node[id*="-A-"]').should('have.class', 'walkthrough-active');
      cy.get('#diagram-container g.node[id*="-B-"]').should('have.class', 'walkthrough-dimmed');
      cy.get('#diagram-container g.node[id*="-C-"]').should('have.class', 'walkthrough-dimmed');
      cy.get('#diagram-container g.node[id*="-D-"]').should('have.class', 'walkthrough-dimmed');
      cy.get('#diagram-container path[data-et="edge"].walkthrough-dimmed').should('have.length', 5);

      // Step 2: reveals BOTH B and C AND both incoming edges A->B, A->C in a single step
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 2/3');
      cy.get('#diagram-container g.node[id*="-B-"]').should('have.class', 'walkthrough-active');
      cy.get('#diagram-container g.node[id*="-C-"]').should('have.class', 'walkthrough-active');
      cy.get('#diagram-container g.node[id*="-D-"]').should('have.class', 'walkthrough-dimmed');
      // 3 edges still dimmed (B->D, C->D, and back-edge D->B)
      cy.get('#diagram-container path[data-et="edge"].walkthrough-dimmed').should('have.length', 3);
      // B5: Edge labels on B->D, C->D, D->B are dimmed at step 2
      cy.get('#diagram-container g.edgeLabel.walkthrough-dimmed').should('have.length', 3);

      // B6: Auto-pan centers level's first node (B) inside #diagram-container
      cy.wait(250);
      cy.get('#diagram-container').then(($container) => {
        const containerRect = rectOf($container);
        cy.get('#diagram-container g.node[id*="-B-"]').then(($nodeB) => {
          expect(rectWithin(rectOf($nodeB), containerRect)).to.equal(true);
        });
      });

      // Step 3: reveals D, B->D, C->D, and back-edge D->B
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 3/3');
      cy.get('#diagram-container g.node[id*="-D-"]').should('have.class', 'walkthrough-active');
      cy.get('#diagram-container path[data-et="edge"].walkthrough-dimmed').should('have.length', 0);
      cy.get('#diagram-container g.edgeLabel.walkthrough-dimmed').should('have.length', 0);
      cy.get('#diagram-container g.cluster.walkthrough-dimmed').should('have.length', 0);
    });
  });

  it('B2: step count depends only on depth levels — FLOW_WIDE with extra nodes and parallel edges still has 3 steps', () => {
    createDiagram('walk-flow-b2', FLOW_WIDE).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir, { present: '1' }));
      cy.get('#diagram-container svg').should('exist');
      bar().should('have.text', 'Step 1/3');
    });
  });

  it('B3 & B7: longest-path depth for skip edges (FLOW_SKIP = 3 steps) and chained/parallel edges', () => {
    createDiagram('walk-flow-b3', FLOW_SKIP).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir, { present: '1' }));
      cy.get('#diagram-container svg').should('exist');
      bar().should('have.text', 'Step 1/3');
    });

    createDiagram('walk-flow-b7', FLOW_CHAIN_PARALLEL).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir, { present: '1' }));
      cy.get('#diagram-container svg').should('exist');
      bar().should('have.text', 'Step 1/3');

      // Step 2 reveals both parallel A->B edges at once
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 2/3');
      cy.get('#diagram-container path[data-et="edge"].walkthrough-active').should('have.length', 2);
    });
  });
});

describe('C. Edit-mode & canvas coexistence', () => {
  it('C1, C2, C3 & C4: works in edit mode, suspends participant/sticky-note drag while presenting, and preserves zoom/pan', () => {
    createDiagram('walk-coexist-c1', SEQ).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('#diagram-container svg').should('exist');

      // Edit mode is active by default
      cy.get('button[title="Exit edit mode"]').should('exist');
      // C4: Enter presentation mode while in edit mode
      cy.get('[data-testid="present-toggle"]').click();
      bar().should('have.text', 'Step 1/4');

      // C1: Attempt to drag participant A box -> no reorder indicator or position change
      cy.get('#diagram-container g[data-et="participant"][data-id="A"]').then(($el) => {
        const before = rectOf($el);
        cy.wrap($el)
          .trigger('mousedown', { button: 0, clientX: before.left + 10, clientY: before.top + 10, force: true });
        cy.get('#diagram-container')
          .trigger('mousemove', { clientX: before.left + 200, clientY: before.top + 10, force: true })
          .trigger('mouseup', { force: true });
        cy.get('[data-testid="reorder-indicator"]').should('not.exist');
      });

      // C2: Attempt to drag sticky note handle -> position unchanged
      cy.get('[data-testid="sticky-note-note_free"]').then(($note) => {
        const beforeLeft = ($note[0] as HTMLElement).style.left;
        cy.get('[data-testid="sticky-note-handle-note_free"]').trigger('mousedown', {
          button: 0,
          clientX: 250,
          clientY: 70,
          force: true,
        });
        cy.window().trigger('mousemove', { clientX: 400, clientY: 200, force: true });
        cy.window().trigger('mouseup', { force: true });
        cy.get('[data-testid="sticky-note-note_free"]').should(($after) => {
          expect(($after[0] as HTMLElement).style.left).to.equal(beforeLeft);
        });
      });

      // C3: Zoom controls still work while presenting, and clicking walkthrough bar does not change zoom
      cy.get('[data-testid="zoom-in"]').click();
      cy.get('[data-testid="zoom-level"]').should('not.have.text', '100%');
      cy.get('[data-testid="walkthrough-next"]').click();
      bar().should('have.text', 'Step 2/4');

      // Exit presentation
      cy.get('[data-testid="walkthrough-exit"]').click();
      cy.get('[data-testid="walkthrough-bar"]').should('not.exist');
    });
  });
});

describe('D. Markdown viewer editor walkthrough', () => {
  it('D1, D2, D3, D4, D5, D7, D8 & D9: per-block presentation, TransformWrapper wrap/unwrap, block isolation, Note over reveal, keyboard, and click-to-edit guard', () => {
    createMarkdown('walk-md-d1', MD).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('[data-testid="md-mermaid-svg-0"] svg', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="md-mermaid-svg-1"] svg', { timeout: 10000 }).should('exist');

      // D6 check on block 2 (pie chart -> unsupported -> no Present button)
      cy.get('[data-testid="md-mermaid-present-0"]').should('exist');
      cy.get('[data-testid="md-mermaid-present-1"]').should('exist');
      cy.get('[data-testid="md-mermaid-present-2"]').should('not.exist');

      // D1 & D5: Click Present on block 0 -> does NOT navigate to diagram editor, wraps block 0 in TransformWrapper
      cy.get('[data-testid="md-mermaid-present-0"]').click();
      cy.url().should('not.include', 'diagram=');
      cy.get('[data-testid="md-mermaid-svg-0"] .react-transform-wrapper').should('exist');
      cy.get('[data-testid="md-mermaid-svg-0"] [data-testid="walkthrough-step-count"]').should('have.text', 'Step 1/3');

      // D3: Block 1 is untouched (no TransformWrapper, no dimmed elements, no bar)
      cy.get('[data-testid="md-mermaid-svg-1"] .react-transform-wrapper').should('not.exist');
      cy.get('[data-testid="md-mermaid-svg-1"] .walkthrough-dimmed').should('have.length', 0);

      // D4: Clicking block 0 body while presenting does NOT open diagram editor
      cy.get('[data-testid="md-mermaid-block-0"]').click();
      cy.url().should('not.include', 'diagram=');

      // D7 & D8: Step 1 -> MidCheck note is attached to step 0 (after Request, before Response), so it's visible;
      // active message 'Request' is within block 0's container
      cy.wait(250);
      cy.get('[data-testid="md-mermaid-svg-0"]').then(($host) => {
        const hostRect = rectOf($host);
        cy.get('[data-testid="md-mermaid-svg-0"] text.messageText')
          .first()
          .then(($msg) => {
            expect(rectWithin(rectOf($msg), hostRect)).to.equal(true);
          });
      });

      // D9: Keyboard rightArrow steps block 0 to Step 2/3, Esc exits and unwraps TransformWrapper
      cy.get('body').type('{rightArrow}');
      cy.get('[data-testid="md-mermaid-svg-0"] [data-testid="walkthrough-step-count"]').should('have.text', 'Step 2/3');
      cy.get('body').type('{esc}');
      cy.get('[data-testid="md-mermaid-svg-0"] .react-transform-wrapper').should('not.exist');
      cy.get('[data-testid="md-mermaid-svg-0"] .walkthrough-dimmed').should('have.length', 0);

      // D2: Present block 1 (flowchart diamond) -> 3 depth steps (Step 1/3)
      cy.get('[data-testid="md-mermaid-present-1"]').click();
      cy.get('[data-testid="md-mermaid-svg-1"] [data-testid="walkthrough-step-count"]').should('have.text', 'Step 1/3');
      cy.get('[data-testid="md-mermaid-svg-1"] [data-testid="walkthrough-exit"]').click();
      cy.get('[data-testid="md-mermaid-svg-1"] .react-transform-wrapper').should('not.exist');

      // D4: After exiting presentation, clicking block 0 body opens the diagram editor
      cy.get('[data-testid="md-mermaid-block-0"]').click();
      cy.url().should('include', 'diagram=0');
    });
  });

  it('D10: entering presenter mode from a markdown file keeps the diagram zoom (fit-to-width size unchanged)', () => {
    createMarkdown('walk-md-d10', MD).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('[data-testid="md-mermaid-svg-0"] svg', { timeout: 10000 }).should('exist');

      // The preview renders the SVG fit-to-width; remember its displayed size.
      let widthBefore = 0;
      cy.get('[data-testid="md-mermaid-svg-0"] svg').then(($svg) => {
        widthBefore = ($svg[0] as SVGElement).getBoundingClientRect().width;
        expect(widthBefore).to.be.greaterThan(0);
      });

      // Enter presenter mode: the fresh TransformWrapper must start at scale 1
      // with the diagram at the same fit-to-width size (not the ~300px
      // intrinsic default, and not a zoomed crop).
      cy.get('[data-testid="md-mermaid-present-0"]').click();
      cy.get('[data-testid="md-mermaid-svg-0"] [data-testid="walkthrough-step-count"]')
        .should('have.text', 'Step 1/3');
      cy.wait(300); // let the entry auto-pan settle

      cy.get('[data-testid="md-mermaid-svg-0"] svg').then(($svg) => {
        const after = ($svg[0] as SVGElement).getBoundingClientRect();
        expect(after.width).to.be.closeTo(widthBefore, 6);
      });
      cy.get('[data-testid="md-mermaid-svg-0"] .react-transform-component').then(($comp) => {
        expect(($comp[0] as HTMLElement).style.transform).to.contain('scale(1)');
      });

      // Stepping to the next message pans but keeps the same size/zoom.
      cy.get('[data-testid="walkthrough-next"]').click();
      cy.wait(300);
      cy.get('[data-testid="md-mermaid-svg-0"] svg').then(($svg) => {
        const after = ($svg[0] as SVGElement).getBoundingClientRect();
        expect(after.width).to.be.closeTo(widthBefore, 6);
      });
      cy.get('[data-testid="md-mermaid-svg-0"] .react-transform-component').then(($comp) => {
        expect(($comp[0] as HTMLElement).style.transform).to.contain('scale(1)');
      });
    });
  });

  it('D6: hides Present button on empty or non-diagram markdown blocks', () => {
    createMarkdown('walk-md-bad', MD_BAD).then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('[data-testid="md-mermaid-empty-0"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="md-mermaid-not-diagram-1"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid^="md-mermaid-present-"]').should('not.exist');
    });
  });
});

describe('E. Robustness & state', () => {
  it('E1: disables Present button and shows no bar for unsupported or empty .mmd files', () => {
    createDiagram('walk-empty-e1', 'pie\n  "A" : 50\n  "B" : 50').then(({ dir, name }) => {
      cy.visit(appUrl(name, dir));
      cy.get('[data-testid="present-toggle"]').should('be.disabled');
      cy.get('[data-testid="walkthrough-bar"]').should('not.exist');
    });
  });

  it('E2 & E3: works in dark theme and updates step count cleanly when diagram is edited mid-presentation', () => {
    createDiagram('walk-dark-e2', SEQ_NUM).then(({ dir, name }) => {
      // E3: Visit with dark theme and presentation on
      cy.visit(appUrl(name, dir, { theme: 'dark', present: '1' }));
      cy.get('#diagram-container svg').should('exist');
      bar().should('have.text', 'Step 1/2');
      cy.get('#diagram-container [data-et="message"]').filter('.walkthrough-dimmed').should('have.length', 1);

      // E2: Add a message via toolbar while presenting -> step count updates to 1/3
      cy.get('button[title="Exit edit mode"]').should('exist');
      cy.get('button[title="Add Message"]').click();
      bar().should('have.text', 'Step 1/3');
      cy.get('#diagram-container [data-et="message"]').filter('.walkthrough-dimmed').should('have.length', 2);
    });
  });
});
