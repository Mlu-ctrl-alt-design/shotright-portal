import api, { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * Menu import — upload, then track.
 *
 * TWO BACKENDS, and the difference is not cosmetic:
 *
 *   ASYNC (backend/menu_import.py deployed)
 *     The parse is a queued job. The partner can close the tab, come back, and
 *     still be told what happened. Progress is real row counts.
 *
 *   SYNCHRONOUS (today)
 *     The parse runs inside the HTTP request. Leaving the page loses the
 *     result — and possibly the import. There is no progress to report,
 *     because the server sends nothing until it is finished.
 *
 * `supportsBackgroundImport()` tells the UI which world it is in, and the UI
 * changes WHAT IT PROMISES accordingly. "You can leave this page" is only shown
 * in the first case. Showing it in the second would be the exact failure this
 * whole feature is meant to remove: a confident message that is not true.
 */

const STORAGE_KEY = 'shotright.menuImport'

/**
 * Upload the file. Separate from starting the parse on purpose.
 *
 * The upload has real byte progress the browser can report; the parse does not.
 * Conflating them gives a progress bar that races to 100% and then sits there,
 * which reads as a hang.
 */
export async function uploadMenuFile(file, onProgress) {
  const form = new FormData()
  form.append('file', file)
  form.append('is_private', '1')

  try {
    const { data } = await api.post('/api/method/upload_file', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (!event.total) return
        onProgress?.(Math.round((event.loaded / event.total) * 100))
      },
    })
    return data.message
  } catch (err) {
    /**
     * ⚠️ TAGGED, because the difference decides what a partner is told.
     *
     * Reported 8 Aug as "the menu upload is not working". It goes through
     * `/api/method/upload_file` — the SAME endpoint that was 403ing on venue
     * photos, so those were one report rather than two. What the partner saw
     * was **"We couldn't read that file"**, which is a sentence about their
     * spreadsheet. Their spreadsheet was never uploaded and there is nothing
     * wrong with it, so they try a different file, and a CSV instead of an
     * Excel, and a shorter one, and every attempt fails identically.
     *
     * Blaming a partner's work for our permission problem is the worst version
     * of the failure this project keeps having, because it sends them off to
     * fix something that was never broken.
     */
    err.stage = 'upload'
    throw err
  }
}

/**
 * Start an import. Returns `{ job, async }`.
 *
 * `async: false` means the returned job is already finished — the synchronous
 * endpoint blocked until it was. The caller must not then offer to "check back
 * later" on something that has already happened.
 */
/**
 * How the bench is told WHICH uploaded file to read.
 *
 * ⚠️ Both halves of this are guesses, and both have already bitten.
 *
 * The docname: core `upload_file` returns it as `name`, while
 * `upload_venue_photo` returns it as `file` — reading only `name` is what made
 * every venue photo save 417 in #23. The same two shapes are read here.
 *
 * The parameter: `file_name` is what this code has always sent, carrying a
 * DOCNAME, which is not what that name suggests. If the method wants the URL,
 * or calls the argument something else, Frappe raises TypeError rather than
 * ignoring it — so the shapes are tried in turn and a wrong-keyword error moves
 * on instead of surfacing as "we couldn't read your file".
 */
const fileRefsFor = (uploaded) => {
  const docname = uploaded?.name || uploaded?.file
  const url = uploaded?.file_url
  return [
    docname && { file_name: docname },
    url && { file_url: url },
    docname && { file: docname },
    url && { file_name: url },
  ].filter(Boolean)
}

const isWrongParameter = (err) =>
  /unexpected keyword argument|got an unexpected|missing \d+ required (positional|keyword)/i.test(
    `${err?.message || ''} ${err?.detail || ''} ${err?.excType || ''}`,
  )

/**
 * Call the importer, trying each way of naming the file until one is accepted.
 *
 * Every error out of here is tagged `stage: 'import'`. That matters more than
 * it looks: untagged, the caller classified it as a PARSE failure and told the
 * partner "we couldn't read that file" — a sentence about their spreadsheet,
 * over a problem in our request. `uploadMenuFile` above has a long comment
 * about why that is the worst version of this bug. It was fixed one step
 * earlier and left in place here.
 */
const callImporter = async (method, venueId, uploaded) => {
  const refs = fileRefsFor(uploaded)
  if (!refs.length) {
    /* The upload came back with nothing to point at. That is our problem, not a
       bad spreadsheet, and it must not be reported as one. */
    const err = new Error('The file uploaded, but the server didn’t say where it put it.')
    err.stage = 'upload'
    throw err
  }

  let last = null
  for (const ref of refs) {
    try {
      return await call(method, { venue_name: venueId, ...ref })
    } catch (err) {
      last = err
      if (isWrongParameter(err)) continue
      err.stage = 'import'
      throw err
    }
  }
  console.warn(
    `[shotright] ${method} rejected every way we know of naming an uploaded file ` +
      `(${refs.map((r) => Object.keys(r)[0]).join(', ')}). This is a backend contract gap.`,
  )
  if (last) last.stage = 'import'
  throw last
}

export async function startMenuImport(venueId, file, onUploadProgress) {
  if (USE_MOCKS) return startMock(venueId, file, onUploadProgress)

  const uploaded = await uploadMenuFile(file, onUploadProgress)

  return withFallback(
    'start_menu_import',
    async () => {
      const job = await callImporter('shotright.api.start_menu_import', venueId, uploaded)
      remember(venueId, job.name)
      return { job, async: true }
    },
    async () => {
      // No background endpoint. Block, and hand back a finished job so the
      // caller renders the same result UI either way.
      const result = await callImporter(
        'shotright.api.import_products_from_excel',
        venueId,
        uploaded,
      )
      return {
        job: {
          name: null,
          status: 'Completed',
          processed: result?.created ?? 0,
          total: result?.created ?? 0,
          created_count: result?.created ?? 0,
          skipped_count: 0,
          errors: [],
        },
        async: false,
      }
    },
  )
}

export const getMenuImportStatus = (name) =>
  USE_MOCKS ? pollMock(name) : callGet('shotright.api.get_menu_import_status', { name })

export const cancelMenuImport = (name) =>
  USE_MOCKS
    ? Promise.resolve({ status: 'Cancelled' })
    : call('shotright.api.cancel_menu_import', { name })

/* ------------------------------------------------------------- persistence */

/**
 * Remember the running job per venue, so returning to the page picks the
 * progress back up.
 *
 * This is the mechanism behind "you don't have to wait". Without it the promise
 * is only half kept: the work survives, but the partner comes back to a page
 * that has forgotten it and has no way to ask.
 *
 * localStorage rather than sessionStorage — deliberately. "Leave the page"
 * includes closing the tab, and sessionStorage dies with it.
 */
const readAll = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

const writeAll = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Private-mode Safari throws. Progress then does not survive a reload,
    // which is a degraded experience rather than a broken one.
  }
}

function remember(venueId, name) {
  writeAll({ ...readAll(), [venueId]: { name, startedAt: Date.now() } })
}

export const rememberedImport = (venueId) => readAll()[venueId] || null

export function forgetImport(venueId) {
  const all = readAll()
  delete all[venueId]
  writeAll(all)
}

/* ------------------------------------------------------------------- mocks */

const mockJobs = new Map()
let mockSeq = 0

async function startMock(venueId, file, onUploadProgress) {
  for (const percent of [20, 55, 90, 100]) {
    onUploadProgress?.(percent)
    await new Promise((r) => setTimeout(r, 120))
  }
  const name = `MI-${++mockSeq}`
  // Files with "slow" in the name run long, so the slow branch and the manual
  // escape hatch can be worked on without waiting 45 seconds each time.
  const total = /slow/i.test(file.name) ? 400 : 24
  mockJobs.set(name, { name, status: 'Reading', processed: 0, total, created_count: 0, skipped_count: 0, errors: [], startedAt: Date.now() })
  remember(venueId, name)
  return { job: { ...mockJobs.get(name), estimate_seconds: 20, slow_after_seconds: 45 }, async: true }
}

async function pollMock(name) {
  const job = mockJobs.get(name)
  if (!job) throw new Error('That import no longer exists.')
  if (job.status === 'Reading') {
    job.processed = Math.min(job.total, job.processed + Math.ceil(job.total / 12))
    job.created_count = Math.max(0, job.processed - 2)
    job.skipped_count = Math.min(2, job.processed)
    if (job.processed >= job.total) job.status = 'Completed'
  }
  return { ...job, estimate_seconds: 20, slow_after_seconds: 45 }
}
