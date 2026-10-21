// Storage-suite save-conflict spec (STORAGE_BACKENDS plan §5.4, scenario E9).
// Deterministic: the external write lands before the save job runs, so the
// job's expectedContent check fails and nothing is written. The true-CAS
// IfMatch path (a write landing between the job's read and its write) is a
// race by nature and is covered per backend by
// src/lib/storage/storageBackend.conformance.test.ts instead.
//
// Backend-agnostic: the active backend comes from Cypress.env('storageBackend')
// (fs | memory | s3), set by the runner (scripts/e2e-storage.mjs). The external
// write goes through the storageExternalWrite task (fs: disk, memory: second
// HTTP client, s3: PutObject).

// Module marker: keeps this spec's top-level helpers out of the shared global
// scope that the script-style specs occupy (see storage-surface.cy.ts).
export {}

// Cypress.env() was removed in Cypress 16; the runner passes the backend kind
// via --expose (the sanctioned replacement for non-sensitive values), readable
// synchronously through Cypress.expose().
const backend = () =>
  (Cypress.expose() as { storageBackend?: string }).storageBackend as 'fs' | 'memory' | 's3'

const MD_V1 = `# Notes

Intro prose.

\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Embedded
\`\`\`

Outro prose.
`;

// Same document with the embedded block (and only the block) changed.
const MD_V2 = MD_V1.replace('A->>B: Embedded', 'A->>B: Rewritten externally');

const qs = (dir: string) => `?dir=${encodeURIComponent(dir)}`;
const fileApi = (name: string, dir: string) => `/api/file/${name}${qs(dir)}`;

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

const loadBlock = (dir: string, file: string, index: number) =>
  cy
    .request('GET', `/api/markdown/diagram?file=${file}&index=${index}&dir=${encodeURIComponent(dir)}`)
    .then((res) => res.body.content as string);

const enqueueSave = (dir: string, file: string, index: number, content: string, expectedContent: string) =>
  cy.request('POST', `/api/markdown/save${qs(dir)}`, { file, index, content, expectedContent });

describe('Save conflict (E9, all backends)', () => {
  it('an external change between load and block-save fails the job with code conflict and writes nothing', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('notes.md', dir), { content: MD_V1 });
      })
      .then(() => loadBlock(dir, 'notes.md', 0))
      .then((original) => {
        const edited = original.replace('A->>B: Embedded', 'A->>B: Edited in the app');
        return cy
          .task('storageExternalWrite', { dir, file: 'notes.md', content: MD_V2 })
          .then(() => enqueueSave(dir, 'notes.md', 0, edited, original))
          .then((enq) => {
            expect(enq.status).to.eq(202);
            return waitForJob(enq.body.jobId);
          })
          .then((job) => {
            expect(job.status).to.eq('failed');
            expect(job.code).to.eq('conflict');
            return cy.request('GET', fileApi('notes.md', dir));
          })
          .then((file) => {
            // The failed job wrote nothing: the file is still the external version.
            expect(file.body.content).to.eq(MD_V2);
          });
      });
  });

  it('a save based on the current on-disk block succeeds afterwards (the store is not wedged)', () => {
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('POST', fileApi('notes.md', dir), { content: MD_V1 });
      })
      .then(() => loadBlock(dir, 'notes.md', 0))
      .then((original) => {
        // External change first, then a conflicting save...
        return cy
          .task('storageExternalWrite', { dir, file: 'notes.md', content: MD_V2 })
          .then(() => enqueueSave(dir, 'notes.md', 0, original, original))
          .then((enq) => waitForJob(enq.body.jobId))
          .then((job) => {
            expect(job.status).to.eq('failed');
            expect(job.code).to.eq('conflict');
          })
          // ...then a correct save: re-read the block the job will see and
          // base the edit on it.
          .then(() => loadBlock(dir, 'notes.md', 0))
          .then((current) => {
            const edited = current.replace('A->>B: Rewritten externally', 'A->>B: Edited in the app');
            return enqueueSave(dir, 'notes.md', 0, edited, current);
          })
          .then((enq) => waitForJob(enq.body.jobId))
          .then((job) => {
            expect(job.status).to.eq('done');
            return cy.request('GET', fileApi('notes.md', dir));
          })
          .then((file) => {
            const content = file.body.content as string;
            expect(content).to.contain('A->>B: Edited in the app');
            expect(content).to.contain('Intro prose.');
            expect(content).to.contain('Outro prose.');
            expect(content).to.not.contain('Embedded');
          });
      });
  });

  it('sanity: the backend reports itself through /api/files', () => {
    // Keeps this spec self-contained if it is ever run alone.
    let dir = '';
    cy.task<string>('createTempDiagramDir')
      .then((d) => {
        dir = d;
        return cy.request('GET', `/api/files${qs(dir)}`);
      })
      .then((res) => {
        expect(res.body.backend).to.eq(backend());
      });
  });
});
