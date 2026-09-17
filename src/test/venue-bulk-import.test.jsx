/**
 * Many venues from one spreadsheet.
 *
 * The assertions that matter are the ones about what does NOT happen. A venue
 * is not a menu item: it enters a review queue, it is what customers see, and
 * it cannot be reliably deleted afterwards - `frappe.client.delete` is not a
 * permission the Vendor role can be counted on to have. Creating eleven venues
 * and then explaining is not recoverable the way "remove that dish" is.
 */
import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { VENUES_XLSX_BASE64 } from './fixtures/venuesXlsx'

const ROUTE = '/venues/import'
const HEADER =
  'venue_name,address,latitude,longitude,moods,dress_code,atmosphere,weekday_open,weekday_close,weekend_open,weekend_close'

const csv = (body) => new File([HEADER + '\n' + body], 'venues.csv', { type: 'text/csv' })

const upload = async (user, file) => {
  await user.upload(await screen.findByLabelText(/venue spreadsheet/i), file)
}

const GOOD =
  'Corner Kitchen,12 Long St,-33.92,18.42,Chilled,Smart casual,Low light,17:00,23:00,12:00,23:00'
const YARD =
  'The Yard,8 Sydney Rd,-33.93,18.47,Lively,Casual,Loud,16:00,23:00,16:00,23:00'

describe('reading the file', () => {
  it('shows what it understood before creating anything', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv(GOOD))

    expect(await screen.findByText(/1 ready/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing has been created yet/i)).toBeInTheDocument()
    expect(bench.venues).toHaveLength(before)
  })

  /**
   * The bench refuses an unknown mood outright - "Unknown mood: Nope" - so a
   * typo in one cell would otherwise fail the whole venue after a round trip,
   * with the partner none the wiser about which word was wrong.
   */
  it('catches a mood we do not have, by name, before sending', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv('The Yard,8 Sydney Rd,,,Raucous,Casual,Loud,16:00,23:00,16:00,23:00'))

    expect(await screen.findByText(/not one we have: Raucous/i)).toBeInTheDocument()
    expect(bench.venues).toHaveLength(before)
  })

  /* Two rows naming the same venue splits that venue's bookings across two
     listings whose owner sees neither half. Flagged on the second. */
  it('flags a repeated name against the line it first appeared on', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD + '\n' + GOOD))

    expect(await screen.findByText(/same name as line 2/i)).toBeInTheDocument()
    expect(screen.getByText(/1 ready/i)).toBeInTheDocument()
  })

  /* Excel writes times several ways and partners type others. All the same
     o'clock. */
  it.each(['5:00 PM', '17:00', '17:00:00'])('reads %s as a closing time', async (written) => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(
      user,
      csv('Late Bar,1 Main Rd,,,Chilled,Casual,Busy,09:00,' + written + ',09:00,' + written),
    )

    expect(await screen.findByText(/1 ready/i)).toBeInTheDocument()
  })

  /**
   * ⚠️ A REAL .XLSX, not the letters PK in a file called one.
   *
   * This used to refuse Excel and tell the partner to Save As CSV — which
   * worked, and asked a restaurant owner to learn a file format before they
   * could list their venues. They were asked for a spreadsheet, and a
   * spreadsheet is what Excel saves.
   *
   * The old test faked the binary, so it only ever proved we rejected it. This
   * fixture is a genuine OOXML package, which is the only way to know the
   * reader is wired up correctly.
   */
  it('reads a real Excel file', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    const bytes = Uint8Array.from(atob(VENUES_XLSX_BASE64), (c) => c.charCodeAt(0))
    await upload(
      user,
      new File([bytes], 'venues.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )

    expect(await screen.findByText(/2 ready/i, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Corner Kitchen')).toBeInTheDocument()
    expect(screen.getByText('The Yard')).toBeInTheDocument()
  })

  /* `.xls` is a different format and needs a much heavier parser. Said plainly,
     because "Save As .xlsx" is a real instruction and "we couldn't read that"
     is not. */
  it('is specific about the older .xls format rather than just failing', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, new File(['old binary'], 'venues.xls', { type: 'application/vnd.ms-excel' }))

    expect(await screen.findByText(/older \.xls format/i)).toBeInTheDocument()
  })
})

describe('creating them', () => {
  /**
   * ⚠️ DRAFTS, NOT VENUES, and this is the assertion that says so. A venue made
   * from a spreadsheet has no photographs, and a listing with no picture asks
   * someone to choose an evening on the strength of a name — so eleven rows
   * used to become eleven things a reviewer had to send back.
   *
   * A draft goes on the platform and waits. The partner opens one, finds their
   * own nine fields filled in, adds photos and submits through the flow that
   * already requires one rather than around it.
   */
  it('creates drafts and no venues at all', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const venuesBefore = bench.venues.length

    await upload(user, csv(GOOD + '\n' + YARD))
    await user.click(await screen.findByRole('button', { name: /create 2 drafts/i }))

    expect(await screen.findByText(/2 drafts ready/i)).toBeInTheDocument()
    expect(bench.drafts.map((d) => d.venue_name)).toEqual(
      expect.arrayContaining(['Corner Kitchen', 'The Yard']),
    )
    /* The whole point: nothing has gone for review. */
    expect(bench.venues).toHaveLength(venuesBefore)
    expect(screen.getByText(/nothing has gone for review yet/i)).toBeInTheDocument()
  })

  /* The spreadsheet's own values have to survive into the draft, or the partner
     opens it and retypes what they already sent us. */
  it('carries the row into the draft the wizard will resume', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD))
    await user.click(await screen.findByRole('button', { name: /create 1 draft/i }))

    await screen.findByText(/1 draft ready/i)
    const saved = bench.drafts.at(-1)
    const payload = typeof saved.payload === 'string' ? JSON.parse(saved.payload) : saved.payload
    expect(payload.details.venue_name).toBe('Corner Kitchen')
    expect(payload.details.address).toBe('12 Long St')
    expect(payload.hours.weekday).toEqual({ start: '17:00', end: '23:00' })
    expect(payload.moods.moods[0].label).toBe('Chilled')
    /* Nobody has looked at the menu or the review step, so neither is complete
       — marking one is how a partner submits a venue believing they saw it. */
    const completed =
      typeof saved.completed === 'string' ? JSON.parse(saved.completed) : saved.completed
    expect(completed).not.toContain('review')
    expect(completed).not.toContain('menu')
  })

  /* A blocked row is never sent, so a file that is half wrong still gets the
     half that is right. */
  it('sends only the rows that were ready', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.drafts.length

    await upload(user, csv(GOOD + '\nBroken,,,,Nope,Casual,x,17:00,23:00,17:00,23:00'))
    await user.click(await screen.findByRole('button', { name: /create 1 draft/i }))

    await waitFor(() => expect(bench.drafts).toHaveLength(before + 1))
    expect(bench.drafts.some((d) => d.venue_name === 'Broken')).toBe(false)
  })

  /**
   * A venue with no coordinates saves perfectly well and is invisible to a
   * customer searching nearby. `createVenue` already warns about that for a
   * single venue; arriving in a spreadsheet must not make it quieter.
   */
  it('carries the note about a venue with no map location into the result', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv('No Pin,4 Bree St,,,Chilled,Casual,Quiet,17:00,23:00,17:00,23:00'))
    await user.click(await screen.findByRole('button', { name: /create 1 draft/i }))

    expect(await screen.findByText(/1 draft ready/i)).toBeInTheDocument()
    expect(screen.getByText(/no map location/i)).toBeInTheDocument()
  })

  /* The point of drafts, said once, with somewhere to go. */
  it('sends them to add photos rather than leaving it implied', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD))
    await user.click(await screen.findByRole('button', { name: /create 1 draft/i }))

    expect(await screen.findByText(/add photos and send it for review/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Corner Kitchen' })
    expect(link.getAttribute('href')).toMatch(/\/venues\/new\?draft=/)
  })

  /**
   * One failure must not end the run. Stopping at the first bad venue leaves a
   * partner with four of eleven created, no record of which four, and a file
   * they dare not upload again.
   */
  it('keeps going past a draft the server refused, and names it', async () => {
    bench.draftSaveRefuses = 'The Yard'
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.drafts.length

    await upload(user, csv(YARD + '\n' + GOOD))
    await user.click(await screen.findByRole('button', { name: /create 2 drafts/i }))

    expect(await screen.findByText(/1 draft ready/i)).toBeInTheDocument()
    await waitFor(() => expect(bench.drafts).toHaveLength(before + 1))

    const notAdded = screen.getByRole('heading', { name: /not added/i }).parentElement
    expect(within(notAdded).getByText('The Yard')).toBeInTheDocument()
  })
})

describe('the round trip', () => {
  /**
   * The claim this whole feature rests on: a row becomes a draft, and that
   * draft opens in the wizard with the partner's own values in it.
   *
   * Asserting the saved payload is not enough — it proves we wrote a shape we
   * invented, not that the wizard reads it. The shapes are mirrored by hand
   * from `VenueWizard`'s INITIAL_DETAILS and INITIAL_HOURS, and a key that only
   * exists on one side is exactly the kind of quiet mismatch this project keeps
   * paying for.
   */
  it('opens in the wizard with the spreadsheet already filled in', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD))
    await user.click(await screen.findByRole('button', { name: /create 1 draft/i }))
    await screen.findByText(/1 draft ready/i)

    await user.click(screen.getByRole('link', { name: 'Corner Kitchen' }))

    /* Straight onto the form — a row that arrived in a spreadsheet has already
       been imported, so offering the import screen again would invite the
       partner to overwrite the values they just uploaded. */
    const name = await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 5000 })
    expect(name).toHaveValue('Corner Kitchen')
    /* The address is behind the confirm row now, so it is read off the row
       rather than out of an input — which is also what the partner sees. */
    expect(screen.getByText('12 Long St')).toBeInTheDocument()
  })
})

describe('end to end, from Excel to a draft the wizard opens', () => {
  /**
   * The whole path in one test, because every link in it has broken at least
   * once: the reader returns a shape we did not expect, the `accept` attribute
   * filters the file before our code sees it, the draft payload does not match
   * what the wizard reads back.
   *
   * A partner exports from Excel, uploads, reviews, creates — and lands in the
   * wizard on their own venue with the fields already filled in.
   */
  it('Excel file in, wizard open on the venue out', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    const bytes = Uint8Array.from(atob(VENUES_XLSX_BASE64), (c) => c.charCodeAt(0))
    await upload(
      user,
      new File([bytes], 'venues.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )

    await screen.findByText(/2 ready/i, {}, { timeout: 5000 })
    await user.click(await screen.findByRole('button', { name: /create 2 drafts/i }))

    expect(await screen.findByText(/2 drafts ready/i)).toBeInTheDocument()
    expect(bench.drafts.map((d) => d.venue_name)).toEqual(
      expect.arrayContaining(['Corner Kitchen', 'The Yard']),
    )

    await user.click(screen.getByRole('link', { name: 'Corner Kitchen' }))

    const name = await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 5000 })
    expect(name).toHaveValue('Corner Kitchen')
    expect(screen.getByText('12 Long St')).toBeInTheDocument()
  })
})

/* ============================================================================
   BULK IMPORT IS PRO — as of 17 Sep

   Gated in TWO places, and the second one is the point: this route has its own
   URL, is linked from the venues list, and is in partners' history. A paywall
   with a hole in it is not a paywall — worse, it is one that punishes the
   partners who followed the UI and rewards the ones who kept a bookmark.

   The tests that matter here are the ones about NOT locking. A monetisation
   feature that turns a bench outage into an apparent mass downgrade is a far
   more expensive bug than a free upload.
   ========================================================================= */
describe('the Pro gate', () => {
  const asFree = () => {
    bench.deploy.get_entitlements = true
    bench.entitlements = { plan: 'free', features: [] }
  }

  it('does not lock anybody when the bench has no paywall', async () => {
    /* ⚠️ THE STATE EVERY PARTNER IS IN TODAY. `get_entitlements` shipped in
       PR #44 but is not reachable over HTTP yet, and an unanswered question
       must never read as "you have not paid". */
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD))

    expect(await screen.findByText(/1 ready/i)).toBeInTheDocument()
    expect(screen.queryByText(/this one’s on pro/i)).not.toBeInTheDocument()
  })

  it('locks the route for a free account', async () => {
    asFree()
    renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByText(/this one’s on pro/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/venue spreadsheet/i)).not.toBeInTheDocument()
  })

  it('leaves a way through that does not cost anything', async () => {
    /* A paywall that leaves somebody with nowhere to go converts nobody and
       loses the venue as well as the subscription. */
    asFree()
    renderApp({ route: ROUTE, signedIn: true })

    const out = await screen.findByRole('link', { name: /add one venue instead/i })
    expect(out.getAttribute('href')).toBe('/venues/new')
  })

  it('makes the case in a dialog rather than in the page', async () => {
    /* The in-place lock is one line; the selling happens once somebody asks.
       A permanent marketing block inside the product reads as an advert to
       someone who came to do a job. */
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))

    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    expect(within(dialog).getByText('R149')).toBeInTheDocument()
    expect(within(dialog).getByText(/per month/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/cancel any time/i)).toBeInTheDocument()
  })

  it('offers a plain way out of the dialog', async () => {
    /* A modal whose only visible exit is a grey cross in a corner is a dark
       pattern. This one closes four ways; here is the one with words on it. */
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    await user.click(within(dialog).getByRole('button', { name: /maybe later/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not pretend it can take money before there is a way to take it', async () => {
    /* ⚠️ THERE IS NO PAYFAST ADAPTER YET. A button that looks like it charges
       and silently does nothing is the worst outcome available: the partner
       believes they have subscribed, finds the feature still locked, and now
       distrusts both the paywall and the invoice they are waiting for. */
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    await user.click(within(dialog).getByRole('button', { name: /^upgrade to pro$/i }))

    expect(await screen.findByText(/pro isn’t on sale yet/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument()
  })

  it('unlocks for an account that has the entitlement', async () => {
    bench.deploy.get_entitlements = true
    bench.entitlements = { plan: 'pro', features: ['venue_import', 'bulk_import'] }
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD))

    expect(await screen.findByText(/1 ready/i)).toBeInTheDocument()
  })
})
