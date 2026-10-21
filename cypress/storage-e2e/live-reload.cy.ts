// Storage-suite live-reload spec (STORAGE_BACKENDS plan §5.4, scenario E8):
// an external write — with no page refresh — is adopted by the open page:
// the canvas re-renders with the new message and the "Reloaded from disk"
// notice appears.
//
// External-writer mechanics per backend (tasks in cypress.storage.config.ts):
//  - fs: write to disk; the chokidar watcher feeds the SSE stream.
//  - memory: a second HTTP client POSTs through the API; the write pulses the
//    shared storageEvents emitter (memory has no external writer by design).
//  - s3: PutObject via task, picked up by the server's polling watcher — the
//    runner boots the s3 leg with S3_POLL_INTERVAL_MS=1000, hence the
//    generous timeouts.
//
// Timing note: the s3 polling watcher establishes its baseline on its first
// tick after the page's SSE connection opens. The canvas assertions between
// cy.visit and the external write span several Cypress round trips, which
// keeps the external write safely past that baseline; every later poll tick
// diffs against it, so a slow tick delays the reload but never loses it.

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the script-style specs occupy (see storage-surface.cy.ts).
export {}

const SEQ_V1 = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello`;

const SEQ_V2 = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: External hello`;

const qs = (dir: string) => `?dir=${encodeURIComponent(dir)}`;
const fileApi = (name: string, dir: string) => `/api/file/${name}${qs(dir)}`;
const appUrl = (name: string, dir: string) => `/?dir=${encodeURIComponent(dir)}&file=${name}`;

describe('Live reload (E8, all backends)', () => {
  it('an external change is adopted by the open page without a refresh', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('live.mmd', dir), { content: SEQ_V1 });
      })
      .then(() => {
        cy.visit(appUrl('live.mmd', dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Hello').should('exist');
        cy.get('#diagram-container').contains('External hello').should('not.exist');
      })
      .then(() => cy.task('storageExternalWrite', { dir, file: 'live.mmd', content: SEQ_V2 }))
      .then(() => {
        // The notice appears together with the adopted content and lives 5s,
        // so assert it first, then the canvas.
        cy.get('[data-testid="reload-notice"]', { timeout: 20000 })
          .should('be.visible')
          .and('contain.text', 'Reloaded from disk');
        cy.get('#diagram-container', { timeout: 20000 }).contains('External hello').should('exist');
        // The adopted content is the external version, byte for byte.
        cy.get('#diagram-container').contains('Hello').should('exist');
      });
  });

  it('an external change to another file in the same dir does not touch the open file', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('live.mmd', dir), { content: SEQ_V1 });
      })
      .then(() => cy.request('POST', fileApi('other.mmd', dir), { content: SEQ_V2 }))
      .then(() => {
        cy.visit(appUrl('live.mmd', dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Hello').should('exist');
      })
      .then(() =>
        // Rewrite the OTHER file: the SSE event names other.mmd, so the
        // open page must stay on its own content.
        cy.task('storageExternalWrite', { dir, file: 'other.mmd', content: SEQ_V1 }),
      )
      .then(() => {
        // Fixed wait — the polling case the plan sanctions a fixed timer for:
        // on s3 the event arrives within one S3_POLL_INTERVAL_MS tick, on
        // fs/memory it is already there. Only then is "no reload" meaningful.
        cy.wait(2500);
        cy.get('[data-testid="reload-notice"]').should('not.exist');
        cy.get('#diagram-container').contains('External hello').should('not.exist');
        cy.get('#diagram-container').contains('Hello').should('exist');
      });
  });
});
