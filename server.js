const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const path = require('path')

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

const dirArg = process.argv[2]
if (dirArg) {
  process.env.DIAGRAMS_DIR = path.resolve(dirArg)
}

// Fail fast at boot on storage misconfiguration (mirrors the checks in
// src/lib/storage/index.ts, which guards per-request): an unknown backend or a
// missing S3_BUCKET is a boot error, not a per-request 503.
const STORAGE_BACKENDS = ['fs', 'memory', 's3']
const storageBackend = (process.env.STORAGE_BACKEND || 'fs').trim().toLowerCase()
if (!STORAGE_BACKENDS.includes(storageBackend)) {
  console.error(
    `Unknown STORAGE_BACKEND "${process.env.STORAGE_BACKEND}" — expected one of: ${STORAGE_BACKENDS.join(', ')}`
  )
  process.exit(1)
}
if (storageBackend === 's3' && !process.env.S3_BUCKET) {
  console.error('S3_BUCKET is required when STORAGE_BACKEND=s3')
  process.exit(1)
}

const port = Number(process.env.PORT || 3000)

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  }).listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://localhost:${port}`)
  })
})
