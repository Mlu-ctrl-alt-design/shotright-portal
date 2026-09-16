/**
 * Getting a phone photo of a restaurant onto a server, without lecturing the
 * person holding the phone.
 *
 * The partner taking these pictures is standing in their own bar with the
 * lights they normally use, on whatever handset they own. A 12-megapixel photo
 * off a current phone lands at 3–6 MB, and the naive version of this feature —
 * `accept="image/*"` plus a 5 MB limit — rejects a large share of real photos
 * with a message the partner can do nothing useful about. Telling someone to go
 * and find image-resizing software is not a requirement anybody agreed to.
 *
 * So the browser does the work: decode, downscale to a long edge the customer
 * app can actually use, re-encode, upload. A 5 MB photo becomes roughly 300 KB,
 * the upload finishes in a second on a bad connection, and nobody is asked to
 * do anything.
 *
 * WHY AN <img> AND NOT createImageBitmap: phone cameras write the orientation
 * into EXIF rather than rotating the pixels. Browsers apply that automatically
 * when an <img> is drawn to a canvas, and do NOT when an ImageBitmap is decoded
 * without `imageOrientation: 'from-image'` — which older Safari ignores anyway.
 * Every portrait photo taken on a phone would arrive on its side. The <img>
 * path is both simpler and the one that is right everywhere.
 */

/**
 * What the BENCH will store. Measured 22 Aug on shotright.thedaystar.co.za:
 * `.heic`, `.heif` and `.avif` come back 417 "Unsupported image format", and
 * a 417 is terminal — there is no retry that turns it into a 200.
 *
 * This list is therefore not a taste judgement, it is the server's contract.
 * Anything outside it is re-encoded to JPEG before it is ever sent.
 */
export const UPLOADABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * What the partner is allowed to PICK. Deliberately wider than the list above.
 *
 * These two used to be one constant, and that single fact caused both of the
 * ways this step could dead-end:
 *
 *   - `.avif` was on the list, so a small AVIF sailed through `prepareImage`
 *     untouched and was uploaded as-is — straight into the terminal 417. The
 *     partner picked a file we said we accepted and then could not save.
 *   - `.heic` was NOT on the list, so the file dialog greyed out an iPhone
 *     owner's photos. They got no message, because the `accept` attribute
 *     filters before any of our code runs. The careful HEIC copy in `decode`
 *     below was unreachable in practice.
 *
 * Now: pick anything a browser can plausibly open, and let `prepareImage`
 * convert it. The only files that reach the server are JPEG, PNG and WebP.
 */
export const ACCEPTED_TYPES = UPLOADABLE_TYPES.concat([
  'image/avif',
  'image/heic',
  'image/heif',
])

/** Both MIME types and extensions — some pickers report an empty `type`. */
export const ACCEPT_ATTR = ACCEPTED_TYPES.concat([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
]).join(',')

/** Long edge after downscaling. Generous for a full-bleed listing header. */
export const MAX_EDGE = 2000

/** Below this, and already a good type, the original goes up untouched. */
export const TARGET_BYTES = 1_200_000

/**
 * Refused before we even try to decode it. Not a quality bar — a guard against
 * a 200 MB RAW or a mis-picked video eating the tab's memory.
 */
export const HARD_MAX_BYTES = 25 * 1024 * 1024

export class ImageError extends Error {}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1)

export const formatBytes = (bytes) =>
  bytes >= 1024 * 1024 ? `${mb(bytes)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

const looksLikeHeic = (file) =>
  /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '')

/**
 * Decode into an <img>, or fail with something the partner can act on.
 *
 * The failure that matters here is HEIC. An iPhone shooting in "High
 * Efficiency" writes .heic, Safari transcodes it to JPEG on the way through a
 * file input, and Chrome and Firefox do not — so the same photo works on the
 * partner's iPhone and fails on the laptop in their office. "Unsupported file
 * type" is true and useless. The setting that fixes it is two taps away, so we
 * say which one.
 */
function decode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(
        new ImageError(
          looksLikeHeic(file)
            ? `${file.name} is an iPhone HEIC photo, and this browser can’t open it. ` +
              `The quickest fix is to add it from your phone instead — open this page on ` +
              `the iPhone and pick the photo there, and it converts on the way. Otherwise ` +
              `email or WhatsApp the photo to yourself and add the copy that arrives, or on ` +
              `a Mac open it in Preview and choose File → Export as JPEG.`
            : `We couldn’t open ${file.name}. It may be damaged, or not really a photo. ` +
              `JPG, PNG and WebP all work.`,
        ),
      )
    }
    img.src = url
  })
}

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageError('Encoding failed.'))), type, quality),
  )

const renameTo = (name, ext) => `${(name || 'photo').replace(/\.[^./\\]+$/, '')}.${ext}`

/**
 * Validate, decode, downscale. Returns the file to actually upload.
 *
 * Throws `ImageError` with copy meant for a partner, not a console. Anything
 * else thrown from here is a genuine bug and should surface as one.
 */
export async function prepareImage(file) {
  if (!file) throw new ImageError('No file was chosen.')

  if (file.type && !file.type.startsWith('image/') && !looksLikeHeic(file)) {
    throw new ImageError(`${file.name} isn’t a photo. Add JPG, PNG or WebP images.`)
  }

  if (file.size > HARD_MAX_BYTES) {
    throw new ImageError(
      `${file.name} is ${mb(file.size)} MB, which is larger than we can handle. ` +
        `A normal photo off a phone is well under that — this may be a video or a RAW file.`,
    )
  }

  const img = await decode(file)
  const { naturalWidth: w0, naturalHeight: h0 } = img

  if (!w0 || !h0) throw new ImageError(`${file.name} has no picture in it.`)

  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0))
  /* `UPLOADABLE_TYPES`, not `ACCEPTED_TYPES`. An AVIF or a HEIC the browser
     managed to decode is still a file the bench refuses at 417, so it always
     gets re-encoded — even when it is small enough and small enough on the
     long edge that nothing else here would have touched it. */
  const needsWork = scale < 1 || file.size > TARGET_BYTES || !UPLOADABLE_TYPES.includes(file.type)

  if (!needsWork) {
    return { file, width: w0, height: h0, resized: false, originalSize: file.size }
  }

  const width = Math.max(1, Math.round(w0 * scale))
  const height = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // Flatten onto white: a PNG with transparency re-encoded to JPEG otherwise
  // gets black wherever it was see-through, which looks like a corrupted upload.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const blob = await toBlob(canvas, 'image/jpeg', 0.82)

  // Re-encoding a small, already-efficient photo can make it BIGGER. Keep
  // whichever is smaller — but only when the original is a type the bench will
  // actually store. A smaller AVIF that comes back 417 is not the better file.
  if (blob.size >= file.size && UPLOADABLE_TYPES.includes(file.type) && scale === 1) {
    return { file, width: w0, height: h0, resized: false, originalSize: file.size }
  }

  return {
    file: new File([blob], renameTo(file.name, 'jpg'), { type: 'image/jpeg' }),
    width,
    height,
    resized: true,
    originalSize: file.size,
  }
}
