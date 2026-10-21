// Storage-suite error-mode spec (STORAGE_BACKENDS plan §5.4, scenario E11):
// with the backend down, a UI edit fails to save and the save indicator
// surfaces the failure; with the backend back, the next edit saves again.
//
// Per-backend "down" mechanics (tasks in cypress.storage.config.ts):
//  - fs: rename the temp dir away (the plan's chmod 555 does not stop root,
//    which is what CI runners and this dev machine run as; a missing dir
//    fails the write with not-found). The rename is also an external
//    deletion, which the page's live-reload stream would adopt: refetch ->
//    404 -> empty content -> editor wiped, and empty source parses as
//    diagram type 'unknown', which disables edit mode entirely. That
//    adoption is E8's behavior and races this spec, so the live-reload
//    stream is disabled for it (EventSource stubbed in onBeforeLoad) — the
//    save path under test is untouched.
//  - s3: docker stop the LocalStack container — connection refused, retried,
//    then unavailable. The polling watcher stays silent while the endpoint is
//    down (no SSE event, no adoption), so the canvas stays intact; the stub
//    is harmless there and keeps both legs on one edit path.
//  - memory: N/A by construction — an in-process Map cannot fail; the plan
//    documents this and the test is skipped (visible as pending).
//
// Recovery: both legs reload the page after the backend returns (fresh client
// state — also sidesteps any adoption racing the recovery edit) and rename
// the participant label through the side panel. The s3 leg re-creates the
// test file through the API first: bringing LocalStack back re-creates the
// bucket and re-seeds the fixtures (LocalStack is in-memory; the stop wiped
// them).

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the script-style specs occupy (see storage-surface.cy.ts).
export {}

// Cypress.env() was removed in Cypress 16; the runner passes the backend kind
// via --expose (the sanctioned replacement for non-sensitive values), readable
// synchronously through Cypress.expose(). Read at load time so the memory leg
// can skip the test up front.
const backend = (Cypress.expose() as { storageBackend?: string }).storageBackend as 'fs' | 'memory' | 's3';
const itUnlessMemory = backend === 'memory' ? it.skip : it;

const SEQ = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello`;

const qs = (dir: string) => `?dir=${encodeURIComponent(dir)}`;
const fileApi = (name: string, dir: string) => `/api/file/${name}${qs(dir)}`;
const appUrl = (name: string, dir: string) => `/?dir=${encodeURIComponent(dir)}&file=${name}`;

// Disable the page's live-reload stream for this spec (see header). The app
// only uses `new EventSource(url)`, `.onmessage`, and `.close()`, so a no-op
// stand-in is enough; nothing in E11 depends on live-reload events.
const stubLiveReload = (win: Window) => {
  class NoopEventSource {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    readyState = 0;
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false;
    }
  }
  (win as unknown as { EventSource: unknown }).EventSource = NoopEventSource;
};

const visitApp = (name: string, dir: string) => {
  cy.visit(appUrl(name, dir), { onBeforeLoad: stubLiveReload });
};

// Side-panel edit: select participant A and rename its label.
const editParticipantViaSidePanel = (from: string, to: string) => {
  cy.get('#diagram-container g[data-et="participant"][data-id="A"] text.actor').first().click();
  cy.contains('label', 'Label').find('input').should('have.value', from);
  cy.contains('label', 'Label').find('input').clear().type(to);
};

const renderReady = () => {
  cy.get('#diagram-container svg').should('exist');
  cy.get('#diagram-container', { timeout: 15000 }).contains('Hello').should('exist');
};

describe('Save error modes (E11)', () => {
  itUnlessMemory('a save failure surfaces in the indicator; saving recovers when the backend returns', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('err.mmd', dir), { content: SEQ });
      })
      .then(() => {
        visitApp('err.mmd', dir);
        renderReady();
      })
      .then(() => cy.task('storageSetBackendDown', { dir }))
      .then(() => {
        // API-level proof the backend is down (not just the UI).
        cy.request({ url: fileApi('err.mmd', dir), failOnStatusCode: false }).then((res) => {
          if (backend === 'fs') {
            expect(res.status).to.eq(404);
            expect(res.body.code).to.eq('not-found');
          } else {
            expect(res.status).to.eq(503);
            expect(res.body.code).to.eq('unavailable');
          }
        });
      })
      .then(() => {
        // The canvas is intact (no adoption — see header), so a side-panel
        // edit triggers the debounced auto-save, which fails against the
        // down backend and surfaces in the indicator.
        editParticipantViaSidePanel('Alice', 'Alicia');
        cy.get('[data-testid="save-indicator"]', { timeout: 20000 }).should('have.text', 'Save failed');
        cy.get('[data-testid="save-error"]', { timeout: 10000 })
          .should('be.visible')
          .and('contain.text', "Contents aren't saved");
        if (backend === 's3') {
          cy.get('[data-testid="save-error"]').should('contain.text', 'Storage unavailable');
        }
      })
      .then(() => cy.task('storageSetBackendUp', { dir }))
      .then(() => {
        if (backend === 's3') {
          // The stop wiped the bucket (LocalStack is in-memory): re-create
          // the test file through the API before reloading the page.
          return cy.request('POST', fileApi('err.mmd', dir), { content: SEQ });
        }
      })
      .then(() => {
        // Fresh client state for the recovery edit.
        visitApp('err.mmd', dir);
        renderReady();
      })
      .then(() => {
        editParticipantViaSidePanel('Alice', 'Alicia2');
        cy.get('[data-testid="save-indicator"]', { timeout: 20000 }).should('have.text', 'Saved');
        // And the save really landed on the backend.
        cy.task<string>('storageReadRaw', { dir, file: 'err.mmd' }).then((raw) => {
          expect(raw).to.contain('Alicia2');
          expect(raw).to.not.contain('Alice');
        });
      });
  });
});
