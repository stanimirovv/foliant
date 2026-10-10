import { defineConfig } from 'cypress'
import fs from 'fs'
import os from 'os'
import path from 'path'

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // The editor e2e spec creates its own brand-new diagrams in a fresh
      // temp directory (EDITING_PLAN.md Step 14) — it never touches the
      // committed demo fixtures.
      on('task', {
        createTempDiagramDir() {
          return fs.mkdtempSync(path.join(os.tmpdir(), 'cypress-diagrams-'))
        },
      })
    },
    baseUrl: 'http://localhost:3000',
    supportFile: false,
  },
})
