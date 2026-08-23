import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'

/**
 * Views are lazy-loaded now (route-level code splitting, 23 Aug), which puts
 * one more async hop — the chunk import resolving through Suspense — between
 * render and content. Testing Library's default 1s findBy* budget was sized
 * for a tree that mounts synchronously and only waits on the fake bench; give
 * it room for the import too. Passing tests are exactly as fast as before —
 * this only moves the point where a genuinely missing element gives up.
 */
configure({ asyncUtilTimeout: 4000 })
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
   thing is covered by the Playwright suites, which run in a browser that can
   actually decode a JPEG; here it would only ever assert that our stub returns
   what our stub returns. */
vi.mock('../utils/image.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    prepareImage: vi.fn(async (file) => ({ file, resized: false, width: 1200, height: 900 })),
  }
})

if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
}
