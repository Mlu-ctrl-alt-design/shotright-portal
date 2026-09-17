import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { addPhoto, describeVenue, saveAndAddPhotos, sendForReview } from './addVenue'

/**
 * CLAIMING A VENUE THAT IS ALREADY ON GOOGLE.
 *
 * A restaurant trading for six years is already listed, correctly, with its
 * address and phone number. Making that owner retype all of it is asking them
 * to prove they are serious, and the wizard's drop-off is exactly there.
 *
 * ⚠️ THE SEARCH MOVED on 17 Sep. It used to sit at the top of the details step,
 * competing with the form beneath it; it is now the whole of screen one, with
 * nothing else on it. The load-bearing tests are unchanged, because what makes
 * this feature dangerous is unchanged:
 *
 *   - nothing of Google's but the `place_id` may reach the database;
 *   - a prefilled field must SAY it was prefilled, because the partner is the
 *     one publishing it;
 *   - results must never be drawn on our OpenStreetMap tiles;
 *   - and the whole thing must vanish without trace on a bench that has no
 *     proxy, leaving the form exactly as it is today.
 *
 * That last one is not hypothetical any more. `search_places` is NOT deployed
 * on the live bench, so the no-proxy case below is what every real partner sees
 * today — which is why it asserts that the import screen does not appear at
 * all rather than that it appears empty.
 */

const CORNER = {
  place_id: 'ChIJ-corner-kitchen',
  display_name: 'Corner Kitchen & Bar',
  formatted_address: '12 Long St, Cape Town',
  latitude: -33.9249,
  longitude: 18.4241,
  phone: '+27 21 555 0100',
  /* Deliberately present on the fixture and deliberately never returned by the
     handler — see the note there. If one of these ever appears on screen or in
     a payload, something is reading fields it may not keep. */
  rating: 4.6,
  userRatingCount: 812,
}

const seed = (...places) => {
  bench.places = places.map((p) => ({ ...p }))
}

const openAddVenue = () => renderApp({ route: '/venues/new', signedIn: true })

const search = async (user, text) => {
  await user.type(await screen.findByLabelText(/find your listing/i), text)
}

const pickCorner = async (user) =>
  user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

describe('finding a venue that already exists', () => {
  it('is the first thing asked, before any field', async () => {
    seed(CORNER)
    openAddVenue()

    expect(
      await screen.findByRole('heading', { name: /start with your existing listing/i }),
    ).toBeInTheDocument()
    /* Nothing else competing for the decision. The moment this screen carries a
       second thing to do it stops being a shortcut and becomes another step. */
    expect(screen.queryByRole('textbox', { name: /venue name/i })).not.toBeInTheDocument()
  })

  it('finds it and fills the form in', async () => {
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue(
        'Corner Kitchen & Bar',
      ),
    )
    expect(screen.getByRole('textbox', { name: /contact number/i })).toHaveValue(
      '+27 21 555 0100',
    )
    /* The address lives behind the confirm row now, so it is read off the row
       rather than out of an input — which is also what the partner sees. */
    expect(screen.getByText('12 Long St, Cape Town')).toBeInTheDocument()
  })

  it('sets the location, so the venue is findable', async () => {
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)

    /* A venue without a point is invisible to every customer, because search is
       a radius query. The confirm row says so in words the partner can check. */
    expect(await screen.findByText(/pinned from your address/i)).toBeInTheDocument()
  })

  it('does not search on the first keystroke', async () => {
    /* Search is free; a request per character still is not free of latency, a
       rate limit, or a bill if the proxy ever moves to a paid SKU.

       The empty-query PROBE is excluded rather than asserted away: it is a
       deliberate one-per-tab call that decides whether to offer the screen at
       all, and counting it here would make this test about the wrong thing. */
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Co')

    await new Promise((r) => setTimeout(r, 700))
    const typed = bench.calls.filter((c) => c.method === 'search_places' && c.args.query)
    expect(typed).toHaveLength(0)
  })

  it('probes once, not once per keystroke', async () => {
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner Kitchen')
    await screen.findByRole('button', { name: /Corner Kitchen & Bar/i })

    const probes = bench.calls.filter((c) => c.method === 'search_places' && !c.args.query)
    expect(probes).toHaveLength(1)
  })

  it('only fetches details for the one that was picked', async () => {
    /* The billable call. It fires on a deliberate pick — never per result,
       never on hover, never speculatively for the list. */
    seed(CORNER, { ...CORNER, place_id: 'ChIJ-other', display_name: 'Corner Cafe' })
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)

    await waitFor(() => {
      const details = bench.calls.filter((c) => c.method === 'get_place_details')
      expect(details).toHaveLength(1)
      expect(details[0].args.place_id).toBe('ChIJ-corner-kitchen')
    })
  })

  it('takes them to the form, and says why it looks filled in', async () => {
    /* The whole ethical load of the feature. They are publishing this, so they
       have to have read it — a listing that is six months stale is exactly the
       kind of thing that looks right and is wrong. */
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)

    expect(await screen.findByText(/filled from that listing/i)).toBeInTheDocument()
    expect(screen.getByText(/type over anything wrong/i)).toBeInTheDocument()
    expect(
      screen.getByText(/check the marked fields and add the rest/i),
    ).toBeInTheDocument()
  })

  it('marks each prefilled field, rather than only saying so once', async () => {
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveAttribute(
        'data-prefilled',
        'true',
      ),
    )
    expect(screen.getAllByText(/from google/i).length).toBeGreaterThan(0)
  })

  it('stops calling a field prefilled once the partner edits it', async () => {
    /* A marker that outlives the value it describes teaches people to ignore
       markers — and the next one will be the one that mattered. */
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)

    const name = await screen.findByRole('textbox', { name: /venue name/i })
    await waitFor(() => expect(name).toHaveAttribute('data-prefilled', 'true'))

    await user.type(name, ' & Grill')
    await waitFor(() => expect(name).not.toHaveAttribute('data-prefilled', 'true'))
  })

  it('never offers a venue somebody else has already listed', async () => {
    /* Two listings for one restaurant splits its bookings in half and neither
       owner sees the other half. */
    seed({ ...CORNER, claimed: true })
    const { user } = openAddVenue()
    await search(user, 'Corner')

    const row = await screen.findByRole('button', { name: /Corner Kitchen & Bar/i })
    expect(row).toBeDisabled()
    expect(within(row).getByText(/already claimed by another account/i)).toBeInTheDocument()
  })

  it('lets them out without importing anything', async () => {
    /* A venue that is not on Google — new, home-run, a pop-up — must not feel
       like a second-class listing, and a partner who does not want to be
       matched to a Google record should not have to explain themselves. */
    seed(CORNER)
    const { user } = openAddVenue()

    await user.click(await screen.findByRole('button', { name: /skip — i’ll type it in myself/i }))

    expect(await screen.findByRole('textbox', { name: /venue name/i })).toHaveValue('')
    expect(screen.queryByText(/filled from that listing/i)).not.toBeInTheDocument()
  })
})

describe('what must never reach the database', () => {
  it('sends the place id and nothing else of Google’s', async () => {
    /* The place id is storable indefinitely. Ratings, reviews, photos and the
       atmosphere attributes are not — they must be fetched live and thrown
       away — so the ONLY safe design is one where they never enter the client
       in a shape that could be spread into a payload. */
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')
    await pickCorner(user)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue(
        'Corner Kitchen & Bar',
      ),
    )

    await user.type(screen.getByRole('textbox', { name: /^manager$/i }), 'Nomsa Dlamini')
    await user.click(await screen.findByRole('button', { name: /^Chilled$/i }))
    await describeVenue(user)
    await saveAndAddPhotos(user)
    await addPhoto(user)
    await sendForReview(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const created = bench.calls.find((c) => c.method === 'create_venue').args

    expect(created.place_id).toBe('ChIJ-corner-kitchen')
    for (const forbidden of ['rating', 'user_rating_count', 'userRatingCount', 'reviews']) {
      expect(created[forbidden]).toBeUndefined()
    }
  })

  it('never puts a Google result on our map', async () => {
    /* Places content shown on a map has to be on a GOOGLE map, and this portal
       draws Leaflet over OpenStreetMap tiles. Results are a list. This asserts
       the structure, because the policy is easier to keep by construction than
       by remembering. */
    seed(CORNER)
    const { user } = openAddVenue()
    await search(user, 'Corner')

    const row = await screen.findByRole('button', { name: /Corner Kitchen & Bar/i })
    expect(row.closest('ul')).toBeInTheDocument()
    expect(row.closest('.leaflet-container')).toBeNull()
  })
})

describe('a bench with no Places proxy', () => {
  /**
   * ⚠️ THIS IS THE LIVE BENCH, not an edge case. `search_places` is absent from
   * `api.py` and the URL importer has never been written, so today every real
   * partner takes this path.
   */
  it('does not show the import screen at all', async () => {
    /* Not a disabled one, not an explanation — nothing. A screen offering three
       ways to skip the typing, where all three are dead, costs a click and
       delivers a broken promise. */
    bench.deploy.search_places = false
    bench.deploy.get_place_details = false
    openAddVenue()

    await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 4000 })
    expect(screen.queryByText(/start with your existing listing/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/find your listing/i)).not.toBeInTheDocument()
  })

  it('leaves the form entirely usable', async () => {
    bench.deploy.search_places = false
    bench.deploy.get_place_details = false
    const { user } = openAddVenue()

    await user.type(
      await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 4000 }),
      'Brand New Place',
    )
    expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue('Brand New Place')
  })
})
