# Storage Backends — Tech Plan (two epochs)

**Date:** 2026-10-20
**Status:** Plan only — nothing implemented yet.
**Scope:** Introduce a storage abstraction layer with three swappable backends (file system
— default, in-memory, Amazon S3), defined error modes, and a dedicated e2e suite that
verifies every backend, separate from the main e2e suite.

This document is the product of two epochs. **Epoch 1** is the first-pass plan.
**Epoch 2** is the second pass: an audit of Epoch 1 that adds detail and captures what
the first pass missed (error modes, per-backend semantics, test scenarios, edge cases),
followed by the refined, authoritative plan. Where the two differ, Epoch 2 wins.

---

## 1. Context: the storage surface today

The app is a local-first Next.js 14 viewer/editor (custom `server.js`, port 3000) for
`.mmd` diagrams and `.md` documents with embedded Mermaid diagrams. All persistence goes
through eight route handlers; there is no database.

| Route | Method | Storage operation | Notes |
|---|---|---|---|
| `/api/files` | GET | list directory | Splits into `.mmd` files and `.md`/`.markdown` files. Side effect today: `mkdir -p` the dir. |
| `/api/file/[filename]` | GET | read file | 400 on invalid name, 404 on read failure. |
| `/api/file/[filename]` | POST | whole-file write | Serialized through `diskWriteQueue` (process-wide FIFO on `globalThis`); write + read-back byte verification (`writeFileVerified` / `writeMarkdownFileVerified` in `src/lib/fileStore.ts`). `.md` saves additionally verify embedded diagrams. |
| `/api/markdown/save` | POST | background block-save job | 202 + `jobId`. Job re-reads the file at job time, compare-and-swaps the target fenced block against `expectedContent` (`JobError('conflict')` on mismatch), splices by AST offsets, verifies, writes atomically (`runMarkdownSaveJob` in `src/lib/markdownSave.ts`). Dependencies (`readFile`, `writeFileAtomic`) are already injected. |
| `/api/jobs/[id]` | GET | poll job | 404 unknown id; returns `{id, status, code, error}`. |
| `/api/markdown/diagrams` | GET | read file + block metadata | Menu metadata for embedded diagrams. |
| `/api/markdown/diagram` | GET | read one block | 400 bad index, 404 missing block/file. |
| `/api/dir-check` | GET | directory exists probe | Never creates; distinguishes "gone" from "empty". |
| `/api/events` | GET | SSE live reload | `chokidar` per-directory watcher → `{event, file}` events filtered to `.mmd`/`.md`/`.markdown`. Client connects via `EventSource`. |

Key facts that shape the plan:

- **Everything worth persisting lives in file content.** Saved views, actor colors, arrow
  styles/animations, sticky notes, and tags all ride in the `%% CONFIG:` JSON header of
  the `.mmd` / fenced block (`src/lib/views.ts`). Client-side `localStorage` holds only UI
  prefs and the recent-directories list — out of scope for this plan.
- **The `dir` concept is first-class**: `?dir=` URL param, `DIAGRAMS_DIR` env,
  `./diagrams` default, recent-dirs in localStorage, `dir-check` probe.
- **File-name validation** (`resolveDiagramFilePath` in `src/lib/config.ts`) rejects:
  empty, `/`, `\`, `.`, `..`, absolute paths. No length cap, no control-character check.
- **Next.js dev compiles each route into its own bundle.** The codebase already works
  around this with `globalThis` singletons (`diskWriteQueue`) and duck-typed `JobError`
  codes. Any new per-process state (backend instance, in-memory store, event emitter,
  write queue) must follow the same pattern or state will silently split across routes.
- **Test setup**: Vitest (unit, jsdom) + Cypress (e2e, 19 specs, ~4.4k lines,
  `cypress/e2e/`, `baseUrl: http://localhost:3000`, requires a manually started
  `npm run dev`; `createTempDiagramDir` Cypress task for isolated temp dirs).
- There are no DELETE/PUT routes. "New file" creation is a POST to `/api/file/[filename]`.

---

## 2. Requirements

| ID | Requirement | Source |
|---|---|---|
| R1 | A storage abstraction layer isolates storage volatility: route handlers and the save job depend on an interface, never on `fs`/S3 directly. | User |
| R2 | Three backends behind that interface: **file system (default)**, **in-memory** (scratchpads/testing), **Amazon S3**. | User |
| R3 | Every feature that exists today works on every backend. | User |
| R4 | Error modes are defined: a stable taxonomy with per-backend causes, HTTP mapping, and client surfacing. | User |
| R5 | E2E tests verify all storage backends in a **separate suite** from the main e2e suite; the main suite keeps using file storage. | User |
| R6 | The S3 e2e suite runs against LocalStack, driven from Node.js via Amazon's published AWS SDK (`@aws-sdk/client-s3`) and a Node LocalStack runner (`@testcontainers/localstack`). | User |
| R7 | Derived: zero-config compatibility — existing deployments (no env changes) behave exactly as today (fs backend). | Plan |
| R8 | Derived: the plan is produced in two epochs; the second pass adds detail and hunts for missing scenarios and edge cases. | User |

---

## 3. Epoch 1 — first-pass plan

### 3.1 Design sketch

- `src/lib/storage/types.ts` — `StorageBackend` interface:
  `listFiles(dir)`, `readFile(dir, filename)`, `writeFile(dir, filename, content)`,
  `dirExists(dir)`, optional `watch(dir, cb)`.
- `src/lib/storage/index.ts` — `getStorageBackend()`: reads `STORAGE_BACKEND`
  (`fs` | `memory` | `s3`, default `fs`), instantiates once, caches on `globalThis`.
- `src/lib/storage/fileSystemBackend.ts` — moves today's fs logic (atomic write, verify,
  chokidar watch) behind the interface. Zero behavior change.
- `src/lib/storage/memoryBackend.ts` — `Map`-based namespaces keyed by `dir`.
- `src/lib/storage/s3Backend.ts` — `@aws-sdk/client-s3`; `dir` maps to an object-key
  prefix in `S3_BUCKET`.
- All eight route handlers call the backend instead of `fs`. Validation, job queue,
  and error-message shapes unchanged.
- The markdown save job keeps its injected `readFile`/`writeFileAtomic` deps, now
  supplied by the active backend.
- Separate Cypress config (`cypress.storage.config.ts`) + `cypress/storage-e2e/` specs;
  LocalStack started in the suite setup; npm scripts per backend.

### 3.2 Step outline

1. Extract storage types + backends (fs first), wire routes, keep default fs — main e2e green.
2. Memory backend + unit conformance tests (fs + memory legs).
3. S3 backend + LocalStack-driven conformance leg.
4. Storage e2e suite: parameterized specs, runner script, npm scripts.
5. Docs + CI job.

**Epoch 1 self-assessment:** meets R1, R2, R5, R6, R7 at a coarse level. Known gaps the
second pass must close: no defined error taxonomy (R4), no per-backend semantic
decisions (what does `dir` mean on memory/S3? what does live-reload mean without
chokidar?), no CAS story for S3, no test-scenario matrix, no edge-case list.

---

## 4. Epoch 2 — audit findings: what the first pass missed

The second pass re-read the requirements and the current storage surface against the
Epoch 1 sketch. Findings, each of which changes the plan:

1. **Error modes were undefined (R4).** Epoch 1 had happy-path + today's `verify-failed`
   only. Need a `StorageError` taxonomy, per-backend cause mapping, HTTP status mapping,
   retry policy, and client surfacing via the save indicator.
2. **The `dir` concept has no meaning on memory/S3.** The whole UI is directory-centric
   (`?dir=`, recent dirs, `dir-check`). The plan must define `dir` → namespace (memory)
   and `dir` → key prefix (S3), including sanitization and `dir-check` semantics per
   backend (an empty S3 prefix cannot "exist" — documented divergence).
3. **CAS was only at block-content level.** Today's save job checks `expectedContent`
   then writes unconditionally; an external write landing between job-read and job-write
   is lost silently. S3 gives us real conditional writes (`IfMatch` ETag) — the interface
   should carry a `version` on reads and an `ifMatchVersion` on writes so **all three**
   backends get true compare-and-swap (fs/memory: sha256 of content, checked inside the
   serial write queue).
4. **The Next.js dev per-route-bundle trap applies to new state.** The memory backend's
   `Map`, the event emitter, and the write queue must live on `globalThis`, or each route
   bundle gets its own memory store and the memory backend silently stops working in dev.
5. **Live reload is chokidar-specific.** Without a plan, memory/S3 lose live reload.
   Unified notification design: a per-dir emitter on `globalThis` that every backend's
   writes pulse (API-mediated changes), with chokidar (fs) and optional S3 polling
   (`ListObjectsV2` ETag diff) feeding it for external changes. External-change reload is
   fs + polling-s3 only; memory is API-mediated only. Documented per-backend difference.
6. **S3 listing paginates at 1000 keys** (`ListObjectsV2`) — must paginate or large
   directories silently truncate.
7. **Shared filename rules need tightening for S3.** S3 keys allow almost anything up to
   1024 bytes; filesystems cap name components at 255 bytes. Add a shared 255-byte cap in
   the validator so all backends behave identically (only rejects names that would fail
   on common filesystems anyway).
8. **The e2e suite can't just clone all 19 specs.** Define a membership criterion
   ("asserts on data that round-trips through storage"), classify empirically, and add
   storage-specific specs (conflict, error modes, live reload, dirs) with per-backend
   external-writer mechanics.
9. **Server lifecycle for e2e.** The backend is chosen by server env, so the storage
   suite needs a runner that boots the server per backend (and LocalStack for S3) on a
   separate port (`PORT` env support in `server.js`).
10. **Seeding.** UI smoke specs need fixture diagrams. fs uses `./diagrams`; memory
    needs a seed mechanism (`MEMORY_STORAGE_SEED_DIR`); S3 needs the runner to `PutObject`
    the fixtures into the bucket/prefix.
11. **Byte-identity edge cases** the verify step must preserve: CRLF, unicode, emoji,
    trailing newlines. S3 stores bytes; read-back as UTF-8 string; no newline
    normalization anywhere in the backend layer.
12. **Memory backend volatility is a feature, not a bug** — but it must be documented and
    surfaced (banner when `STORAGE_BACKEND=memory`), because a user could mistake it for
    durable storage.

---

## 5. Epoch 2 — refined plan (authoritative)

### 5.1 Architecture

#### 5.1.1 Interface (`src/lib/storage/types.ts`)

```ts
export type StorageErrorCode =
  | 'invalid-name'   // filename/dir fails shared validation        → HTTP 400
  | 'not-found'      // file (or dir) does not exist                 → HTTP 404
  | 'conflict'       // compare-and-swap version mismatch            → job code 'conflict'
  | 'verify-failed'  // read-back after write is not byte-identical  → HTTP 500, "Contents aren't saved: …"
  | 'unavailable'    // backend unreachable / misconfigured / full   → HTTP 503
  | 'forbidden'      // permission denied                            → HTTP 403
  | 'too-large'      // payload/key over backend limit               → HTTP 413
  | 'unknown';       // anything else                                → HTTP 500

export class StorageError extends Error {
  code: StorageErrorCode;
  cause?: unknown;
  constructor(code: StorageErrorCode, message: string, cause?: unknown);
}

export interface FileListing { files: string[]; markdownFiles: string[]; }

export interface FileVersion { content: string; version: string; }

export interface StorageChangeEvent { event: string; file: string; }

export interface StorageBackend {
  readonly name: 'fs' | 'memory' | 's3';
  listFiles(dir: string): Promise<FileListing>;
  readFile(dir: string, filename: string): Promise<string>;              // throws not-found
  readFileVersion(dir: string, filename: string): Promise<FileVersion>;  // throws not-found
  /** Atomic + read-back verified write. If `ifMatchVersion` is given and the
   *  current version differs, throws `conflict` and writes nothing. */
  writeFile(dir: string, filename: string, content: string,
            opts?: { ifMatchVersion?: string }): Promise<void>;
  dirExists(dir: string): Promise<boolean>;
  /** External-change notifications. Optional: fs implements it via chokidar,
   *  s3 via polling (config-gated). API-mediated write events are emitted by
   *  every backend through `storageEvents` regardless. */
  watch?(dir: string, onChange: (e: StorageChangeEvent) => void): () => void;
}
```

`version` semantics per backend: **fs/memory** = sha256 of content at read time
(checked inside the process-wide serial write queue before the write lands);
**s3** = the object ETag, enforced natively via `IfMatch` on `PutObject`.

#### 5.1.2 File layout

```
src/lib/storage/
  types.ts                  StorageError, codes, StorageBackend, FileListing, FileVersion
  validate.ts               validateDiagramFileName (extracted from config.ts, +255-byte cap),
                            validateStorageDir per backend kind
  index.ts                  getStorageBackend() (globalThis singleton), storageWriteQueue
                            (globalThis serial queue, renamed from diskWriteQueue),
                            storageEvents (globalThis per-dir emitter), env config readers
  fileSystemBackend.ts      today's fs logic behind the interface
  memoryBackend.ts          Map<namespace, Map<filename, {content, version}>>
  s3Backend.ts              @aws-sdk/client-s3, prefix mapping, retries, polling watch
  storageBackend.conformance.test.ts   shared conformance suite, run per backend
scripts/
  e2e-storage.mjs           storage-suite runner (localstack lifecycle, seed, server boot, cypress)
cypress.storage.config.ts   separate e2e config (baseUrl http://localhost:3100)
cypress/storage-e2e/        storage suite specs
```

#### 5.1.3 Backend selection and configuration

| Env var | Backend | Meaning | Default |
|---|---|---|---|
| `STORAGE_BACKEND` | all | `fs` \| `memory` \| `s3` | `fs` |
| `DIAGRAMS_DIR` | fs | default diagrams directory | `./diagrams` |
| `MEMORY_STORAGE_SEED_DIR` | memory | optional directory to seed the default namespace from at boot | unset |
| `S3_BUCKET` | s3 | bucket (required) | — |
| `S3_ENDPOINT` | s3 | custom endpoint (LocalStack) | unset (real S3) |
| `S3_REGION` | s3 | region | `us-east-1` |
| `S3_FORCE_PATH_STYLE` | s3 | path-style addressing (required by LocalStack) | `true` when `S3_ENDPOINT` set |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | s3 | standard AWS SDK env credentials | — |
| `S3_POLL_INTERVAL_MS` | s3 | external-change polling for live reload | `0` (off) |
| `PORT` | all | server port (`server.js`) | `3000` |

Unknown `STORAGE_BACKEND` → fail fast at boot with a clear message (misconfiguration is
a boot error, not a per-request 503). Missing `S3_BUCKET` with `STORAGE_BACKEND=s3` →
same.

#### 5.1.4 `dir` mapping per backend

| Backend | `dir` means | Default dir | `listFiles` side effect | `dirExists` semantics |
|---|---|---|---|---|
| fs | filesystem path (tilde-expanded, absolute) — today's behavior | `DIAGRAMS_DIR` or `./diagrams` | creates the directory (`mkdir -p`, today's behavior) | `stat().isDirectory()` |
| memory | namespace key (any non-empty string) | `default` | creates the namespace (parity with fs `mkdir -p`) | namespace present in the map |
| s3 | object-key prefix inside `S3_BUCKET` | `''` (bucket root) | none (a prefix needs no creation) | bucket reachable AND (root OR ≥1 object under the prefix). **Divergence:** an empty prefix reports `exists: false` — S3 has no empty directories. Documented. |

`validateStorageDir` per kind: fs → today's `resolveDirPath` (unchanged); memory →
non-empty, no control characters; s3 → strip leading/trailing slashes, reject `..`
segments and backslashes (prefix-escape guard). The `?dir=` param keeps working
unchanged for fs; for memory/s3 it selects a namespace/prefix. Recent-dirs
(localStorage) is client-side and untouched.

#### 5.1.5 Write, verify, and CAS semantics per backend

All writes — both POST routes and the save job — run inside `storageWriteQueue`, the
process-wide FIFO serial queue (renamed from `diskWriteQueue`; the two call sites in the
routes are updated). Every `writeFile` ends with a read-back that must be
byte-identical, else `verify-failed` (this is today's guarantee, preserved).

| Backend | Atomicity mechanism | Version / CAS |
|---|---|---|
| fs | temp file in same dir + `fsync` + `rename` (today's `writeFileAtomic`); symlink write-through via `realpath`; existing file keeps its mode | sha256(content) at read; checked inside the serial queue before rename |
| memory | single-threaded `Map` set inside the serial queue — atomic by construction | per-key version counter + content hash, checked inside the serial queue |
| s3 | `PutObject` (S3 has no rename; atomicity = the object appears whole or not at all) + `GetObject` read-back verify | native ETag via `IfMatch` — a real cross-process CAS |

The markdown save job is upgraded to true CAS on every backend: `readFileVersion` →
existing block-content check (`JobError('conflict')` as today) → splice →
`writeFile(..., { ifMatchVersion })`. A `StorageError('conflict')` from the backend maps
to the same `JobError('conflict')` the client already handles. Normal-flow behavior is
unchanged (nothing else writes between read and write), so existing specs stay green.

#### 5.1.6 Change notification / live reload

One notification path: `storageEvents`, a per-dir emitter cached on `globalThis`
 keyed by backend kind + dir.

- **Every backend**: `writeFile` pulses the emitter (`{event: 'change', file}`) → SSE
  clients in the same process reload. This is what makes memory live-reload work for
  API-mediated changes (e.g., a second browser tab, or `cy.request` in tests).
- **fs**: additionally, chokidar per-dir watchers (today's mechanism) feed the same
  emitter → external edits live-reload, exactly as today.
- **memory**: no external writer exists by design; API-mediated events only.
- **s3**: API-mediated events + optional polling (`S3_POLL_INTERVAL_MS`, default off):
  `ListObjectsV2` with ETag/LastModified diff against a cached listing, emitting
  add/change/unlink. S3 event notifications → SQS/EventBridge is explicitly out of scope
  (noted as a future option).

The `/api/events` route subscribes to the emitter; the chokidar `dirs` map moves behind
the fs backend's `watch`. SSE client-cancel cleanup is preserved.

### 5.2 Error modes (R4)

#### 5.2.1 Taxonomy and HTTP mapping

Defined in `types.ts` (see 5.1.1). Route handlers map `StorageError` → status via one
shared helper (`storageErrorToResponse`); error bodies gain a `code` field
(`{ error, code }`) — additive, backward compatible. The save indicator surfaces
`conflict` ("file changed — reload"), `verify-failed` / `unknown` ("Contents aren't
saved: …", today's message), and `unavailable` ("Storage unavailable") distinctly.

#### 5.2.2 Per-backend causes

| Backend | `not-found` | `conflict` | `verify-failed` | `unavailable` | `forbidden` | `invalid-name` | `too-large` |
|---|---|---|---|---|---|---|---|
| fs | ENOENT on read | version hash mismatch inside queue | read-back ≠ written bytes | ENOSPC, EROFS, EDQUOT, EBUSY, EMFILE, dir on a gone mount | EACCES, EPERM | fails shared validator | name > 255 bytes; body over configured cap |
| memory | read of missing file | version counter/hash mismatch inside queue | read-back ≠ written (indicates a bug — fail loudly) | — (cannot be unavailable by construction) | — | fails shared validator | name > 255 bytes |
| s3 | NoSuchKey | `PreconditionFailed` (IfMatch ETag) | GetObject after Put ≠ written bytes | NoSuchBucket (misconfigured), endpoint down, throttling after retries, network errors | 403 from S3/LocalStack | fails shared validator; key > 1024 bytes | multipart/put limits (not realistic at our sizes) |

App-level errors stay app-level: invalid JSON body → 400, diagram index out of range →
404, unknown job id → 404 (unchanged).

#### 5.2.3 Retry policy

- **s3 only**: transient failures (throttling, 5xx from the endpoint, network
  `ECONNREFUSED`/`ETIMEDOUT`/`EPIPE`) retry up to 3 attempts, exponential backoff base
  200 ms with jitter (≈200/400/800 ms). After exhaustion → `unavailable`.
- **fs / memory**: fail fast, no retries (local operations; a retry would only mask
  real problems).

#### 5.2.4 Volatility statement (the point of R1)

- **fs**: durable, survives restart, externally editable, live-reloads external edits.
- **memory**: volatile — everything is lost on server restart; no external writer can
  exist; fastest; intended for scratchpads and testing. Surfaced with a UI banner when
  `STORAGE_BACKEND=memory`.
- **s3**: durable, shared across processes/machines, externally editable (live-reload
  via polling when enabled); the only backend with true cross-process CAS.

### 5.3 E2E strategy (R5, R6)

**Main suite — unchanged.** `cypress.config.ts`, `npm run test:e2e`, runs against the
default fs backend exactly as today (dev server, `./diagrams` fixtures, temp dirs).

**Storage suite — separate.**

- `cypress.storage.config.ts`: separate config, `baseUrl: http://localhost:3100`,
  specs in `cypress/storage-e2e/`, same `createTempDiagramDir` task plus new
  backend-aware tasks (below).
- `scripts/e2e-storage.mjs` (Node runner), invoked as
  `node scripts/e2e-storage.mjs <fs|memory|s3|all>`:
  1. **s3 leg only**: boot LocalStack via `@testcontainers/localstack` (the Node.js
     library that runs the official `localstack/localstack` container), wait for health,
     create bucket `mermaid-viewer-e2e` using `@aws-sdk/client-s3`
     (Amazon's official AWS SDK for JavaScript v3 — the Amazon-published Node.js library),
     seed the fixture diagrams (`diagrams/*.mmd`, `markdown-demo.md`) via `PutObject`.
  2. **memory leg**: server boots with `STORAGE_BACKEND=memory` +
     `MEMORY_STORAGE_SEED_DIR=./diagrams` (fixtures seeded into the default namespace).
  3. **fs leg**: server boots with defaults (real `./diagrams`).
  4. Spawn `node server.js` with the leg's env on `PORT=3100`, wait for HTTP readiness.
  5. Run `npx cypress run --config-file cypress.storage.config.ts`.
  6. Tear down: kill server, stop the LocalStack container, remove temp state.
- npm scripts: `test:e2e:storage` (all three legs sequentially),
  `test:e2e:storage:fs` / `:memory` / `:s3` (single leg).
- New Cypress tasks for per-backend mechanics: `storageExternalWrite({dir, file,
  content})` — fs: write to disk; memory: `POST /api/file/...` via `cy.request`-equivalent
  in Node (`fetch`); s3: `PutObject` via `@aws-sdk/client-s3`. And `storageSetBackendDown`
  / `storageSetBackendUp` for the s3 error-mode leg (stop/start the container).

**Spec membership criterion:** a main-suite spec joins the storage suite iff it asserts
on data that round-trips through a storage backend (file list, file content, saved
views/config, save-job outcome, live-reload events). Pure canvas-interaction specs stay
fs-only in the main suite. Initial membership (to be confirmed empirically in Step 10):
`viewer`, `markdown`, `markdown-persistence`, `markdown-preview-views`, `editor`,
`inline-label-edit`, `markdown-wysiwyg`. Storage-suite specs are written backend-agnostic:
they read the backend kind from `Cypress.env('storageBackend')` and use the tasks above
for backend-specific mechanics.

### 5.4 E2E scenario matrix

| # | Scenario | fs | memory | s3 | Backend-specific mechanics |
|---|---|---|---|---|---|
| E1 | List files; `.mmd` vs `.md` separation; load and render a diagram | ✓ | ✓ | ✓ | seed per leg (dir / seed env / PutObject) |
| E2 | Filter toggles + URL state sync + search highlight | ✓ | ✓ | ✓ | — |
| E3 | Saved views round-trip (save view in `%% CONFIG:`, reload, apply) | ✓ | ✓ | ✓ | — |
| E4 | Visual edit → auto-save → reload → edit persisted | ✓ | ✓ | ✓ | — |
| E5 | Markdown doc: open, list embedded diagrams, edit one diagram, save job succeeds, document otherwise intact | ✓ | ✓ | ✓ | poll `/api/jobs/[id]` until `done` |
| E6 | New-file creation appears in sidebar and is readable | ✓ | ✓ | ✓ | — |
| E7 | `dir-check`: existing vs missing dir | ✓ | ✓ | ✓ | memory/s3: namespace/prefix must be seeded first; empty s3 prefix → `exists:false` (assert the documented divergence) |
| E8 | Live reload without page refresh | ✓ | ✓ | ✓ | external writer: fs = write to disk; memory = second HTTP client (`cy.request`); s3 = `PutObject` via task + `S3_POLL_INTERVAL_MS=1000` in the runner |
| E9 | Save conflict: external change between load and block-save → job ends `code: 'conflict'`, file content unchanged | ✓ | ✓ | ✓ | external writer per E8; s3 additionally exercises `IfMatch` |
| E10 | Read missing file → 404; invalid filename (`../x`) → 400 | ✓ | ✓ | ✓ | pure API assertions (`cy.request`, `failOnStatusCode: false`) |
| E11 | Save failure surfaces in the save indicator | ✓ | N/A | ✓ | fs: `chmod 555` a temp dir → `forbidden`/`unavailable`; s3: stop LocalStack via task → `unavailable`; memory cannot fail by construction (asserted as N/A, documented) |
| E12 | Whole-file save verify path: content on backend is byte-identical (CRLF, unicode, emoji, trailing newline) | ✓ | ✓ | ✓ | read back via API and via backend-native means (fs: read disk; s3: `GetObject`) |
| E13 | Concurrency: two rapid saves serialize; final content is one of the two, never interleaved | ✓ | ✓ | ✓ | parallel `cy.request` POSTs |
| E14 | Storage-suite parity leg: the fs leg of the storage suite passes (proves the suite itself is backend-agnostic) | ✓ | — | — | — |

### 5.5 Edge cases (must be covered by unit conformance and/or e2e)

1. CRLF / lone-CR / unicode / emoji content round-trips byte-identically (no newline
   normalization in any backend).
2. Filenames: spaces, unicode, `..foo.mmd` (legal), `.hidden.mmd`, max length — shared
   255-byte cap; S3 key encoding (spaces/`+` must not be URL-mangled — the SDK handles
   keys as opaque strings; assert via round-trip).
3. Extension casing: `.MD`, `.Markdown` treated as markdown everywhere.
4. Scale: a ~5 MB diagram (the app targets 2000+ line files) round-trips; listing with
   50+ files works; **S3 `ListObjectsV2` pagination** (1000-key pages) is exercised with
   a >1000-object namespace in the s3 conformance leg.
5. Concurrent writes: N parallel whole-file writes serialize; final content is exactly
   one writer's; no torn state.
6. fs-only: symlinked file writes through to the real target (today's `realpath`
   behavior preserved); writing into a read-only dir → `forbidden`; missing parent dir
   is created by `listFiles` (today's `mkdir -p`).
7. memory: namespace created by `listFiles` (parity) and by `writeFile`; `dirExists`
   before any write → `false`; everything gone after "restart" (new backend instance) —
   the volatility contract.
8. s3: missing bucket → boot/request-time `unavailable` with a clear message; endpoint
   down → retries then `unavailable`; `PreconditionFailed` → `conflict`; empty prefix
   → `exists:false`, empty listing.
9. Save job: diagram index out of range → 404 (route) / job error; job for a file
   deleted between enqueue and run → `not-found` job error; unknown job id → 404.
10. SSE: multiple clients per dir; cancel removes the client; watcher per dir is created
    once (fs); events filtered to `.mmd`/`.md`/`.markdown`.
11. Next.js dev per-route bundles: backend instance, memory map, emitter, and write queue
    all on `globalThis` — verified by a dev-mode smoke test (two different routes writing
    and reading the same memory namespace).
12. Markdown save: block splice preserves surrounding prose byte-for-byte (existing
    `assertOnlyMermaidBlockChanged` verification, now running against every backend).

### 5.6 Steps

#### Step 1 — Storage types, validation, and error taxonomy

**Goal:** `src/lib/storage/types.ts` + `validate.ts` exist; `StorageError` with the 8
codes; `validateDiagramFileName` extracted from `config.ts` (which keeps
`resolveDiagramFilePath` delegating to it) with the shared 255-byte cap added;
`validateStorageDir` per backend kind; `storageErrorToResponse` helper.
**Covers:** R1, R4.
**Depends on:** nothing.
**Agent instructions:** Pure code, no I/O. Preserve the exact current rejection set
(empty, `/`, `\`, `.`, `..`, absolute) and add only the 255-byte cap. Map codes to
statuses per §5.2.1. Export `JobError`-compatible shapes so the save job can translate
`StorageError('conflict')` → `JobError('conflict')`.
**Tests (automated):** unit tests for the validator (the current rejection set + boundary
lengths + unicode), for `validateStorageDir` per kind, and for the code→status mapping.
**Human verification:** `npx vitest run src/lib/storage` green; `npm run dev` boots;
opening `/?file=main.mmd` renders as before.

#### Step 2 — Filesystem backend behind the interface (walking skeleton)

**Goal:** `fileSystemBackend.ts` implements `StorageBackend` with today's exact behavior
(atomic tmp+rename write, symlink write-through, mode preservation, read-back verify,
`mkdir -p` on list, chokidar `watch`); all eight route handlers call
`getStorageBackend()`; default `STORAGE_BACKEND=fs`. Zero user-visible change.
**Covers:** R1, R2 (fs leg), R7.
**Depends on:** Step 1.
**Agent instructions:** Move — don't rewrite — the fs logic out of the routes and
`fileStore.ts`. Keep `writeFileAtomic`/`writeFileVerified` semantics inside the backend;
the POST route may now use the atomic+verified path for all files (strictly stronger,
no visible change). Rename `diskWriteQueue` → `storageWriteQueue` in
`storage/index.ts` (on `globalThis`) and update the two call sites. `markdownSave.ts`
keeps its injected-deps shape; the route injects the backend's read/write.
**Tests (automated):** all existing Vitest suites pass unchanged; main Cypress suite
passes unchanged against the dev server.
**Human verification:** `npm run dev` → `npm run test:e2e` fully green; edit a diagram,
save, reload — persisted; external `touch`/edit of a file live-reloads the canvas.

#### Step 3 — Backend selection, env config, and server `PORT`

**Goal:** `STORAGE_BACKEND` selection with fail-fast boot errors (unknown backend,
missing `S3_BUCKET`); env config table (§5.1.3) implemented; `server.js` honors
`PORT` (default 3000).
**Covers:** R1, R2, R7.
**Depends on:** Step 2.
**Agent instructions:** Selection lives in `getStorageBackend()` on `globalThis`.
Config readers are pure functions over `process.env`. `server.js` change is two lines.
**Tests (automated):** unit tests for config parsing and selection (fs/memory/s3/unknown);
boot smoke test per backend value.
**Human verification:** `STORAGE_BACKEND=memory npm run dev` boots (empty state);
`STORAGE_BACKEND=bogus npm run dev` fails at boot with a clear message;
`PORT=3100 npm run dev` serves on 3100.

#### Step 4 — Memory backend + conformance suite (fs and memory legs)

**Goal:** `memoryBackend.ts` (namespaces keyed by `dir`, created by list/write,
serial-queue writes, version = counter + content hash, read-back verify, optional
`MEMORY_STORAGE_SEED_DIR`); `storageBackend.conformance.test.ts` — a shared suite
executed against memory (always) and fs (temp dir per test).
**Covers:** R2 (memory leg), R3 (memory leg), R4 (memory error modes).
**Depends on:** Steps 1–3.
**Agent instructions:** The `Map` lives inside the backend instance, which is cached on
`globalThis` — that is what keeps one store across route bundles in dev. Implement every
conformance case in §5.5 that applies. Emit API-write events via `storageEvents`.
**Tests (automated):** the conformance suite, both legs, green under `npx vitest run`.
**Human verification:** `STORAGE_BACKEND=memory MEMORY_STORAGE_SEED_DIR=./diagrams npm run dev` →
the demo diagrams appear in the sidebar; edit + save + reload persists for the process
lifetime; restart the server → data gone (volatility contract, expected).

#### Step 5 — S3 backend

**Goal:** `s3Backend.ts` on `@aws-sdk/client-s3`: prefix mapping per §5.1.4, path-style
when `S3_ENDPOINT` is set, `PutObject` + `GetObject` read-back verify, `IfMatch` ETag CAS,
`ListObjectsV2` **with pagination**, not-found/forbidden/unavailable mapping per §5.2.2,
retry policy per §5.2.3, optional polling `watch`.
**Covers:** R2 (s3 leg), R4 (s3 error modes), R6 (client library).
**Depends on:** Steps 1–3.
**Agent instructions:** Keys are `"<dir-prefix>/<filename>"`; dir = `''` → bucket root.
Never URL-encode keys yourself — pass them as opaque strings to the SDK. Treat
`NoSuchBucket` as misconfiguration (`unavailable`, message names `S3_BUCKET`).
**Tests (automated):** conformance suite s3 leg, gated on LocalStack reachability
(`STORAGE_TEST_S3_ENDPOINT` set; the runner/CI provides it) — covers pagination with a
>1000-object namespace, CAS conflict, retry-then-unavailable (dead endpoint).
**Human verification:** with LocalStack running (`docker run localstack/localstack`),
`STORAGE_BACKEND=s3 S3_BUCKET=demo S3_ENDPOINT=http://localhost:4566 npm run dev` after
creating the bucket → demo diagrams (seeded via a small script) render; save persists to
the bucket (`aws s3 ls` / `GetObject` shows the bytes).

#### Step 6 — True CAS in the markdown save job

**Goal:** the save job uses `readFileVersion` + `writeFile(..., { ifMatchVersion })` on
every backend; `StorageError('conflict')` maps to the existing `JobError('conflict')`;
the race between job-read and job-write is closed on all backends.
**Covers:** R3, R4 (`conflict`).
**Depends on:** Steps 2, 4, 5 (interface complete).
**Agent instructions:** Keep the block-content `expectedContent` check exactly as today
(it produces the user-facing conflict message); the version check is the additional
backstop. Job outcomes and codes visible to the client are unchanged.
**Tests (automated):** unit tests: stale `ifMatchVersion` → conflict, nothing written;
normal flow → done. Conformance suite gains a CAS case per backend.
**Human verification:** `markdown-persistence.cy.ts` (main suite, fs) still green;
conflict path covered by the new storage-suite conflict spec (Step 9).

#### Step 7 — Unified change notification / live reload

**Goal:** `storageEvents` per-dir emitter on `globalThis`; every backend's `writeFile`
pulses it; fs chokidar watchers feed it (external edits); s3 optional polling feeds it;
`/api/events` subscribes to the emitter; per-backend watch strategy per §5.1.6.
**Covers:** R1 (volatility isolation), R3 (live reload on every backend).
**Depends on:** Steps 2–5.
**Agent instructions:** Preserve event shape `{event, file}` and the
`.mmd`/`.md`/`.markdown` filter. Move the chokidar `dirs` map behind the fs backend's
`watch`. Preserve SSE cancel cleanup.
**Tests (automated):** unit tests per backend: API write emits; fs external write emits
(chokidar, temp dir); memory/s3 assert API-mediated emission and (s3, polling on)
external emission.
**Human verification:** with fs — edit a file in an IDE, canvas reloads (as today). With
memory — two browser tabs, edit in one, the other reloads. With s3 + polling — edit the
object externally, canvas reloads within ~2 s.

#### Step 8 — Error surfacing in routes and client

**Goal:** all routes return `{ error, code }` via the shared mapper; the save indicator
distinguishes `conflict` / `verify-failed` / `unavailable` / other; 503 for
`unavailable` (was 500 for all fs failures — verify the client tolerates 503 on list:
it already handles non-OK list responses).
**Covers:** R4.
**Depends on:** Steps 1–7.
**Agent instructions:** Error message strings that specs assert on ("Contents aren't
saved") must not change. Client change is small and additive (read `code` if present).
**Tests (automated):** unit tests for the route mapping (each code → status + body);
ClientPage/MarkdownEditor tests for indicator states.
**Human verification:** make the diagrams dir read-only → save shows the error state in
the indicator and the app stays usable; fix permissions → save recovers.

#### Step 9 — Storage e2e suite

**Goal:** `cypress.storage.config.ts`, `cypress/storage-e2e/` specs (membership subset +
`storage-surface`, `save-conflict`, `error-modes`, `live-reload`, `dirs`), the
`scripts/e2e-storage.mjs` runner with the LocalStack lifecycle via
`@testcontainers/localstack` + `@aws-sdk/client-s3`, per-backend Cypress tasks
(`storageExternalWrite`, `storageSetBackendDown/Up`), npm scripts
(`test:e2e:storage[:fs|:memory|:s3]`).
**Covers:** R5, R6, R3 (e2e proof per backend).
**Depends on:** Steps 1–8.
**Agent instructions:** Implement the scenario matrix §5.4. Specs are backend-agnostic;
backend mechanics go through tasks. The runner seeds fixtures per leg and sets
`S3_POLL_INTERVAL_MS=1000` for the s3 leg (E8). Keep the suite deterministic: explicit
waits on the save indicator / job polling, no `cy.wait` on fixed timers except the
polling case.
**Tests (automated):** the suite itself — all three legs green:
`npm run test:e2e:storage:fs`, `:memory`, `:s3`, and `npm run test:e2e:storage`.
**Human verification:** run each leg once and read the Cypress summary; confirm the s3
leg's container is torn down afterwards (`docker ps` shows no localstack).

#### Step 10 — Spec classification (empirical)

**Goal:** confirm the storage-suite membership: run every main-suite spec against the
memory backend (via the runner's memory leg) and keep in the storage suite exactly the
specs that assert on storage round-trips; move any surprise into the suite or document
why it stays fs-only.
**Covers:** R3, R5.
**Depends on:** Step 9.
**Agent instructions:** This is a measurement step; its output is the final membership
list in §5.3 (initial guess) confirmed or corrected, plus a one-paragraph rationale per
excluded spec.
**Tests (automated):** none new — the classification is verified by the runs themselves.
**Human verification:** read the classification table the step produces.

#### Step 11 — Documentation

**Goal:** README section: env-var table, backend semantics (`dir` mapping, volatility,
watch/live-reload behavior, CAS), error-code table, how to run both suites. Addendum in
`MANUAL_TEST_PLAN.md` for per-backend manual checks. Memory-mode banner copy.
**Covers:** R4 (documented error modes), R7.
**Depends on:** Steps 1–9.
**Agent instructions:** Match the existing README tone; tables over prose.
**Tests (automated):** none.
**Human verification:** read the new README section end-to-end; run one command from it.

#### Step 12 — CI

**Goal:** CI runs the main e2e job unchanged (fs) plus a separate storage-suite job
(docker available for LocalStack) running all three legs; unit conformance runs in the
existing test job (s3 leg gated on the job's LocalStack service).
**Covers:** R5, R6.
**Depends on:** Step 9.
**Agent instructions:** Keep the main job byte-identical in behavior. The storage job
uses the runner script so LocalStack lifecycle is identical to local.
**Tests (automated):** CI itself.
**Human verification:** watch one CI run of each job go green.

### 5.7 Traceability matrix

| Req | Implemented by | Verified by |
|---|---|---|
| R1 abstraction, volatility isolated | Steps 1, 2, 3, 7 | Conformance suite (per-backend identical behavior); dev-mode globalThis smoke test (edge case 11); §5.2.4 volatility statement |
| R2 three backends, fs default | Steps 2 (fs), 4 (memory), 5 (s3), 3 (selection) | Conformance suite all legs; storage e2e all legs; default-boot human check (Step 2) |
| R3 all features on every backend | Steps 2–9 | Main e2e (fs, unchanged) + storage e2e per backend (E1–E14) + Step 10 classification |
| R4 defined error modes | Steps 1, 5, 6, 8 | §5.2 taxonomy unit tests; conformance error cases; storage e2e E9–E11 |
| R5 separate e2e suite, main stays fs | Step 9, 12 | `test:e2e:storage*` scripts; main `test:e2e` untouched |
| R6 LocalStack via Amazon's Node.js SDK | Steps 5, 9, 12 | s3 conformance leg; s3 e2e leg (runner boots LocalStack via `@testcontainers/localstack`, uses `@aws-sdk/client-s3`) |
| R7 zero-config compatibility | Steps 2, 3 | Default-boot behavior unchanged; main e2e + full unit suite green without any env |
| R8 two-epoch plan | This document | §3 (epoch 1), §4 (audit findings), §5 (epoch 2) |

---

## 6. Assumptions and open questions

1. **Library interpretation (please confirm).** "The nodejs amazon published localstack
   library" is implemented as: `@aws-sdk/client-s3` — Amazon's official AWS SDK for
   JavaScript v3, the Amazon-published Node.js S3 client — pointed at a LocalStack
   endpoint, with LocalStack itself provisioned from Node by `@testcontainers/localstack`
   (the standard Node.js library that runs the official `localstack/localstack` image).
   There is no npm package literally named `localstack` published by Amazon (the bare
   `localstack` package on npm is an unrelated 2015 utility). If you meant a different
   package, the seams (backend constructor, runner script) make it a one-line change.
2. **Single server process.** The serial write queue and the in-process event emitter
   assume one Node process (true today: `node server.js`). Multi-process deployments
   would need the queue/emitter externalized; out of scope.
3. **Memory backend is volatile by design** — scratchpads and testing, never the place
   for documents you care about. Surfaced with a banner.
4. **localStorage stays client-side** (recent dirs, UI prefs) — not part of the storage
   abstraction.
5. **Empty-directory semantics diverge on S3** (no empty prefixes) — documented in
   §5.1.4 and asserted in E7 rather than hidden.
6. **S3 external-change live reload requires polling** (`S3_POLL_INTERVAL_MS`); the e2e
   s3 leg enables it at 1 s. S3 event notifications are a future option, out of scope.
