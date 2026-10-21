// Storage-suite dirs spec (STORAGE_BACKENDS plan §5.1.2/§5.4): the `dir`
// query parameter maps to a filesystem path (fs), a namespace (memory), or an
// S3 object-key prefix (s3). Covers per-leg default-dir seeding, cross-dir
// isolation, and the per-backend dir validation rules.
//
// Backend-agnostic: the active backend comes from Cypress.env('storageBackend')
// (fs | memory | s3), set by the runner (scripts/e2e-storage.mjs).

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the script-style specs occupy (see storage-surface.cy.ts).
export {}

// Cypress.env() was removed in Cypress 16; the runner passes the backend kind
// via --expose (the sanctioned replacement for non-sensitive values), readable
// synchronously through Cypress.expose().
const backend = () =>
  (Cypress.expose() as { storageBackend?: string }).storageBackend as 'fs' | 'memory' | 's3'

const SEQ_A = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: From dir A`;

const SEQ_B = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: From dir B`;

const qs = (dir: string) => `?dir=${encodeURIComponent(dir)}`;
const fileApi = (name: string, dir: string) => `/api/file/${name}${qs(dir)}`;

describe('Storage dirs (all backends)', () => {
  it('D1: the default dir (no ?dir=) serves the fixtures the runner seeded for the leg', () => {
    // fs leg: ./diagrams on disk. memory leg: MEMORY_STORAGE_SEED_DIR seeded
    // into the 'default' namespace. s3 leg: the runner PutObject'ed the same
    // fixtures at the bucket root ('' is the s3 default prefix).
    cy.request('GET', '/api/files').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.backend).to.eq(backend());
      expect(res.body.files.length).to.be.greaterThan(0);
      expect(res.body.files).to.include('main.mmd');
      expect(res.body.markdownFiles).to.include('markdown-demo.md');
    });
    // NB: /api/dir-check is not probed here — the route requires an explicit
    // ?dir= and reports exists:false without one (by design); dir-check on
    // explicit dirs is covered by E7 and D3.
  });

  it('D2: two dirs are isolated — each lists and serves only its own files', () => {
    let dirA = '';
    let dirB = '';
    cy.task<string>('createTempDiagramDir')
      .then((a) => {
        dirA = a;
        return cy.task<string>('createTempDiagramDir');
      })
      .then((b) => {
        dirB = b;
        return cy.request('POST', fileApi('a.mmd', dirA), { content: SEQ_A });
      })
      .then(() => cy.request('POST', fileApi('b.mmd', dirB), { content: SEQ_B }))
      .then(() => cy.request('GET', `/api/files${qs(dirA)}`))
      .then((res) => {
        expect(res.body.files).to.deep.equal(['a.mmd']);
        expect(res.body.markdownFiles).to.deep.equal([]);
        return cy.request('GET', `/api/files${qs(dirB)}`);
      })
      .then((res) => {
        expect(res.body.files).to.deep.equal(['b.mmd']);
        // Read-level isolation: a.mmd does not exist in dir B's namespace/prefix.
        return cy.request({ url: fileApi('a.mmd', dirB), failOnStatusCode: false });
      })
      .then((res) => {
        expect(res.status).to.eq(404);
        expect(res.body.code).to.eq('not-found');
        return cy.request('GET', fileApi('a.mmd', dirA));
      })
      .then((res) => {
        expect(res.body.content).to.eq(SEQ_A);
      });
  });

  it('D3: dir validation matches the backend', () => {
    if (backend() === 'memory') {
      // Namespaces reject control characters.
      cy.request({ url: `/api/files${qs('bad\x01ns')}`, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.code).to.eq('invalid-name');
      });
    } else if (backend() === 's3') {
      // Prefixes reject '..' segments (prefix escape) and backslashes.
      cy.request({ url: `/api/files${qs('..')}`, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.code).to.eq('invalid-name');
        return cy.request({ url: `/api/files${qs('a\\b')}`, failOnStatusCode: false });
      }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.code).to.eq('invalid-name');
      });
    } else {
      // fs: dirs are filesystem paths — no name validation. A missing dir is
      // created by listFiles (today's mkdir -p behavior, unchanged).
      let base = '';
      cy.task<string>('createTempDiagramDir')
        .then((d) => {
          base = d;
          return cy.request('GET', `/api/files${qs(`${d}/fresh-sub`)}`);
        })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.files).to.deep.equal([]);
          expect(res.body.markdownFiles).to.deep.equal([]);
          return cy.request('GET', `/api/dir-check${qs(`${base}/fresh-sub`)}`);
        })
        .then((res) => {
          expect(res.body.exists).to.eq(true);
        });
    }
  });
});
