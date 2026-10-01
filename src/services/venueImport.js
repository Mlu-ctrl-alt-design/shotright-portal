import api, { call, callGet } from './api'

/**
 * Bulk venue upload — the bench's importer, and nothing else.
 *
 * ⚠️ THIS USED TO BE A SECOND IMPORTER, IN THE BROWSER. Until 1 Oct the portal
 * parsed the spreadsheet itself and called `save_venue_draft` once per row,
 * falling back to localStorage — with its own column names (weekday_open,
 * `atmosphere`, semicolon-separated moods) that the bench's importer has never
 * read. That path had no server-side Pro check, no dedupe on a re-upload (the
 * same file twice was every venue twice), and no row cap.
 *
 * The bench has had a real one since shotright #64 (`venue_import.py`): the
 * file is uploaded, a background job reads it, venues land in Draft, and a
 * re-upload updates on (vendor, external_ref) instead of duplicating. So the
 * portal now only does four things: fetch the column contract, upload the
 * file, start the job, and watch it.
 */

export const TEMPLATE_METHOD = 'shotright.api.get_venue_import_template'
const START_METHOD = 'shotright.api.start_venue_import'
const STATUS_METHOD = 'shotright.api.get_venue_import_status'
const CANCEL_METHOD = 'shotright.api.cancel_venue_import'

/**
 * How often the screen asks how the job is going. Mutable so the tests can
 * run it fast on real timers — fake timers plus MSW hang (see render.jsx).
 */
export const venueImportPolling = { intervalMs: 2000 }

/** What the importer reads. `.xls` is not one — openpyxl cannot open it. */
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv']

export const FINISHED_STATUSES = ['Completed', 'Failed', 'Cancelled']
export const isFinished = (job) => FINISHED_STATUSES.includes(job?.status)

/**
 * The sheet-and-column contract, straight from the bench.
 *
 * `{max_venues, join_column, join_note, sheets: [{name, required,
 * required_columns, optional_columns, notes}]}` — a description, not a file.
 * Guest-readable, and derived from the parser's own constants, so it cannot
 * describe a column the importer would then ignore.
 */
export const getVenueImportTemplate = () => callGet(TEMPLATE_METHOD)

/**
 * Columns a partner can use. `vendor` is dropped: it is honoured only for a
 * System Manager and is noise — or worse, a row refused — for anyone else.
 */
export const partnerColumns = (sheet) =>
  [...(sheet?.required_columns || []), ...(sheet?.optional_columns || [])].filter(
    (column) => column !== 'vendor',
  )

/**
 * The `venues` sheet as a CSV header row, built from the bench's contract.
 *
 * Header only, no example row: the importer would read an example as a venue,
 * and a partner who forgot to delete it would get a Draft called "Example".
 * A `.csv` carries the venues sheet alone; hours and menus need a workbook,
 * which the screen spells out from the same contract.
 */
export const templateCsv = (template) => {
  const venues = template?.sheets?.find((s) => s.name === 'venues')
  return `${partnerColumns(venues).join(',')}\n`
}

/**
 * Upload the workbook as a private File the importer can read by docname.
 *
 * Core `upload_file` with NO doctype/docname — the shape the menu importer has
 * used since August. That shape is open to a vendor (role `All` may create a
 * File; core only runs `check_write_permission` when a document is named —
 * measured on the bench 22 Aug, see BACKEND-ASKS §19.b), and it stamps the
 * File's `owner` as the caller, which is exactly what `Venue Import` checks
 * before it will read it. Naming `doctype=Venue` here would be the permanent
 * 403 that `upload_venue_photo` exists to avoid — and there is no venue yet.
 *
 * Private, because a partner's catalogue (phone numbers, unreleased venues) is
 * not something to publish under /files.
 *
 * Errors are tagged `stage: 'upload'`: a refusal here is about our request, not
 * the partner's spreadsheet, and must not be reported as one.
 */
export async function uploadVenueFile(file, onProgress) {
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
    /* Core answers the docname as `name`; the app's own uploaders as `file`.
       Read both — reading only one is what 417'd every photo save in #23. */
    const docname = data?.message?.name || data?.message?.file
    if (!docname) {
      const err = new Error('The file uploaded, but the server didn’t say where it put it.')
      err.stage = 'upload'
      throw err
    }
    return docname
  } catch (err) {
    err.stage = err.stage || 'upload'
    throw err
  }
}

/**
 * Queue the import. Returns the same shape as the status call.
 *
 * `submit_for_review` is sent as an explicit 0 and never offered. A workbook
 * cannot carry photographs, so every venue it creates fails the completeness
 * gate on `no_photos` by construction — opting in would turn each fresh Draft
 * into a Declined listing for a reason the partner had no way to avoid. Photos
 * first, then submit, venue by venue, through the flow that already asks.
 */
export const startVenueImport = (fileName) =>
  call(START_METHOD, { file_name: fileName, submit_for_review: 0 })

export const getVenueImportStatus = (name) => callGet(STATUS_METHOD, { name })

export const cancelVenueImport = (name) => call(CANCEL_METHOD, { name })

/**
 * A worker failure is stored as the tail of a Python traceback. Show its last
 * line, without the exception's module path — the sentence, not the stack.
 */
export const plainImportError = (error) => {
  const lines = String(error || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.at(-1) || ''
  return last.replace(/^(?:[\w.]+\.)?\w*(?:Error|Exception):\s*/, '')
}

/** Completeness blocker codes (venue_completeness.py), in a partner's words. */
const BLOCKERS = {
  no_photos: 'Needs photos',
  few_photos: 'Needs more photos',
  no_description: 'Needs a description',
  no_address: 'Needs a street address',
  no_coordinates: 'Needs a map location',
  no_menu: 'Needs a menu',
}

export const blockerLabel = (code) =>
  BLOCKERS[code] || String(code || '').replace(/_/g, ' ')
