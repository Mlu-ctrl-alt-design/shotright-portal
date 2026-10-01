/**
 * Many venues from one spreadsheet — through the bench's importer.
 *
 * Since 1 Oct the portal does not read the file at all. It uploads it, hands
 * the File docname to `start_venue_import`, and watches the job. So these tests
 * assert on what reached the bench: the upload's shape, the kwargs the import
 * was started with, the venues the job wrote, and the calls a Cancel made.
 *
 * The fake bench does not parse spreadsheets (`bench.venueImportOutcome` says
 * what the worker "found"): the parser is the backend's, and is tested there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { venueImportPolling } from '../services/venueImport'

const ROUTE = '/venues/import'

const csv = () =>
  new File(['venue_name,latitude,longitude\nCorner Kitchen,-33.92,18.42'], 'venues.csv', {
    type: 'text/csv',
  })

const xlsx = () =>
  new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'venues.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

const pick = async (user, file) => {
  await user.upload(await screen.findByLabelText(/venue spreadsheet/i), file)
}

const importFile = async (user, file = csv()) => {
  await pick(user, file)
  await user.click(await screen.findByRole('button', { name: /import venues/i }))
}

const callsTo = (method) => bench.calls.filter((c) => c.method === method)

const saved = { ...venueImportPolling }
beforeEach(() => {
  venueImportPolling.intervalMs = 20
})
afterEach(() => Object.assign(venueImportPolling, saved))

describe('the template', () => {
  let blobs
  beforeEach(() => {
    blobs = []
    URL.createObjectURL = vi.fn((blob) => {
      blobs.push(blob)
      return 'blob:template'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  /* The portal used to ship its own columns (weekday_open, `atmosphere`,
     semicolon moods) that the bench's importer has never read. The header now
     comes from the importer's own contract, so it cannot drift. */
  it('downloads the columns the bench’s importer actually reads', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    const button = await screen.findByRole('button', { name: /download the template/i })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(callsTo('get_venue_import_template')).toHaveLength(1)
    const header = (await blobs[0].text()).trim().split(',')
    expect(header.slice(0, 3)).toEqual(['venue_name', 'latitude', 'longitude'])
    expect(header).toEqual(expect.arrayContaining(['external_ref', 'moods', 'atmosphere_desc']))
    /* Admin-only; a partner's row naming a vendor is refused. */
    expect(header).not.toContain('vendor')
    expect(header).not.toContain('weekday_open')
  })

  it('spells out the hours and menu sheets a workbook can carry', async () => {
    renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByText(/venue_ref, day_of_week, open_time, close_time/)).toBeInTheDocument()
    expect(screen.getByText(/venue_ref, heading_name, item_name, price, description/)).toBeInTheDocument()
    expect(screen.getByText(/up to 500 venues a file/i)).toBeInTheDocument()
  })
})

describe('uploading and starting', () => {
  it('sends nothing until the partner presses Import', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await pick(user, xlsx())

    expect(await screen.findByText(/is ready/i)).toBeInTheDocument()
    expect(callsTo('upload_file')).toHaveLength(0)
    expect(bench.venueImports).toHaveLength(0)
  })

  /**
   * The upload mechanism, asserted. A private File attached to nothing — the
   * shape core `upload_file` lets a vendor make — owned by the caller, whose
   * docname is what `start_venue_import` must be handed as `file_name`.
   */
  it('uploads a private, unattached file and starts the import with its docname', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user, xlsx())

    await waitFor(() => expect(bench.venueImports).toHaveLength(1))
    expect(callsTo('upload_file')[0].args).toMatchObject({ doctype: null, docname: null })
    const file = bench.files.at(-1)
    expect(file.is_private).toBe(1)
    expect(callsTo('start_venue_import')[0].args).toEqual({
      file_name: file.name,
      /* Never offered: every imported venue would be declined on no_photos. */
      submit_for_review: 0,
    })
    expect(bench.venueImports[0].file).toBe(file.name)
  })

  it('refuses the older .xls format without uploading it', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await pick(user, new File(['old binary'], 'venues.xls', { type: 'application/vnd.ms-excel' }))

    expect(await screen.findByText(/older \.xls format/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import venues/i })).not.toBeInTheDocument()
    expect(callsTo('upload_file')).toHaveLength(0)
  })

  /* A refused upload is our request failing, not their spreadsheet. */
  it('does not blame the spreadsheet when the upload itself is refused', async () => {
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/your file didn’t reach us/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing wrong with your spreadsheet/i)).toBeInTheDocument()
    expect(callsTo('start_venue_import')).toHaveLength(0)
  })

  it('says so when the hourly import limit is reached', async () => {
    bench.venueImportRateLimited = true
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/a lot of imports in one hour/i)).toBeInTheDocument()
    expect(bench.venueImports).toHaveLength(0)
  })
})

describe('watching the job', () => {
  it('shows the stage and the count while it runs', async () => {
    bench.venueImportPollsToFinish = Infinity
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/adding your venues — 1 of 2/i)).toBeInTheDocument()
    expect(screen.getByText(/you can leave this page/i)).toBeInTheDocument()
  })

  /**
   * The venues the job wrote are on the bench as Drafts, and every row in the
   * result goes somewhere a photo can be added — the one thing standing
   * between an imported venue and review.
   */
  it('lands every venue as a draft and sends each one to its photos', async () => {
    const before = bench.venues.length
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/2 added/i)).toBeInTheDocument()
    expect(bench.venues).toHaveLength(before + 2)
    expect(bench.venues.slice(-2).map((v) => v.workflow_state)).toEqual(['Draft', 'Draft'])

    const list = screen.getByRole('list', { name: /imported venues/i })
    expect(within(list).getAllByText('Draft')).toHaveLength(2)
    expect(screen.getByText(/each one needs photos before it can go for review/i)).toBeInTheDocument()

    const corner = bench.venues.find((v) => v.venue_name === 'Corner Kitchen')
    expect(
      screen.getByRole('link', { name: /add photos to corner kitchen/i }).getAttribute('href'),
    ).toBe(`/venues/${corner.name}/edit`)
  })

  it('stops asking once the job has finished', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)
    await screen.findByText(/2 added/i)
    const polls = callsTo('get_venue_import_status').length

    await new Promise((r) => setTimeout(r, 150))
    expect(callsTo('get_venue_import_status')).toHaveLength(polls)
  })

  /* The job's name is in the URL, so leaving and coming back finds it. */
  it('picks the import back up after the page is reloaded', async () => {
    bench.venueImportPollsToFinish = Infinity
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    await importFile(user)
    await screen.findByText(/adding your venues/i)
    const name = bench.venueImports[0].name

    cleanup()
    bench.venueImportPollsToFinish = 0
    renderApp({ route: `${ROUTE}?import=${name}`, signedIn: true })

    expect(await screen.findByText(/2 added/i)).toBeInTheDocument()
    expect(bench.venueImports).toHaveLength(1)
  })

  it('cancels a running import on the bench', async () => {
    bench.venueImportPollsToFinish = Infinity
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)
    await user.click(await screen.findByRole('button', { name: /cancel import/i }))

    expect(await screen.findByText(/import stopped/i)).toBeInTheDocument()
    expect(callsTo('cancel_venue_import')[0].args).toEqual({ name: bench.venueImports[0].name })
    expect(bench.venueImports[0].status).toBe('Cancelled')
  })

  /* Re-uploading the same file is the documented way to fix a row. */
  it('updates the venues on a second upload instead of adding them twice', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)
    await screen.findByText(/2 added/i)
    const after = bench.venues.length

    await user.click(screen.getByRole('button', { name: /upload another file/i }))
    await importFile(user)

    expect(await screen.findByText(/2 updated/i)).toBeInTheDocument()
    expect(bench.venues).toHaveLength(after)
  })

  it('shows the rows the bench skipped, as it worded them', async () => {
    bench.venueImportOutcome.errors = [
      "venues row 4: 'The Yard' — unknown mood 'Raucous', dropped.",
    ]
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/rows we skipped or changed/i)).toBeInTheDocument()
    expect(screen.getByText(/unknown mood 'Raucous'/)).toBeInTheDocument()
  })

  /* A failed job stores a traceback tail. The partner gets its last sentence. */
  it('explains a failed import in a sentence, not a traceback', async () => {
    bench.venueImportOutcome.fail =
      'Traceback (most recent call last):\n  File "apps/shotright/venue_import.py", line 360, in _scan\n' +
      'frappe.exceptions.ValidationError: The venues sheet is missing required column(s): latitude\n'
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/nothing was added/i)).toBeInTheDocument()
    expect(screen.getByText('The venues sheet is missing required column(s): latitude')).toBeInTheDocument()
    expect(screen.queryByText(/traceback/i)).not.toBeInTheDocument()
  })

  /* `_own_job`: somebody else's import is the same 404 as no import. */
  it('says plainly when the import in the link is not this partner’s', async () => {
    renderApp({ route: `${ROUTE}?import=VI-99999`, signedIn: true })

    expect(await screen.findByText(/we can’t find that import/i)).toBeInTheDocument()
  })
})

/* ============================================================================
   BULK IMPORT IS PRO — as of 17 Sep

   Gated in the portal (the lock, decoration) AND on the bench
   (`require_feature_for_caller` → FeatureLockedError, the wall). The tests
   that matter are the ones about NOT locking, and about the wall being met
   gracefully when the portal's answer was out of date.
   ========================================================================= */
describe('the Pro gate', () => {
  const asFree = () => {
    bench.deploy.get_entitlements = true
    bench.entitlements = { plan: 'free', features: [] }
  }

  it('does not lock anybody when the bench cannot say', async () => {
    bench.deploy.get_entitlements = false
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await pick(user, csv())

    expect(await screen.findByText(/is ready/i)).toBeInTheDocument()
    expect(screen.queryByText(/this one’s on pro/i)).not.toBeInTheDocument()
  })

  it('locks the route for a free account', async () => {
    asFree()
    renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByText(/this one’s on pro/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/venue spreadsheet/i)).not.toBeInTheDocument()
  })

  it('leaves a way through that does not cost anything', async () => {
    asFree()
    renderApp({ route: ROUTE, signedIn: true })

    const out = await screen.findByRole('link', { name: /add one venue instead/i })
    expect(out.getAttribute('href')).toBe('/venues/new')
  })

  it('makes the case in a dialog rather than in the page', async () => {
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))

    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    expect(within(dialog).getByText('R149')).toBeInTheDocument()
    expect(within(dialog).getByText(/per month/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/cancel any time/i)).toBeInTheDocument()
  })

  it('offers a plain way out of the dialog', async () => {
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    await user.click(within(dialog).getByRole('button', { name: /maybe later/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not pretend it can take money when the bench cannot', async () => {
    asFree()
    bench.checkout = null
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    await user.click(within(dialog).getByRole('button', { name: /^upgrade to pro$/i }))

    expect(await screen.findByText(/pro isn’t on sale yet/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument()
  })

  /**
   * The portal thought it was unlocked (the entitlements call could not be
   * answered, so it failed open) and the bench said no. That refusal is a
   * plan, not an error — it opens the upgrade dialog, and nothing is imported.
   */
  it('opens the upgrade dialog when the bench refuses the import as Pro-only', async () => {
    bench.deploy.get_entitlements = false
    bench.entitlements = { ...bench.entitlements, features: [] }
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByRole('dialog', { name: /stop typing your venues in/i })).toBeInTheDocument()
    expect(screen.getByText(/spreadsheet upload is on pro/i)).toBeInTheDocument()
    expect(bench.venueImports).toHaveLength(0)
  })

  it('unlocks for an account that has the entitlement', async () => {
    bench.deploy.get_entitlements = true
    bench.entitlements = { plan: 'pro', features: ['venue_bulk_import'] }
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await importFile(user)

    expect(await screen.findByText(/2 added/i)).toBeInTheDocument()
  })
})
