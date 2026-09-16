/**
 * What we are allowed to send the bench, and what we do about everything else.
 *
 * This file exists because of a specific hole. Every other suite in this repo
 * runs with `prepareImage` stubbed out (see `setup.js` — jsdom has no canvas),
 * so the one piece of logic that decides WHICH BYTES LEAVE THE BROWSER had no
 * test at all. That is the logic that dead-ended two partners:
 *
 *   - a small `.avif` was passed through untouched and met a terminal 417,
 *   - a `.heic` could not even be picked, because `accept` filtered it out of
 *     the file dialog before any of our code ran.
 *
 * So this suite imports the REAL module with `importActual` and stubs only the
 * two browser primitives jsdom lacks: image decoding and canvas encoding. The
 * branching under test is genuinely ours.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let prepareImage, ImageError, ACCEPT_ATTR, UPLOADABLE_TYPES

/* Object URLs, but resolvable back to the File so the fake decoder can decide
   whether this particular file is one a browser could have opened. */
const blobs = new Map()
let nextUrl = 0

/** Size of the blob `canvas.toBlob` hands back. Set per test. */
let encodedSize = 40_000

/** Files carrying this are ones the browser genuinely cannot decode. */
const UNDECODABLE = Symbol('undecodable')

const makeFile = (name, type, { bytes = 40_000, width = 1600, height = 1200, decodable = true } = {}) => {
  const file = new File([new Uint8Array(bytes)], name, { type })
  file.__w = width
  file.__h = height
  if (!decodable) file[UNDECODABLE] = true
  return file
}

beforeAll(async () => {
  const actual = await vi.importActual('../utils/image.js')
  ;({ prepareImage, ImageError, ACCEPT_ATTR, UPLOADABLE_TYPES } = actual)

  global.URL.createObjectURL = (file) => {
    const url = `blob:test/${nextUrl++}`
    blobs.set(url, file)
    return url
  }
  global.URL.revokeObjectURL = () => {}

  class FakeImage {
    set src(url) {
      const file = blobs.get(url)
      queueMicrotask(() => {
        if (!file || file[UNDECODABLE]) {
          this.onerror?.(new Event('error'))
          return
        }
        this.naturalWidth = file.__w
        this.naturalHeight = file.__h
        this.onload?.(new Event('load'))
      })
    }
  }
  global.Image = FakeImage

  HTMLCanvasElement.prototype.getContext = () => ({
    fillStyle: '',
    fillRect() {},
    drawImage() {},
  })
  HTMLCanvasElement.prototype.toBlob = (cb, type) => {
    cb(new Blob([new Uint8Array(encodedSize)], { type }))
  }
})

beforeEach(() => {
  encodedSize = 40_000
  blobs.clear()
})

describe('what reaches the bench', () => {
  /**
   * The AVIF trap, in one test.
   *
   * Small, already under the long-edge limit, and a type the picker offered —
   * every reason for `prepareImage` to leave it alone, and leaving it alone is
   * exactly what produced an unfixable 417 on a required field. It has to come
   * back as a JPEG.
   */
  it('re-encodes an AVIF the old code would have passed straight through', async () => {
    const avif = makeFile('stoep.avif', 'image/avif', { bytes: 30_000, width: 1200, height: 800 })

    const result = await prepareImage(avif)

    expect(result.file.type).toBe('image/jpeg')
    expect(result.file.name).toBe('stoep.jpg')
    expect(result.file).not.toBe(avif)
  })

  /**
   * The escape hatch that keeps the original when re-encoding made it bigger is
   * correct for a JPEG and wrong for an AVIF: a smaller file the server refuses
   * is not the better file. Same inputs as above, except the encode comes back
   * heavier than what went in.
   */
  it('takes the larger JPEG over a smaller AVIF', async () => {
    encodedSize = 90_000
    const avif = makeFile('braai.avif', 'image/avif', { bytes: 30_000, width: 1200, height: 800 })

    const result = await prepareImage(avif)

    expect(result.file.type).toBe('image/jpeg')
    expect(result.file.size).toBeGreaterThan(avif.size)
  })

  /* Safari decodes HEIC in an <img>, so on a Mac or an iPhone this path is
     reached and the photo simply works. It must arrive as a JPEG. */
  it('converts a HEIC the browser can decode', async () => {
    const heic = makeFile('table-six.heic', 'image/heic', { bytes: 900_000, width: 3000, height: 4000 })

    const result = await prepareImage(heic)

    expect(result.file.type).toBe('image/jpeg')
    expect(result.file.name).toBe('table-six.jpg')
    expect(Math.max(result.width, result.height)).toBe(2000)
  })

  /* The whole point of the split. Whatever went in, what comes out is a format
     the bench stores. */
  it.each([
    ['image/avif', 'terrace.avif'],
    ['image/heic', 'bar.heic'],
    ['image/heif', 'booth.heif'],
  ])('never returns %s to the uploader', async (type, name) => {
    const result = await prepareImage(makeFile(name, type, { bytes: 20_000, width: 900, height: 600 }))
    expect(UPLOADABLE_TYPES).toContain(result.file.type)
  })

  /* The counterweight: a good photo that needs nothing done to it must not be
     re-encoded, or every partner pays a quality loss for the AVIF fix. */
  it('leaves a small in-bounds JPEG exactly as it was', async () => {
    const jpg = makeFile('front-door.jpg', 'image/jpeg', { bytes: 30_000, width: 1400, height: 900 })

    const result = await prepareImage(jpg)

    expect(result.file).toBe(jpg)
    expect(result.resized).toBe(false)
  })
})

describe('the file dialog', () => {
  /**
   * `accept` filters before our code runs, so a format missing from here can
   * never reach a message we wrote. HEIC was missing from here, which is why an
   * iPhone owner on a Windows laptop saw their photos greyed out and were told
   * nothing at all.
   */
  it('offers HEIC so the partner can at least pick it', () => {
    expect(ACCEPT_ATTR).toContain('.heic')
    expect(ACCEPT_ATTR).toContain('image/heic')
  })
})

describe('when the browser cannot open it', () => {
  it('points at the phone, which needs no software and no re-shoot', async () => {
    const heic = makeFile('sunset.heic', 'image/heic', { decodable: false })

    const err = await prepareImage(heic).then(
      () => null,
      (e) => e,
    )

    expect(err).toBeInstanceOf(ImageError)
    expect(err.message).toMatch(/iPhone/)
    /* Not "go to Settings and take it again" as the first instruction: the
       partner is at a desk, not standing in the venue. */
    expect(err.message).toMatch(/open this page on the iPhone/)
    /* And it must not be an unretryable-looking failure that switches the photo
       requirement off — see `blocksUpload` in `vendor.js`. */
    expect(err.blocksUpload).toBeUndefined()
  })

  it('does not blame the iPhone for a file that is not one', async () => {
    const broken = makeFile('scan.png', 'image/png', { decodable: false })

    const err = await prepareImage(broken).then(
      () => null,
      (e) => e,
    )

    expect(err.message).toMatch(/couldn’t open scan\.png/)
    expect(err.message).not.toMatch(/iPhone/)
  })
})
