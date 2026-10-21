import { defineConfig } from 'cypress'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'

// Storage e2e suite (STORAGE_BACKENDS plan §5.3) — separate from the main
// suite (cypress.config.ts: baseUrl :3000, fs backend only). This suite runs
// against the server the runner (scripts/e2e-storage.mjs) boots on :3100 with
// the leg's backend. The backend kind and the S3 connection details arrive via
// Cypress env (--env storageBackend=fs|memory|s3,...), set by the runner.
//
// Spec membership (plan §5.3, Step 10 classification): the main-suite specs
// that assert on data round-tripping through a storage backend, plus the
// storage-specific specs in cypress/storage-e2e/. markdown-persistence is
// excluded: it seeds by writing straight to disk (cy.writeFile), which only
// the fs backend can observe — on memory/s3 the seeded file would never
// appear and the spec would fail for reasons unrelated to storage behavior.
//
// Tasks (per-backend mechanics that a browser spec cannot do itself):
//  - createTempDiagramDir: fresh temp dir (fs path; doubles as a namespace /
//    key prefix for memory/s3).
//  - storageExternalWrite({dir, file, content}): the "external writer" of
//    E8/E9 — fs: write to disk; memory: POST through the API (a second HTTP
//    client); s3: PutObject.
//  - storageReadRaw({dir, file}): backend-native read-back — fs: read disk;
//    memory: GET through the API; s3: GetObject.
//  - storageSetBackendDown/Up({dir}): the "backend down" of E11 — fs: rename
//    the dir away and back (chmod 555 does not stop root); s3: down/up the s3
//    test server via scripts/s3-test-server.mjs (LocalStack container or local
//    moto_server process, whichever the runner started — the endpoint is a
//    fixed port either way). Bringing it back re-creates the bucket and
//    re-seeds the fixtures, because both servers are in-memory and the stop
//    wiped them; memory: no-op (E11 is N/A there).

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      const backend = (config.env.storageBackend as string) || 'fs'
      const baseUrl = (config.baseUrl as string) || 'http://localhost:3100'

      const s3Bucket = () => config.env.storageS3Bucket as string
      const s3Endpoint = () => config.env.storageS3Endpoint as string
      const s3Client = () =>
        new S3Client({
          region: (config.env.storageS3Region as string) || 'us-east-1',
          endpoint: s3Endpoint(),
          forcePathStyle: true,
          credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        })
      // Mirror of validateStorageDir(dir, 's3'): leading/trailing slashes are
      // stripped, interior slashes stay (an absolute temp path becomes a
      // nested prefix).
      const s3Prefix = (dir: string) => dir.replace(/^\/+|\/+$/g, '')
      const s3Key = (dir: string, file: string) => {
        const prefix = s3Prefix(dir)
        return prefix === '' ? file : `${prefix}/${file}`
      }
      const apiUrl = (name: string, dir: string) =>
        `${baseUrl}/api/file/${encodeURIComponent(name)}?dir=${encodeURIComponent(dir)}`

      // Seed the bucket root with the ./diagrams fixtures — the same seeding
      // the runner does at leg start (config.env.storageSeedDir overrides the
      // directory; defaults to ./diagrams relative to the Cypress cwd).
      const seedRootFixtures = async (client: S3Client) => {
        const seedDir = (config.env.storageSeedDir as string) || path.join(process.cwd(), 'diagrams')
        const names = fs
          .readdirSync(seedDir)
          .filter((name) => /\.(mmd|md|markdown)$/i.test(name))
          .sort()
        for (const name of names) {
          await client.send(
            new PutObjectCommand({
              Bucket: s3Bucket(),
              Key: name,
              Body: fs.readFileSync(path.join(seedDir, name)),
            }),
          )
        }
        return names.length
      }

      // Bring the s3 test server (LocalStack container or local moto_server
      // process) back after a down: any HTTP response from the endpoint means
      // it is listening again. Both servers are in-memory, so a stop wiped the
      // bucket — re-create it and re-seed below.
      const waitForEndpoint = async (timeoutMs: number) => {
        const deadline = Date.now() + timeoutMs
        for (;;) {
          try {
            await fetch(s3Endpoint())
            return
          } catch {
            if (Date.now() > deadline) {
              throw new Error(`S3 endpoint at ${s3Endpoint()} did not come back up`)
            }
            await sleep(500)
          }
        }
      }
      // Drive the s3 test server lifecycle through the same control CLI the
      // runner uses (scripts/s3-test-server.mjs); the state file path arrives
      // via config.env.storageS3StateFile.
      const s3Control = (command: 'down' | 'up') =>
        execFileSync(
          process.execPath,
          [path.join(process.cwd(), 'scripts', 's3-test-server.mjs'), command],
          {
            env: {
              ...process.env,
              S3_E2E_STATE_FILE: config.env.storageS3StateFile as string,
            },
            stdio: 'pipe',
          },
        )
      const ensureBucket = async (client: S3Client) => {
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            await client.send(new CreateBucketCommand({ Bucket: s3Bucket() }))
            return
          } catch (err) {
            const name = (err as { name?: string })?.name ?? ''
            if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return
            await sleep(500)
          }
        }
        throw new Error(`could not re-create bucket ${s3Bucket()}`)
      }

      on('task', {
        createTempDiagramDir() {
          return fs.mkdtempSync(path.join(os.tmpdir(), 'cypress-storage-'))
        },

        async storageExternalWrite({ dir, file, content }: { dir: string; file: string; content: string }) {
          if (backend === 'fs') {
            await fsp.writeFile(path.join(dir, file), content, 'utf-8')
            return null
          }
          if (backend === 'memory') {
            const res = await fetch(apiUrl(file, dir), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            })
            if (!res.ok) throw new Error(`storageExternalWrite(memory) failed: HTTP ${res.status}`)
            return null
          }
          await s3Client().send(
            new PutObjectCommand({ Bucket: s3Bucket(), Key: s3Key(dir, file), Body: content }),
          )
          return null
        },

        async storageReadRaw({ dir, file }: { dir: string; file: string }): Promise<string> {
          if (backend === 'fs') {
            return fsp.readFile(path.join(dir, file), 'utf-8')
          }
          if (backend === 'memory') {
            const res = await fetch(apiUrl(file, dir))
            if (!res.ok) throw new Error(`storageReadRaw(memory) failed: HTTP ${res.status}`)
            return (await res.json()).content as string
          }
          const res = await s3Client().send(
            new GetObjectCommand({ Bucket: s3Bucket(), Key: s3Key(dir, file) }),
          )
          const chunks: Buffer[] = []
          for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
            chunks.push(Buffer.from(chunk))
          }
          return Buffer.concat(chunks).toString('utf-8')
        },

        async storageSetBackendDown({ dir }: { dir: string }) {
          if (backend === 'fs') {
            await fsp.rename(dir, `${dir}.down`)
            return null
          }
          if (backend === 's3') {
            s3Control('down')
            return null
          }
          return null // memory: cannot fail by construction (E11 is N/A)
        },

        async storageSetBackendUp({ dir }: { dir: string }) {
          if (backend === 'fs') {
            await fsp.rename(`${dir}.down`, dir)
            return null
          }
          if (backend === 's3') {
            s3Control('up')
            await waitForEndpoint(90_000)
            const client = s3Client()
            await ensureBucket(client)
            await seedRootFixtures(client)
            return null
          }
          return null
        },
      })

      return config
    },
    baseUrl: 'http://localhost:3100',
    supportFile: false,
    specPattern: [
      // Membership subset (main-suite specs that round-trip data through a
      // storage backend) — see the comment at the top of this file.
      'cypress/e2e/viewer.cy.ts',
      'cypress/e2e/markdown.cy.ts',
      'cypress/e2e/editor.cy.ts',
      'cypress/e2e/inline-label-edit.cy.ts',
      'cypress/e2e/markdown-preview-views.cy.ts',
      'cypress/e2e/markdown-wysiwyg.cy.ts',
      // Storage-specific specs (E1–E13 scenario matrix §5.4).
      'cypress/storage-e2e/**/*.cy.ts',
    ],
  },
})
