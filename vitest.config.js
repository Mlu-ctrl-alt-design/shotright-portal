import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Separate from `vite.config.js` on purpose.
 *
 * The app config carries a dev proxy to a live Frappe bench. A test run must
 * never be one misconfiguration away from talking to production, so the test
 * environment gets its own config with no proxy in it at all. MSW intercepts
 * every request; anything it doesn't recognise throws rather than escaping.
 *
 * Tailwind is left out too — these tests assert behaviour and text, never
 * pixels, and compiling the stylesheet for each run costs seconds per file to
 * verify nothing.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // `.js` as well as `.jsx`: the pure-logic units (image preparation, the
    // format contract with the bench) have no components in them and should not
    // have to pretend otherwise to be run.
    include: ['src/**/*.test.{js,jsx}'],
    testTimeout: 15000,
    // The suites share one MSW server and one localStorage. Running files in
    // parallel threads is fine (each gets its own module registry), but within
    // a file order matters, so no concurrent tests.
    sequence: { concurrent: false },
  },
})
