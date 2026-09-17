import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * SCREEN ONE — "start with your existing listing", and the paywall on it.
 *
 * Added 17 Sep with the add-venue redesign. Two features meet here and the
 * interesting tests are where they disagree with each other:
 *
 *   THE IMPORT SCREEN only exists when the bench can actually serve a route.
 *   THE PAYWALL only locks when the bench has actually said so.
 *
 * Both default to the generous answer, and both defaults are load-bearing. On
 * the live bench today `search_places` is absent and `get_entitlements` is not
 * reachable, so the correct behaviour for every real partner is: no import
 * screen at all, and nothing locked. A suite that only tested the happy
 * configuration would be testing a product nobody is using yet.
 */

const ROUTE = '/venues/new'

const PLACE = {
  place_id: 'ChIJ-yard',
  display_name: 'The Yard Braai & Bar',
  formatted_address: '12 Kramer Street, Brooklyn, Pretoria',
  latitude: -25.7712,
  longitude: 28.2163,
  phone: '012 460 1188',
}

const withPlaces = () => {
  bench.places = [{ ...PLACE }]
}

const asFree = () => {
  bench.deploy.get_entitlements = true
  bench.entitlements = { plan: 'free', features: [] }
}

const asPro = () => {
  bench.deploy.get_entitlements = true
  bench.entitlements = { plan: 'pro', features: ['venue_import', 'bulk_import'] }
}

describe('when the screen appears at all', () => {
  it('appears when the bench can serve a route', async () => {
    withPlaces()
    renderApp({ route: ROUTE, signedIn: true })

    expect(
      await screen.findByRole('heading', { name: /start with your existing listing/i }),
    ).toBeInTheDocument()
  })

  it('is skipped entirely when no single-venue route works', async () => {
    /* ⚠️ THE LIVE BENCH. `search_places` is not in api.py and the URL importer
       has never been written. A screen offering three shortcuts where all three
       are dead costs a click and delivers a broken promise — so it does not
       render, and the partner lands on the form exactly as they do today. */
    bench.deploy.search_places = false
    bench.deploy.get_place_details = false
    renderApp({ route: ROUTE, signedIn: true })

    await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 4000 })
    expect(screen.queryByText(/start with your existing listing/i)).not.toBeInTheDocument()
  })

  it('does not offer a route the bench cannot serve', async () => {
    /* The Facebook / Instagram / website importer does not exist. Rendering its
       tab would put a partner's Instagram URL into a box that goes nowhere. */
    withPlaces()
    renderApp({ route: ROUTE, signedIn: true })

    await screen.findByRole('heading', { name: /start with your existing listing/i })
    expect(screen.queryByRole('tab', { name: /facebook or instagram/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /your website/i })).not.toBeInTheDocument()
  })

  it('offers the URL routes once that importer is deployed', async () => {
    withPlaces()
    bench.deploy.import_venue_from_url = true
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('tab', { name: /facebook or instagram/i }))
    expect(await screen.findByLabelText(/paste your page link/i)).toBeInTheDocument()
  })

  it('never lands a resumed draft on it', async () => {
    /* They have been past this screen already. Offering to fill in a form they
       have half-filled is offering to overwrite their work. */
    withPlaces()
    bench.drafts.push({
      draft_id: 'DRAFT-1',
      venue_name: 'Half Done',
      step: 'basics',
      completed: JSON.stringify([]),
      payload: JSON.stringify({ details: { venue_name: 'Half Done' } }),
      updated_at: new Date().toISOString(),
    })
    renderApp({ route: '/venues/new?draft=DRAFT-1', signedIn: true })

    const name = await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 5000 })
    expect(name).toHaveValue('Half Done')
    expect(screen.queryByText(/start with your existing listing/i)).not.toBeInTheDocument()
  })
})

describe('importing is Pro', () => {
  it('does not lock anybody when the bench has no paywall', async () => {
    /* ⚠️ THE MOST IMPORTANT TEST IN THIS FILE.

       `get_entitlements` shipped in PR #44 and is not reachable over HTTP yet,
       so "we could not ask" is the state every partner is in. If that read as
       "you have not paid", every partner in production would be shown a paywall
       for something nobody is selling — and the same would happen on any future
       bench hiccup. An unanswered question unlocks. */
    withPlaces()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.type(await screen.findByLabelText(/find your listing/i), 'Yard')
    expect(await screen.findByRole('button', { name: /The Yard Braai & Bar/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^unlock$/i })).not.toBeInTheDocument()
  })

  it('locks the search for a free account', async () => {
    withPlaces()
    asFree()
    renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByRole('button', { name: /^unlock$/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/find your listing/i)).not.toBeInTheDocument()
  })

  it('keeps the lock to one line and sells in the dialog', async () => {
    /* Both of the paywalls this was drawn from do the same thing: a one-line
       in-place lock, and the argument in a dialog once somebody asks. A
       permanent marketing block inside a form is read as an advert by someone
       who came to do a job, and it pushes the work they came for below the
       fold. */
    withPlaces()
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    expect(screen.queryByText(/everything in free, plus/i)).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /^unlock$/i }))

    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    expect(within(dialog).getByText(/everything in free, plus/i)).toBeInTheDocument()
  })

  it('says the price and the cadence together', async () => {
    /* A paywall that hides the recurrence until checkout is the thing people
       write angry reviews about. */
    withPlaces()
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^unlock$/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop typing your venues in/i })

    expect(within(dialog).getByText('R149')).toBeInTheDocument()
    expect(within(dialog).getByText(/per month/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/cancel any time/i)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    withPlaces()
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^unlock$/i }))
    await screen.findByRole('dialog', { name: /stop typing your venues in/i })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('leaves the free path open and never blocks the form', async () => {
    /* A partner who will not pay must still be able to list their venue. The
       skip is quieter than the panel, and it works exactly the same. */
    withPlaces()
    asFree()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /skip — i’ll type it in myself/i }))

    await user.type(await screen.findByRole('textbox', { name: /venue name/i }), 'Brand New Place')
    expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue('Brand New Place')
  })

  it('unlocks the search for an account that has the entitlement', async () => {
    withPlaces()
    asPro()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.type(await screen.findByLabelText(/find your listing/i), 'Yard')

    expect(await screen.findByRole('button', { name: /The Yard Braai & Bar/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^unlock$/i })).not.toBeInTheDocument()
  })

  it('unlocks one feature without unlocking the other', async () => {
    /* Entitlements are rows, not a plan name. An account entitled to the single
       venue import and not to the spreadsheet must see exactly that — this is
       the whole reason the bench stores capabilities as data. */
    withPlaces()
    bench.deploy.get_entitlements = true
    bench.entitlements = { plan: 'pro', features: ['venue_import'] }
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByLabelText(/find your listing/i)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /several venues/i }))
    expect(await screen.findByRole('button', { name: /^unlock$/i })).toBeInTheDocument()
  })

  it('reads a row that is switched off as switched off', async () => {
    /* The doctype can carry a disabled row. `enabled: 0` is not an entitlement
       with a falsy flag hanging off it, it is an absence. */
    withPlaces()
    bench.deploy.get_entitlements = true
    bench.entitlements = {
      plan: 'pro',
      features: [{ key: 'venue_import', enabled: 0 }, { key: 'bulk_import', enabled: 1 }],
    }
    renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByRole('button', { name: /^unlock$/i })).toBeInTheDocument()
  })

  it('unlocks everything when the bench says the gate is off', async () => {
    /* The backend's cutoff lives in site_config and is inert when unset. A
       bench that answers "no gate" is saying the feature is not being sold
       here yet, which is a different state to "this partner has not paid" —
       and the only correct response to it is to show nobody a lock. */
    withPlaces()
    bench.deploy.get_entitlements = true
    bench.entitlements = { gate_active: false, plan: 'free', features: [] }
    renderApp({ route: ROUTE, signedIn: true })

    expect(await screen.findByLabelText(/find your listing/i)).toBeInTheDocument()
  })
})

describe('the spreadsheet route', () => {
  it('hands the file to the screen that reviews it, rather than reading it here', async () => {
    /* ⚠️ THE REVIEW STEP IS THE FEATURE. A venue enters a review queue, is what
       customers see, and cannot be reliably deleted afterwards — so nothing is
       created until the partner has seen what we understood. Reading the file
       on this panel would quietly route around the one screen that makes bulk
       import safe. */
    withPlaces()
    asPro()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('tab', { name: /several venues/i }))

    const file = new File(
      [
        'venue_name,address,latitude,longitude,moods,dress_code,atmosphere,weekday_open,weekday_close,weekend_open,weekend_close\n' +
          'Corner Kitchen,12 Long St,-33.92,18.42,Chilled,Smart casual,Low light,17:00,23:00,12:00,23:00',
      ],
      'venues.csv',
      { type: 'text/csv' },
    )
    await user.upload(await screen.findByLabelText(/venue spreadsheet/i), file)

    // Landed on the bulk import screen, with the row already read and nothing
    // created yet.
    expect(await screen.findByText(/1 ready/i, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/nothing has been created yet/i)).toBeInTheDocument()
  })
})
