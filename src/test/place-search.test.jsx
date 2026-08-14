import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * CLAIMING A VENUE THAT IS ALREADY ON GOOGLE.
 *
 * A restaurant trading for six years is already listed, correctly, with its
 * address and phone number. Making that owner retype all of it is asking them
 * to prove they are serious, and the wizard's drop-off is exactly there.
 *
 * The feature is worth having and it is also the one on this project with the
 * most ways to be quietly wrong, so the load-bearing tests here are the
 * negative ones:
 *
 *   - nothing of Google's but the `place_id` may reach the database;
 *   - a prefilled field must SAY it was prefilled, because the partner is the
 *     one publishing it;
 *   - results must never be drawn on our OpenStreetMap tiles;
 *   - and the whole thing must vanish without trace on a bench that has no
 *     proxy, leaving the wizard exactly as it is today.
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

const openWizard = () => renderApp({ route: '/venues/new', signedIn: true })

/** Step 1 is moods. The search lives on step 2. */
const toDetails = async (user) => {
  await user.type(await screen.findByRole('textbox', { name: /^mood$/i }), 'Chilled')
  await user.click(screen.getByRole('button', { name: /add \+|^add$/i }))
  await user.click(screen.getByRole('button', { name: /^next$/i }))
}

const search = async (user, text) => {
  await user.type(await screen.findByLabelText(/search for your venue/i), text)
}

describe('finding a venue that already exists', () => {
  it('offers the search before asking anyone to type', async () => {
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)

    expect(await screen.findByText(/already on google\? start from there/i)).toBeInTheDocument()
  })

  it('finds it and fills the form in', async () => {
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')

    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue(
        'Corner Kitchen & Bar',
      ),
    )
    expect(screen.getByRole('combobox', { name: /^address/i })).toHaveValue('12 Long St, Cape Town')
    expect(screen.getByRole('textbox', { name: /contact number/i })).toHaveValue('+27 21 555 0100')
  })

  it('sets the location, so the venue is findable', async () => {
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')
    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

    /* Read off the map wrapper — the coordinate fields are gone. What matters
       is unchanged and is the whole reason this test exists: a venue without a
       point is invisible to every customer, because search is a radius query. */
    await waitFor(() => {
      const node = document.querySelector('[data-field="latitude"]')
      expect(node?.getAttribute('data-latitude')).toBe('-33.9249')
    })
  })

  it('does not search on the first keystroke', async () => {
    /* Search is free; a request per character still is not free of latency, a
       rate limit, or a bill if the proxy ever moves to a paid SKU.

       The empty-query PROBE is excluded rather than asserted away: it is a
       deliberate one-per-tab call that decides whether to render the box at
       all, and counting it here would make this test about the wrong thing. */
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Co')

    await new Promise((r) => setTimeout(r, 700))
    const typed = bench.calls.filter((c) => c.method === 'search_places' && c.args.query)
    expect(typed).toHaveLength(0)
  })

  it('probes once, not once per keystroke', async () => {
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await screen.findByLabelText(/search for your venue/i)
    await search(user, 'Corner Kitchen')
    await screen.findByRole('button', { name: /Corner Kitchen & Bar/i })

    const probes = bench.calls.filter((c) => c.method === 'search_places' && !c.args.query)
    expect(probes).toHaveLength(1)
  })

  it('only fetches details for the one that was picked', async () => {
    /* The billable call. It fires on a deliberate pick — never per result,
       never on hover, never speculatively for the list. */
    seed(CORNER, { ...CORNER, place_id: 'ChIJ-other', display_name: 'Corner Cafe' })
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')

    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

    await waitFor(() => {
      const details = bench.calls.filter((c) => c.method === 'get_place_details')
      expect(details).toHaveLength(1)
      expect(details[0].args.place_id).toBe('ChIJ-corner-kitchen')
    })
  })
})

describe('what the partner is told', () => {
  it('says the fields were filled in and asks them to check', async () => {
    /* The whole ethical load of the feature. They are publishing this, so they
       have to have read it — a listing that is six months stale is exactly the
       kind of thing that looks right and is wrong. */
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')
    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

    expect(await screen.findByText(/filled in what we found — please check it/i)).toBeInTheDocument()
    expect(screen.getByText(/what you submit is what customers will see/i)).toBeInTheDocument()
  })

  it('marks each prefilled field, rather than only saying so once', async () => {
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')
    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveAttribute(
        'data-prefilled',
        'true',
      ),
    )
  })

  it('stops calling a field prefilled once the partner edits it', async () => {
    /* A marker that outlives the value it describes teaches people to ignore
       markers — and the next one will be the one that mattered. */
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')
    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))

    const name = await screen.findByRole('textbox', { name: /venue name/i })
    await waitFor(() => expect(name).toHaveAttribute('data-prefilled', 'true'))

    await user.type(name, ' & Grill')
    await waitFor(() => expect(name).not.toHaveAttribute('data-prefilled', 'true'))
  })

  it('never offers a venue somebody else has already listed', async () => {
    /* Two listings for one restaurant splits its bookings in half and neither
       owner sees the other half. */
    seed({ ...CORNER, claimed: true })
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')

    const row = await screen.findByRole('button', { name: /Corner Kitchen & Bar/i })
    expect(row).toBeDisabled()
    expect(within(row).getByText(/already listed on sho’t right/i)).toBeInTheDocument()
  })
})

describe('what must never reach the database', () => {
  it('sends the place id and nothing else of Google’s', async () => {
    /* The place id is storable indefinitely. Ratings, reviews, photos and the
       atmosphere attributes are not — they must be fetched live and thrown
       away — so the ONLY safe design is one where they never enter the client
       in a shape that could be spread into a payload. */
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')
    await user.click(await screen.findByRole('button', { name: /Corner Kitchen & Bar/i }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue(
        'Corner Kitchen & Bar',
      ),
    )

    await user.type(screen.getByRole('textbox', { name: /manager name/i }), 'Nomsa')
    await user.type(screen.getByRole('textbox', { name: /manager surname/i }), 'Dlamini')
    await user.click(screen.getByRole('button', { name: /^next$/i })) // hours
    await user.click(screen.getByRole('button', { name: /^next$/i })) // menu
    await user.click(screen.getByRole('button', { name: /^next$/i })) // review
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const created = bench.calls.find((c) => c.method === 'create_venue').args

    expect(created.place_id).toBe('ChIJ-corner-kitchen')
    for (const forbidden of ['rating', 'user_rating_count', 'userRatingCount', 'reviews', 'photos']) {
      expect(created[forbidden]).toBeUndefined()
    }
  })

  it('never puts a Google result on our map', async () => {
    /* Places content shown on a map has to be on a GOOGLE map, and this portal
       draws Leaflet over OpenStreetMap tiles. Results are a list. This asserts
       the structure, because the policy is easier to keep by construction than
       by remembering. */
    seed(CORNER)
    const { user } = openWizard()
    await toDetails(user)
    await search(user, 'Corner')

    const row = await screen.findByRole('button', { name: /Corner Kitchen & Bar/i })
    expect(row.closest('ul')).toBeInTheDocument()
    expect(row.closest('.leaflet-container')).toBeNull()
  })
})

describe('a bench with no Places proxy', () => {
  it('shows no search box at all', async () => {
    /* Not a disabled one, not an explanation — nothing. The form behind it
       works perfectly, and a partner has no use for the sentence "an
       accelerator you have never seen is unavailable". */
    bench.deploy.search_places = false
    const { user } = openWizard()
    await toDetails(user)

    await screen.findByRole('textbox', { name: /venue name/i })
    expect(screen.queryByLabelText(/search for your venue/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/already on google/i)).not.toBeInTheDocument()
  })

  it('leaves the wizard entirely usable', async () => {
    bench.deploy.search_places = false
    bench.deploy.get_place_details = false
    const { user } = openWizard()
    await toDetails(user)

    await user.type(await screen.findByRole('textbox', { name: /venue name/i }), 'Brand New Place')
    expect(screen.getByRole('textbox', { name: /venue name/i })).toHaveValue('Brand New Place')
  })
})
