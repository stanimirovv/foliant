#!/usr/bin/env node
// S3 test-server control CLI for the storage e2e suite (STORAGE_BACKENDS plan
// §5.3, Step 9). Two interchangeable local S3 servers behind one interface:
//
//   testcontainers  LocalStack in Docker via @testcontainers/localstack — the R6
//                   configuration, used by default when a Docker daemon answers
//                   (CI, dev machines with Docker).
//   moto            moto_server (pip package 'moto[server]') running as a plain
//                   local process — no Docker required. The binary is
//                   auto-provisioned into .venv-s3/ on first use (needs python3).
//
// Both modes bind a FIXED host port (S3_E2E_PORT, default 4566) so the endpoint
// survives down/up cycles: the app server under test boots once with S3_ENDPOINT
// and must be able to reconnect after a backend restart (E11 recovery). A
// testcontainers container normally maps a random host port, which is why the
// LocalStack container is started with an explicit host binding. Both servers are
// in-memory, so after an up cycle the bucket and fixtures are gone — callers
// re-create the bucket and re-seed (see the storageSetBackendUp Cypress task).
//
// Usage: node scripts/s3-test-server.mjs <start|stop|down|up>
//   start  stop any stale server, start a fresh one, write the state file, print
//          the endpoint on the last stdout line
//   stop   stop the server and remove the state file (final teardown)
//   down   stop the server but keep the state file (E11: simulate backend failure)
//   up     start the server again on the same port (E11 recovery)
//
// Env:
//   S3_E2E_SERVER      'testcontainers' | 'moto' — default: auto (Docker daemon
//                      reachable ? testcontainers : moto)
//   S3_E2E_STATE_FILE  state file (default <os.tmpdir()>/mermaid-e2e-s3-test-server.json)
//   S3_E2E_PORT        fixed host port (default 4566)
//   S3_E2E_BUCKET      bucket name recorded in the state file (default mermaid-viewer-e2e)
//   S3_E2E_CONTAINER   container name, testcontainers mode (default mermaid-viewer-e2e-localstack)
//   S3_E2E_VENV        venv dir for moto mode (default <repo>/.venv-s3)
//   MOTO_SERVER_BIN    explicit moto_server binary (default <venv>/bin/moto_server)

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.S3_E2E_PORT || 4566)
const BUCKET = process.env.S3_E2E_BUCKET || 'mermaid-viewer-e2e'
const CONTAINER = process.env.S3_E2E_CONTAINER || 'mermaid-viewer-e2e-localstack'
const VENV = process.env.S3_E2E_VENV || path.join(ROOT, '.venv-s3')
const STATE_FILE =
  process.env.S3_E2E_STATE_FILE || path.join(os.tmpdir(), 'mermaid-e2e-s3-test-server.json')
const ENDPOINT = `http://localhost:${PORT}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return null
  }
}
const writeState = (state) => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
const removeState = () => {
  try {
    fs.unlinkSync(STATE_FILE)
  } catch {
    // already gone
  }
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killPid(pid) {
  if (!pidAlive(pid)) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  for (let i = 0; i < 25; i += 1) {
    await sleep(200)
    if (!pidAlive(pid)) return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
  await sleep(500)
}

const dockerDaemonUp = () => {
  // `docker info` exits 0 with empty output when the daemon is down (Docker
  // Desktop CLI quirk) — `docker version` fails instead, and its server version
  // line is non-empty only when the daemon actually answered.
  const res = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    timeout: 8_000,
    encoding: 'utf-8',
  })
  return res.status === 0 && Boolean(res.stdout && res.stdout.trim())
}

function selectMode() {
  const forced = process.env.S3_E2E_SERVER
  if (forced) {
    if (forced !== 'testcontainers' && forced !== 'moto') {
      throw new Error(`S3_E2E_SERVER must be 'testcontainers' or 'moto', got '${forced}'`)
    }
    return forced
  }
  return dockerDaemonUp() ? 'testcontainers' : 'moto'
}

// Any HTTP response (even an error status) means the endpoint is listening.
async function waitForEndpoint(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await fetch(ENDPOINT)
      return
    } catch {
      if (Date.now() > deadline) {
        throw new Error(
          `S3 test server at ${ENDPOINT} did not become ready within ${timeoutMs / 1000}s ` +
            `(is the port busy? set S3_E2E_PORT to override)`,
        )
      }
      await sleep(500)
    }
  }
}

function resolveMotoBin() {
  if (process.env.MOTO_SERVER_BIN) return process.env.MOTO_SERVER_BIN
  const venvBin = path.join(VENV, 'bin', 'moto_server')
  if (fs.existsSync(venvBin)) return venvBin
  const onPath = spawnSync('moto_server', ['--version'], { stdio: 'ignore' })
  if (!onPath.error && onPath.status === 0) return 'moto_server'
  return null
}

function provisionVenv() {
  const py = spawnSync('python3', ['--version'], { stdio: 'ignore' })
  if (py.error || py.status !== 0) {
    throw new Error(
      'No Docker daemon and no moto_server found. Install one of:\n' +
        "  - Docker (the testcontainers/LocalStack leg is used automatically), or\n" +
        `  - python3 + 'moto[server]' (this script auto-provisions ${VENV} when python3 is available;\n` +
        '    or set MOTO_SERVER_BIN to an existing moto_server binary)',
    )
  }
  console.log(`[s3-test-server] provisioning ${VENV} (python3 -m venv + pip install 'moto[server]')...`)
  const venv = spawnSync('python3', ['-m', 'venv', VENV], { stdio: 'inherit' })
  if (venv.status !== 0) throw new Error(`python3 -m venv ${VENV} failed (code ${venv.status})`)
  const pip = spawnSync(path.join(VENV, 'bin', 'pip'), ['install', '-q', 'moto[server]'], {
    stdio: 'inherit',
  })
  if (pip.status !== 0) throw new Error(`pip install 'moto[server]' failed (code ${pip.status})`)
  return path.join(VENV, 'bin', 'moto_server')
}

async function startMoto(state) {
  const bin = resolveMotoBin() || provisionVenv()
  // Detached + stdio ignore + unref: the server must outlive this CLI process —
  // the Cypress tasks and the final teardown control it via the pid in the state
  // file.
  const child = spawn(bin, ['-H', '127.0.0.1', '-p', String(PORT)], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  try {
    await waitForEndpoint(60_000)
  } catch (err) {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
    throw err
  }
  return { ...state, mode: 'moto', endpoint: ENDPOINT, port: PORT, bucket: BUCKET, bin, pid: child.pid, down: false }
}

async function startTestcontainers(state) {
  // Drop a stale container from a crashed previous run (scoped to our name);
  // also frees the pinned host port.
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  const { LocalstackContainer } = await import('@testcontainers/localstack')
  const container = await new LocalstackContainer('localstack/localstack:latest')
    .withName(CONTAINER)
    // Pin the host port: after a down/up cycle the endpoint must not move — the
    // app server under test keeps the S3_ENDPOINT it booted with.
    .withExposedPorts({ container: 4566, host: PORT })
    .start()
  return {
    ...state,
    mode: 'testcontainers',
    endpoint: container.getConnectionUri(),
    port: PORT,
    bucket: BUCKET,
    container: CONTAINER,
    down: false,
  }
}

async function cmdStart() {
  await cmdStop({ quiet: true }) // clean slate: kills a stale server from a crashed run
  const mode = selectMode()
  console.log(`[s3-test-server] starting s3 test server (mode: ${mode}, port ${PORT})...`)
  const state = mode === 'moto' ? await startMoto({}) : await startTestcontainers({})
  writeState(state)
  console.log(`[s3-test-server] up at ${state.endpoint} (mode: ${mode})`)
  console.log(state.endpoint)
}

async function cmdStop({ quiet = false } = {}) {
  const state = readState()
  if (!state) {
    if (!quiet) console.log('[s3-test-server] nothing to stop (no state file)')
    return
  }
  if (state.mode === 'moto') {
    await killPid(state.pid)
  } else {
    spawnSync('docker', ['rm', '-f', state.container || CONTAINER], { stdio: 'ignore' })
  }
  removeState()
  if (!quiet) console.log(`[s3-test-server] stopped (mode: ${state.mode})`)
}

async function cmdDown() {
  const state = readState()
  if (!state) throw new Error(`no state file at ${STATE_FILE} — run 'start' first`)
  if (state.mode === 'moto') {
    await killPid(state.pid)
  } else {
    const res = spawnSync('docker', ['stop', state.container || CONTAINER], { stdio: 'inherit' })
    if (res.status !== 0) throw new Error(`docker stop failed (code ${res.status})`)
  }
  writeState({ ...state, down: true })
  console.log(`[s3-test-server] down (mode: ${state.mode}, endpoint ${state.endpoint} unreachable)`)
}

async function cmdUp() {
  const state = readState()
  if (!state) throw new Error(`no state file at ${STATE_FILE} — run 'start' first`)
  if (state.mode === 'moto') {
    // moto is in-memory: the restarted server is empty — callers re-create the
    // bucket and re-seed (same contract as the LocalStack leg).
    const fresh = await startMoto(state)
    writeState(fresh)
    console.log(`[s3-test-server] up at ${fresh.endpoint} (mode: moto, state was reset)`)
  } else {
    const res = spawnSync('docker', ['start', state.container || CONTAINER], { stdio: 'inherit' })
    if (res.status !== 0) throw new Error(`docker start failed (code ${res.status})`)
    await waitForEndpoint(90_000)
    writeState({ ...state, down: false })
    console.log(`[s3-test-server] up at ${state.endpoint} (mode: testcontainers, state was reset)`)
  }
}

const cmd = process.argv[2]
const commands = { start: cmdStart, stop: () => cmdStop(), down: cmdDown, up: cmdUp }
if (!cmd || !commands[cmd]) {
  console.error('Usage: node scripts/s3-test-server.mjs <start|stop|down|up>')
  process.exit(2)
}
try {
  await commands[cmd]()
} catch (err) {
  console.error(`[s3-test-server] ${cmd} failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
