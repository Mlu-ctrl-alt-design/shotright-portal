import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './server'
import { resetBench } from './bench'

/**
 * `onUnhandledRequest: 'error'` is the important line in this file.
 *
 * A test that quietly lets a request through learns nothing — it asserts
 * against whatever the component does when a call hangs, which is usually a
 * spinner, and a spinner passes any assertion that only checks "no crash". Every
 * call the app makes has to be one the fake bench knows about, so adding a new
 * endpoint to the app forces a decision here about what it returns.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(async () => {
  cleanup()
  server.resetHandlers()
  resetBench()

  /**
   * `withFallback` caches "this method is not deployed" in a module-level Map
   * that lives for the whole file. Without this, the first test to see a 404
   * poisons every later one — a test that sets `bench.deploy.x = true` still
   * gets the fallback, and the failure looks like a bug in the app.
   *
   * Found by exactly that: the bookings tab reported "we can't see bookings"
   * in a test that had explicitly deployed the endpoint.
   */
  const vendor = await import('../services/vendor')
  vendor.__resetCapabilities?.()
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
})

afterAll(() => server.close())

/* --------------------------------------------------------------- jsdom gaps */

/* Leaflet, the photo uploader and the mood chips all reach for APIs jsdom does
   not implement. These are stubs, not behaviour: anything a test actually
   asserts on is stubbed in the test itself, where it can be seen. */

window.scrollTo = vi.fn()
Element.prototype.scrollIntoView = vi.fn()

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!global.matchMedia) {
  global.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}

/* jsdom has no canvas, and `prepareImage` downscales through one. The real
   thing is covered by `image.test.js` (which stubs the two browser primitives
   and exercises the actual branching) and by the Playwright suites, which run
   in a browser that can genuinely decode a JPEG.

   ⚠️ The stub still honours ONE part of the contract: nothing leaves here in a
   format the bench refuses. A passthrough stub would have modelled a world in
   which a `.avif` reaches `upload_venue_photo` — which is the same shape of
   mistake as the mock that returned the File docname as `name` and let 173
   green checks certify a save that 417'd on the live bench. A double is
   allowed to be simpler than the real thing; it is not allowed to disagree
   with it. */
vi.mock('../utils/image.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    prepareImage: vi.fn(async (file) => {
      const convert = !actual.UPLOADABLE_TYPES.includes(file.type)
      const out = convert
        ? new File([file], `${file.name.replace(/\.[^./\\]+$/, '')}.jpg`, { type: 'image/jpeg' })
        : file
      return { file: out, resized: convert, width: 1200, height: 900, originalSize: file.size }
    }),
  }
})

if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
}
