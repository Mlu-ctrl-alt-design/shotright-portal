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

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetBench()
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
