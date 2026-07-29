import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

/**
 * Run every Playwright suite, in order, and report once.
 *
 * These drive a PRODUCTION BUILD through a real browser, so they need
 * `npm run build` and a `vite preview` on 4173 already running. That is
 * deliberate — the thing under test is the bundle a partner actually loads, not
 * a dev server with source maps and hot reload.
 *
 * The RTL suites (`npm test`) are the fast, per-flow half; these are the slow
 * whole-browser half. Neither replaces the other: RTL catches a component
 * fighting its own keyboard, this catches a bundle that will not boot.
 */
/**
 * `verify12b` needs a build with VITE_SUPPORT_EMAIL set, so it cannot run
 * against the same bundle as everything else. Skipped here and named, rather
 * than left to fail every run until people learn to ignore one red line —
 * which is how a suite stops being read at all.
 */
const NEEDS_OWN_BUILD = {
  'verify12b.mjs': 'VITE_SUPPORT_EMAIL=help@shotright.example npm run build',
}

const files = readdirSync(new URL('.', import.meta.url))
  .filter((f) => /^verify\d*[a-z]?\.mjs$/.test(f))
  .filter((f) => !NEEDS_OWN_BUILD[f])
  .sort((a, b) => {
    const n = (s) => Number(s.replace(/\D/g, '') || 0)
    return n(a) - n(b) || a.localeCompare(b)
  })

let failed = 0
for (const file of files) {
  const result = spawnSync('node', [new URL(file, import.meta.url).pathname], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    failed += 1
    console.log(`\n✗ ${file} FAILED\n`)
  }
}

for (const [file, how] of Object.entries(NEEDS_OWN_BUILD)) {
  console.log(`\nℹ ${file} not run — needs its own build:  ${how}`)
}

console.log(
  failed ? `\n${failed} of ${files.length} suites failed` : `\nAll ${files.length} suites passed`,
)
process.exit(failed ? 1 : 0)
