// Storage-suite surface spec (STORAGE_BACKENDS plan §5.4, scenarios E1, E3,
// E6, E7, E10, E12, E13). Backend-agnostic: the active backend comes from
// Cypress.env('storageBackend') (fs | memory | s3), set by the runner
// (scripts/e2e-storage.mjs). Backend-specific mechanics (external writes,
// raw reads) go through the storage tasks in cypress.storage.config.ts.

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the script-style specs occupy (several main-suite specs redeclare
// the same helper names — a pre-existing tsc condition).
export {}

// Cypress.env() was removed in Cypress 16; the runner passes the backend kind
// via --expose (the sanctioned replacement for non-sensitive values), readable
// synchronously through Cypress.expose() — at spec load time and in tests.
const backend = () =>
  (Cypress.expose() as { storageBackend?: string }).storageBackend as 'fs' | 'memory' | 's3'

const SEQ_V1 = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello`;

const SEQ_V2 = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;

const MD_DOC = `# Notes

Intro prose.

\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Embedded
\`\`\`

Outro prose.
`;

// Byte-identity fixture: CRLF, lone CR, unicode, emoji, trailing newline.
const BYTE_EDGE = 'sequenceDiagram\r\n    A->>B: crlf\r\n    A->>B: lone\rCR\n    A->>B: üñïçødé 汉字 🚀\n';

const qs = (dir: string) => `?dir=${encodeURIComponent(dir)}`;
const fileApi = (name: string, dir: string) => `/api/file/${name}${qs(dir)}`;
const appUrl = (name: string, dir: string) => `/?dir=${encodeURIComponent(dir)}&file=${name}`;

const waitForJob = (jobId: string) => {
  const poll = (): Cypress.Chainable =>
    cy.request(`/api/jobs/${jobId}`).then((res) => {
      if (res.body.status === 'queued' || res.body.status === 'running') {
        return poll();
      }
      return cy.wrap(res.body);
    });
  return poll();
};

describe('Storage surface (all backends)', () => {
  it('E1: lists files, separates .mmd from .md, loads and renders a diagram', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('alpha.mmd', dir), { content: SEQ_V1 });
      })
      .then(() => cy.request('POST', fileApi('notes.md', dir), { content: MD_DOC }))
      .then(() => cy.request('GET', `/api/files${qs(dir)}`))
      .then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.files).to.deep.equal(['alpha.mmd']);
        expect(res.body.markdownFiles).to.deep.equal(['notes.md']);
        expect(res.body.backend).to.eq(backend());
      })
      .then(() => {
        cy.visit(appUrl('alpha.mmd', dir));
        cy.get('#diagram-container svg').should('exist');
        cy.get('#diagram-container').contains('Hello').should('exist');
        // the markdown file shows in the sidebar with its embedded diagram
        cy.contains('notes.md').should('be.visible');
      });
  });

  it('E3: saved views round-trip through the %% CONFIG: header', () => {
    const withViews = `%% CONFIG: {"version":1,"views":[{"name":"Compact","hiddenPaths":["flow=checkout"]}]}\n${SEQ_V1}`;
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('views.mmd', dir), { content: withViews });
      })
      .then(() => cy.request('GET', fileApi('views.mmd', dir)))
      .then((res) => {
        expect(res.body.content).to.eq(withViews);
      })
      .then(() => {
        cy.visit(appUrl('views.mmd', dir));
        cy.get('#diagram-container svg').should('exist');
        // the saved view round-trips: it is offered in the Saved Views list
        cy.get('[data-testid="saved-view-Compact"]', { timeout: 10000 })
          .should('be.visible')
          .and('contain.text', 'Compact');
        // applying it syncs the URL state
        cy.get('[data-testid="saved-view-Compact"]').click();
        cy.url().should('include', 'view=Compact');
      });
  });

  it('E6: a new file created through the API appears in the sidebar and is readable', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('fresh.mmd', dir), { content: SEQ_V1 });
      })
      .then(() => {
        cy.visit(`/?dir=${encodeURIComponent(dir)}`);
        cy.contains('fresh.mmd').should('be.visible');
        cy.request('GET', fileApi('fresh.mmd', dir)).then((res) => {
          expect(res.body.content).to.eq(SEQ_V1);
        });
      });
  });

  it('E7: dir-check distinguishes existing from missing dirs (and the documented empty-S3-prefix divergence)', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        const missing = `${d}/missing-sub`;
        // missing dir/namespace/prefix -> exists:false everywhere
        return cy.request('GET', `/api/dir-check${qs(missing)}`).then((res) => {
          expect(res.body.exists).to.eq(false);
        });
      })
      .then(() => cy.request('POST', fileApi('seed.mmd', dir), { content: SEQ_V1 }))
      .then(() => cy.request('GET', `/api/dir-check${qs(dir)}`))
      .then((res) => {
        expect(res.body.exists).to.eq(true);
      })
      .then(() => {
        if (backend() === 's3') {
          // Documented divergence: an S3 prefix with zero objects cannot
          // "exist", even after /api/files listed it.
          const empty = `${dir}/empty-prefix`;
          return cy.request('GET', `/api/files${qs(empty)}`)
            .then(() => cy.request('GET', `/api/dir-check${qs(empty)}`))
            .then((res) => {
              expect(res.body.exists).to.eq(false);
            });
        }
      });
  });

  it('E10: read missing file -> 404 not-found; invalid filename -> 400 invalid-name', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request({ url: fileApi('missing.mmd', dir), failOnStatusCode: false });
      })
      .then((res) => {
        expect(res.status).to.eq(404);
        expect(res.body.code).to.eq('not-found');
        return cy.request({
          url: `/api/file/${encodeURIComponent('../escape.mmd')}${qs(dir)}`,
          failOnStatusCode: false,
        });
      })
      .then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.code).to.eq('invalid-name');
      });
  });

  it('E12: whole-file save is byte-identical on the backend (CRLF, unicode, emoji, trailing newline)', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('bytes.mmd', dir), { content: BYTE_EDGE });
      })
      .then(() => cy.request('GET', fileApi('bytes.mmd', dir)))
      .then((res) => {
        expect(res.body.content).to.eq(BYTE_EDGE);
      })
      .then(() =>
        cy.task<string>('storageReadRaw', { dir, file: 'bytes.mmd' }).then((raw) => {
          // Backend-native read (fs: disk; s3: GetObject; memory: the API is
          // the backend, so this is the same read as above).
          expect(raw).to.eq(BYTE_EDGE);
        }),
      );
  });

  it('E13: two rapid saves serialize; the final content is one of the two, never interleaved', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        // Two parallel POSTs from the browser; the server's serial write
        // queue must order them.
        return cy.window().then((win) =>
          Promise.all([
            win.fetch(fileApi('race.mmd', dir), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: SEQ_V1 }),
            }),
            win.fetch(fileApi('race.mmd', dir), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: SEQ_V2 }),
            }),
          ]).then((rs) => {
            rs.forEach((r) => expect(r.ok).to.eq(true));
          }),
        );
      })
      .then(() => cy.request('GET', fileApi('race.mmd', dir)))
      .then((res) => {
        expect([SEQ_V1, SEQ_V2]).to.include(res.body.content);
      });
  });

  it('E5: markdown doc — list embedded diagrams, save one through the job, document otherwise intact', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('notes.md', dir), { content: MD_DOC });
      })
      .then(() => cy.request('GET', `/api/markdown/diagrams?file=notes.md&dir=${encodeURIComponent(dir)}`))
      .then((res) => {
        expect(res.body.diagrams).to.have.length(1);
        return cy.request('GET', `/api/markdown/diagram?file=notes.md&index=0&dir=${encodeURIComponent(dir)}`);
      })
      .then((res) => {
        const original = res.body.content as string;
        const edited = original.replace('A->>B: Embedded', 'A->>B: Edited');
        return cy
          .request('POST', `/api/markdown/save${qs(dir)}`, {
            file: 'notes.md',
            index: 0,
            content: edited,
            expectedContent: original,
          })
          .then((enq) => {
            expect(enq.status).to.eq(202);
            return waitForJob(enq.body.jobId);
          })
          .then((job) => {
            expect(job.status).to.eq('done');
            return cy.request('GET', fileApi('notes.md', dir));
          })
          .then((file) => {
            const content = file.body.content as string;
            expect(content).to.contain('A->>B: Edited');
            expect(content).to.contain('Intro prose.');
            expect(content).to.contain('Outro prose.');
          });
      });
  });
});
