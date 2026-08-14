import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Adding a venue, through the five-step wizard.
 *
 * Everything here is typed, selected and clicked. The assertions that matter
 * are about what reached the SERVER — `bench.venues` after the fact — because a
 * wizard that collects five steps of information and posts four of them is
 * exactly the bug a render test cannot see.
 *
 * TWO THINGS THIS SUITE LEARNED BY DRIVING THE REAL UI, both of which an
 * assumption-based test would have got wrong:
 *
 *  1. Step one is **moods**, not venue details. Sho't Right is a mood-search
 *     product, so it asks for the vibe before the paperwork.
 *  2. The details step will not let you past without a location. That is right
 *     — a venue with no pin is found by nobody — and it means every test that
 *     wants to reach the end has to set one.
 *
 * Queries are by ROLE throughout. These inputs carry a visible <label> and an
 * aria-label with the same words, so a text lookup matches the same field twice
 * and RTL treats that as an error.
 */

const NAME = 'Nomsa’s Shisanyama'

const next = (user) => user.click(screen.getByRole('button', { name: /^next$/i }))

const chooseFirst = async (user, name) => {
  const select = screen.getByRole('combobox', { name })
  const option = [...select.options].find((o) => o.value)
  if (option) await user.selectOptions(select, option.value)
  return option?.value
}

/**
 * Choose the first address suggestion, which sets the address AND its point.
 *
 * The combobox is the ARIA pattern, so the suggestion is an `option` — clicking
 * it is what a partner does and it is the only remaining keyboard-reachable way
 * to place a first pin.
 */
async function pickAddress(user) {
  /* The option is an <li role="option"> wrapping the real <button>. Clicking
     the li does nothing — the handler is on the button, which is also what a
     partner's pointer and a keyboard both land on. */
  await user.click(await screen.findByRole('button', { name: /Gauteng, South Africa/i }))
  /* Wait for the POINT, not for the map's heading — that heading renders with
     or without a location, so waiting on it waits for nothing. The coordinate
     is on the map wrapper, which is the only place it is exposed now that the
     numeric fields are gone. Without this the next step validates a venue that
     has an address and no location, which is the exact silent-invisibility
     failure the map warns about. */
  await waitFor(() => {
    const node = document.querySelector('[data-field="latitude"]')
    expect(node?.getAttribute('data-latitude')).toBeTruthy()
  })
}

/** Step 1 — the vibe. */
async function pickMood(user, mood = 'Chilled') {
  await user.type(await screen.findByRole('textbox', { name: /^mood$/i }), mood)
  await user.click(screen.getByRole('button', { name: /add \+|^add$/i }))
}

/** Step 2 — the paperwork. `coords: false` deliberately leaves the pin unset. */
async function fillDetails(user, { name = NAME, coords = true } = {}) {
  await user.type(await screen.findByRole('textbox', { name: /venue name/i }), name)
  await user.type(screen.getByRole('textbox', { name: /manager name/i }), 'Nomsa')
  await user.type(screen.getByRole('textbox', { name: /manager surname/i }), 'Dlamini')
  await user.type(screen.getByRole('textbox', { name: /contact number/i }), '+27 82 111 2222')
  await user.type(screen.getByRole('combobox', { name: /^address/i }), '4th Ave, Mamelodi')
  await chooseFirst(user, /dress code/i)
  await chooseFirst(user, /atmosphere/i)

  if (coords) {
    /**
     * ⚠️ THE COORDINATES ARE NO LONGER TYPED. Changed 13 Aug.
     *
     * There used to be latitude and longitude inputs and this filled them in
     * directly. They are gone — a partner reads a street name, not
     * `-25.706900` — so the only ways to set a point are picking an address,
     * clicking the map, or geolocation.
     *
     * Picking the suggestion is what a partner actually does, which makes this
     * a better test than it was: it exercises the address→coordinates handoff
     * that the old version skipped entirely by writing the numbers by hand.
     */
    await pickAddress(user)
  }
  return name
}

/** Mood → details → hours → menu → review. Leaves the partner on Submit. */
async function walkToReview(user, opts) {
  await pickMood(user)
  await next(user)
  const name = await fillDetails(user, opts)
  await next(user) // hours (pre-filled with sensible defaults)
  await next(user) // menu (optional)
  await next(user) // review
  return name
}

const submit = async (user) =>
  user.click(await screen.findByRole('button', { name: /^submit$/i }))

describe('add a venue', () => {
  it('walks the whole wizard and creates the venue on the server', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await walkToReview(user)
    await submit(user)

    await waitFor(() => expect(bench.venues.some((v) => v.venue_name === name)).toBe(true))
  })

  it('never lets the client choose the approval state', async () => {
    /* `workflow_state` is the server's. The edit form once spread the whole
       venue back up on save, which sent it — a client that can approve its own
       venue is the one real security hole on this API surface. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user)
    await submit(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    expect(bench.calls.find((c) => c.method === 'create_venue').args).not.toHaveProperty(
      'workflow_state',
    )
    expect(bench.venues.find((v) => v.venue_name === NAME).workflow_state).toBe('Pending')
  })

  it('will not move past the details step without a venue name', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await pickMood(user)
    await next(user)
    await screen.findByRole('textbox', { name: /venue name/i })
    await next(user)

    // Still there, and told why rather than silently refusing to advance.
    expect(screen.getByRole('textbox', { name: /venue name/i })).toBeInTheDocument()
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
  })

  it('will not submit a venue with no location', async () => {
    /* A venue with no coordinates is never returned by a search, whatever else
       is on it. Being stopped here beats being approved and invisible. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await pickMood(user)
    await next(user)
    await fillDetails(user, { coords: false })
    await next(user)

    expect(screen.getByRole('textbox', { name: /venue name/i })).toBeInTheDocument()
    expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(false)
  })

  it('keeps what was typed when stepping backwards and forwards', async () => {
    /* Losing a step's input on Back is the wizard bug nobody reports — they
       just start again, and then they don't. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await pickMood(user)
    await next(user)
    const name = await fillDetails(user)
    await next(user)
    await user.click(screen.getByRole('button', { name: /back|previous/i }))

    expect(await screen.findByRole('textbox', { name: /venue name/i })).toHaveValue(name)
    /* The CANONICAL address, not the typed fragment. Picking a suggestion
       replaces what you typed with the address the geocoder recognises — which
       is the address the pin belongs to, and the one a customer will be
       navigating to. Asserting the fragment would be asserting that we ignored
       the thing the partner picked. */
    expect(screen.getByRole('combobox', { name: /^address/i })).toHaveValue(
      '4th Ave, Mamelodi, Gauteng, South Africa',
    )
  })

  it('sends the moods the partner actually chose', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user)
    await submit(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    expect(bench.venues.find((v) => v.venue_name === NAME).moods.length).toBeGreaterThan(0)
  })

  it('shows the new venue in the list afterwards', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await walkToReview(user)
    await submit(user)

    // The point of the whole flow: it is there when they go looking.
    expect(await screen.findByText(name, {}, { timeout: 6000 })).toBeInTheDocument()
  })

  it('does not lose the partner’s work when create_venue fails', async () => {
    bench.deploy.create_venue = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await walkToReview(user)
    await submit(user)

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    // Everything they entered is still on screen — no silent reset to step one.
    expect(
      screen.getByText(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
    ).toBeInTheDocument()
  })
})

describe('set a venue location', () => {
  it('sends the coordinates that were entered', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user)
    await submit(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const created = bench.venues.find((v) => v.venue_name === NAME)
    expect(Number(created.latitude)).toBeCloseTo(-25.7069, 3)
    expect(Number(created.longitude)).toBeCloseTo(28.2294, 3)
  })

  it('sends them as numbers, not strings', async () => {
    /* They come off an input as strings. A venue whose latitude is "-25.7"
       cannot be compared against a radius, so it is found by nobody — and
       nothing in the UI would ever show that. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user)
    await submit(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const call = bench.calls.find((c) => c.method === 'create_venue')
    expect(typeof call.args.latitude).toBe('number')
    expect(typeof call.args.longitude).toBe('number')
  })

  it('keeps the pin when the partner steps away and comes back', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await pickMood(user)
    await next(user)
    await fillDetails(user)
    await next(user)
    await user.click(screen.getByRole('button', { name: /back|previous/i }))

    /* The pin survives, read off the map wrapper rather than a coordinate
       field — those are gone. What is being protected is unchanged: stepping
       away and back must not quietly drop the one value that decides whether
       customers can find this venue. */
    await waitFor(() => {
      const node = document.querySelector('[data-field="latitude"]')
      expect(node?.getAttribute('data-latitude')).toBe('-25.7069')
    })
  })
})
