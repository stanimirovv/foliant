#!/usr/bin/env node
// Storage e2e runner (STORAGE_BACKENDS plan §5.3, Step 9).
//
// Usage: node scripts/e2e-storage.mjs <fs|memory|s3|all>
//
// Per leg, sequentially:
//   1. s3 leg only: start the s3 test server via scripts/s3-test-server.mjs —
//      LocalStack in Docker via @testcontainers/localstack when a Docker daemon
//      answers, otherwise a local moto_server process (no Docker; auto-
//      provisioned into .venv-s3/). Then create the bucket mermaid-viewer-e2e
//      and seed the ./diagrams fixtures at the bucket root (the s3 default dir
//      is the '' prefix) via @aws-sdk/client-s3.
//   2. s3 leg only: run the storage unit/conformance suite
//      (npx vitest run src/lib/storage) with STORAGE_TEST_S3_ENDPOINT set —
//      the only leg that can exercise the s3 conformance leg.
//   3. Spawn `node server.js` on PORT=3100 with the leg's storage env and wait
//      for HTTP readiness (Next cold-compiles on first hit; up to 120s).
//   4. Run the storage Cypress suite:
//      npx cypress run --config-file cypress.storage.config.ts \
//        --env storageBackend=<leg>[,...]
//   5. Tear down: kill the server, stop the s3 test server.
//
// Requires the Cypress binary (npx cypress install). The s3 leg needs either a
// Docker daemon (LocalStack leg, the R6 configuration used in CI) or python3
// (moto_server fallback leg). The main e2e suite (npm run test:e2e,
// cypress.config.ts, baseUrl :3000, fs only) is untouched by this runner.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`
const S3_BUCKET = 'mermaid-viewer-e2e'
const S3_TEST_SERVER_CLI = path.join(ROOT, 'scripts', 's3-test-server.mjs')
const S3_STATE_FILE = path.join(os.tmpdir(), 'mermaid-e2e-s3-test-server.json')
const CYPRESS_BIN = path.join(ROOT, 'node_modules', '.bin', 'cypress')
const VITEST_BIN = path.join(ROOT, 'node_modules', '.bin', 'vitest')

const LEGS = ['fs', 'memory', 's3']
const arg = process.argv[2] || 'all'
const legs = arg === 'all' ? LEGS : [arg]
if (!legs.every((l) => LEGS.includes(l)) || legs.length === 0) {
  console.error(`Usage: node scripts/e2e-storage.mjs <${[...LEGS, 'all'].join('|')}>`)
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(leg, msg) {
  console.log(`\n[e2e-storage:${leg}] ${msg}`)
}

// Spawn the app server; returns the child. Output is forwarded with a prefix
// and kept in a tail buffer for failure reports.
function spawnServer(leg, env) {
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tail = []
  const forward = (stream, prefix) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        tail.push(line)
        if (tail.length > 200) tail.shift()
        console.log(`${prefix} ${line}`)
      }
    })
    stream.on('end', () => {
      if (buf) console.log(`${prefix} ${buf}`)
    })
  }
  forward(child.stdout, `[server:${leg}]`)
  forward(child.stderr, `[server:${leg}:err]`)
  child.tail = tail
  return child
}

async function waitForServer(child, leg, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `server exited during boot (code ${child.exitCode}):\n${(child.tail || []).join('\n')}`,
      )
    }
    try {
      const res = await fetch(`${BASE_URL}/api/files`)
      if (res.ok) {
        const body = await res.json()
        log(leg, `server ready on :${PORT} (backend=${body.backend})`)
        return
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`server did not become ready within ${timeoutMs / 1000}s`)
    }
    await sleep(500)
  }
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', resolve)
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 5_000).unref?.()
    setTimeout(resolve, 8_000).unref?.()
  })
}

function runSync(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  return res.status ?? 1
}

// --- s3 leg -----------------------------------------------------------------

// Drive the s3 test server through the control CLI (scripts/s3-test-server.mjs):
// LocalStack via testcontainers when a Docker daemon answers, else a local
// moto_server process. The CLI owns the server lifecycle (including the E11
// down/up cycles, triggered from the Cypress tasks via the same state file).
function s3TestServer(command) {
  const res = spawnSync(process.execPath, [S3_TEST_SERVER_CLI, command], {
    cwd: ROOT,
    env: { ...process.env, S3_E2E_STATE_FILE: S3_STATE_FILE, S3_E2E_BUCKET: S3_BUCKET },
    encoding: 'utf-8',
  })
  if (res.status !== 0) {
    throw new Error(
      `s3-test-server ${command} failed (code ${res.status}):\n${res.stdout}\n${res.stderr}`,
    )
  }
  return res.stdout
}

function startS3TestServer() {
  s3TestServer('start')
  const state = JSON.parse(fs.readFileSync(S3_STATE_FILE, 'utf-8'))
  return state.endpoint
}

async function seedS3Bucket(endpoint) {
  const { S3Client, CreateBucketCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  })
  await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
  const seedDir = path.join(ROOT, 'diagrams')
  const names = fs
    .readdirSync(seedDir)
    .filter((name) => /\.(mmd|md|markdown)$/i.test(name))
    .sort()
  for (const name of names) {
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: name, // the s3 default dir is the '' prefix: keys at the bucket root
        Body: fs.readFileSync(path.join(seedDir, name)),
      }),
    )
  }
  return names.length
}

// --- legs -------------------------------------------------------------------

async function runLeg(leg) {
  const started = Date.now()
  let server = null
  let endpoint = null
  try {
    let serverEnv = {}
    let cypressEnv = `storageBackend=${leg}`

    if (leg === 's3') {
      log(leg, 'starting s3 test server (LocalStack via testcontainers if Docker is available, else local moto_server)...')
      endpoint = startS3TestServer()
      log(leg, `s3 test server up at ${endpoint}`)
      const seeded = await seedS3Bucket(endpoint)
      log(leg, `bucket ${S3_BUCKET} created, ${seeded} fixtures seeded at the root prefix`)

      log(leg, 'running storage unit/conformance suite (s3 conformance leg enabled)...')
      const vitestStatus = runSync(VITEST_BIN, ['run', 'src/lib/storage'], {
        env: {
          ...process.env,
          STORAGE_TEST_S3_ENDPOINT: endpoint,
          STORAGE_TEST_S3_BUCKET: S3_BUCKET,
        },
      })
      if (vitestStatus !== 0) throw new Error('storage unit/conformance suite failed (s3 leg)')

      serverEnv = {
        STORAGE_BACKEND: 's3',
        S3_BUCKET,
        S3_ENDPOINT: endpoint,
        S3_POLL_INTERVAL_MS: '1000', // E8: the polling watcher must see external PutObjects quickly
      }
      cypressEnv += `,storageS3Bucket=${S3_BUCKET},storageS3Endpoint=${endpoint},storageS3StateFile=${S3_STATE_FILE},storageSeedDir=${path.join(ROOT, 'diagrams')}`
    } else if (leg === 'memory') {
      serverEnv = {
        STORAGE_BACKEND: 'memory',
        MEMORY_STORAGE_SEED_DIR: './diagrams', // seeds the 'default' namespace
      }
    }
    // fs leg: server defaults (STORAGE_BACKEND=fs, ./diagrams).

    log(leg, `booting server (node server.js, PORT=${PORT})...`)
    server = spawnServer(leg, serverEnv)
    await waitForServer(server, leg)

    log(leg, 'running storage Cypress suite (cypress.storage.config.ts)...')
    const cypressStatus = runSync(CYPRESS_BIN, [
      'run',
      '--config-file',
      'cypress.storage.config.ts',
      // --env feeds the Node-side tasks (config.env); --expose feeds the
      // specs (Cypress.env() was removed in Cypress 16 — specs read the
      // backend kind synchronously via Cypress.expose()).
      '--env',
      cypressEnv,
      '--expose',
      `storageBackend=${leg}`,
    ])
    if (cypressStatus !== 0) throw new Error(`Cypress storage suite failed (${leg} leg)`)

    log(leg, `leg PASSED in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } finally {
    await stopServer(server)
    if (endpoint) {
      try {
        s3TestServer('stop')
        log(leg, 's3 test server stopped')
      } catch (err) {
        console.error(`[e2e-storage:${leg}] s3 test server teardown failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}

// --- main -------------------------------------------------------------------

const failures = []
for (const leg of legs) {
  try {
    await runLeg(leg)
  } catch (err) {
    failures.push(leg)
    console.error(`\n[e2e-storage:${leg}] leg FAILED: ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (failures.length > 0) {
  console.error(`\ne2e-storage: ${failures.length}/${legs.length} leg(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`\ne2e-storage: all ${legs.length} leg(s) passed (${legs.join(', ')})`)
