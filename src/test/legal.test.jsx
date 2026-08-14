import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * ACCEPTING THE LEGAL DOCUMENTS.
 *
 * This suite is stricter than the rest of the harness, because the failure mode
 * is different in kind. Everywhere else, a write we get wrong costs a partner a
 * retype. Here, a tick we show over an unwritten row is a manufactured record
 * of agreement — and nobody discovers it until there is a dispute and there is
 * nothing to produce.
 *
 * So the load-bearing tests are the negative ones: a 200 that wrote nothing
 * must not read as accepted, a document whose text failed to arrive must not
 * offer a tickbox, and a bench that cannot record acceptance must not be
 * allowed to block a partner out of work they have already done.
 */

const TERMS = {
  name: 'LEGAL-TERMS',
  title: 'Partner Terms of Service',
  version: '2.1',
  effective_date: '2026-08-01',
  content: '<p>You agree to keep your menu prices current.</p>',
  required: 1,
}

const PRIVACY = {
  name: 'LEGAL-PRIVACY',
  title: 'Privacy Policy',
  version: '1.0',
  content: '<p>We process customer bookings on your behalf.</p>',
  required: 1,
}

const seed = (...docs) => {
  bench.legal = docs.map((d) => ({ ...d }))
}

describe('reading before agreeing', () => {
  it('puts the document on the page, not behind a link', async () => {
    seed(TERMS)
    renderApp({ route: '/legal', signedIn: true })

    expect(await screen.findByText(/keep your menu prices current/i)).toBeInTheDocument()
  })

  it('names the version being accepted', async () => {
    /* "They accepted" is a much weaker record than "they accepted v2.1". */
    seed(TERMS)
    renderApp({ route: '/legal', signedIn: true })

    expect(await screen.findByText(/Version 2\.1 · In effect from 1 August 2026/)).toBeInTheDocument()
    /* And on the control itself, so what is being agreed to is stated at the
       point of agreeing rather than in a heading above it. */
    expect(
      screen.getByLabelText(/accept the partner terms of service \(version 2\.1\)/i),
    ).toBeInTheDocument()
  })

  it('will not offer a tickbox over a document it could not load', async () => {
    /* THE ONE THAT MATTERS MOST ON THIS SCREEN. Consent to an unread document
       is not consent. A partner cannot tell "this document is empty" from
       "this document failed to arrive" — we can, so it is ours to say. */
    seed({ ...TERMS, content: '' })
    renderApp({ route: '/legal', signedIn: true })

    expect(await screen.findByText(/can’t show you this document right now/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
  })

  it('keeps Accept out of reach until the box is ticked', async () => {
    seed(TERMS)
    renderApp({ route: '/legal', signedIn: true })

    expect(await screen.findByRole('button', { name: /^accept$/i })).toBeDisabled()
  })

  it('treats two documents as two agreements', async () => {
    /* One tick covering both collects a click, not two decisions. */
    seed(TERMS, PRIVACY)
    renderApp({ route: '/legal', signedIn: true })

    await screen.findByText(TERMS.title)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^accept$/i })).toHaveLength(2)
  })
})

describe('recording an acceptance', () => {
  it('records it, and says so with the date', async () => {
    seed(TERMS)
    const { user } = renderApp({ route: '/legal', signedIn: true })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^accept$/i }))

    expect(await screen.findByText(/you accepted this \(version 2\.1\)/i)).toBeInTheDocument()
    expect(screen.getByText(/7 august 2026/i)).toBeInTheDocument()
  })

  it('sends the version along with the acceptance', async () => {
    seed(TERMS)
    const { user } = renderApp({ route: '/legal', signedIn: true })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^accept$/i }))
    await screen.findByText(/you accepted this/i)

    const write = bench.calls.find((c) => c.method === 'accept_legal_document')
    expect(write.args.version).toBe('2.1')
    expect(bench.legal[0].accepted_version).toBe('2.1')
  })

  it('does NOT claim success when the server wrote nothing', async () => {
    /* THE ASSERTION THIS WHOLE SUITE IS BUILT AROUND. Frappe drops undeclared
       kwargs silently at 200 — six shipped bugs on this project have that
       shape. On a price it costs a retype. Here it would put a fabricated
       agreement on file. The read-back in services/legal.js is what catches
       it, and this is what proves the read-back is wired. */
    seed(TERMS)
    bench.legalAcceptSilentlyFails = true
    const { user } = renderApp({ route: '/legal', signedIn: true })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^accept$/i }))

    expect(await screen.findByText(/couldn’t record that/i)).toBeInTheDocument()
    expect(screen.getByText(/didn’t save/i)).toBeInTheDocument()
    expect(screen.queryByText(/you accepted this/i)).not.toBeInTheDocument()
  })

  it('says nothing was saved when accepting isn’t deployed', async () => {
    seed(TERMS)
    bench.deploy.accept_legal_document = false
    const { user } = renderApp({ route: '/legal', signedIn: true })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^accept$/i }))

    expect(await screen.findByText(/couldn’t record that/i)).toBeInTheDocument()
    expect(screen.getByText(/haven’t saved anything/i)).toBeInTheDocument()
    /* And it does not read as a dead end — they can still run their business. */
    expect(screen.getByText(/carry on with your venues/i)).toBeInTheDocument()
  })

  it('keeps accepted documents readable afterwards', async () => {
    /* A partner is entitled to re-read what they signed without asking us for
       a copy. Hiding it once accepted is how that request lands in a mailbox. */
    seed({ ...TERMS, accepted: 1, accepted_on: '2026-08-07 10:15:00' })
    renderApp({ route: '/legal', signedIn: true })

    expect(await screen.findByText(/keep your menu prices current/i)).toBeInTheDocument()
    expect(screen.getByText(/you’re up to date/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('the banner', () => {
  it('appears wherever the partner is working', async () => {
    seed(TERMS)
    renderApp({ route: '/', signedIn: true })

    const banner = await screen.findByRole('status')
    expect(within(banner).getByText(/one document needs your agreement/i)).toBeInTheDocument()
    expect(within(banner).getByRole('link', { name: /read and accept/i })).toBeInTheDocument()
  })

  it('counts them when there is more than one', async () => {
    seed(TERMS, PRIVACY)
    renderApp({ route: '/', signedIn: true })

    expect(await screen.findByText(/2 documents need your agreement/i)).toBeInTheDocument()
  })

  it('says what it will and will not stop them doing', async () => {
    /* A rule you only discover at the moment it blocks you is indistinguishable
       from a bug. This is the warning that makes the gate fair. */
    seed(TERMS)
    renderApp({ route: '/', signedIn: true })

    const banner = await screen.findByRole('status')
    expect(within(banner).getByText(/carry on as normal/i)).toBeInTheDocument()
    expect(within(banner).getByText(/can’t go to our reviewers/i)).toBeInTheDocument()
  })

  it('stays out of the way when there is nothing outstanding', async () => {
    seed({ ...TERMS, accepted: 1 })
    renderApp({ route: '/', signedIn: true })

    await screen.findByRole('heading', { name: /welcome back, thabo/i })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is silent on a bench that has no legal documents at all', async () => {
    /* The whole apparatus must be invisible until there is something to
       accept — otherwise every partner gets a banner about nothing. */
    renderApp({ route: '/', signedIn: true })

    await screen.findByRole('heading', { name: /welcome back, thabo/i })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not point at the page you are already on', async () => {
    seed(TERMS)
    renderApp({ route: '/legal', signedIn: true })

    await screen.findByText(TERMS.title)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('what the portal refuses to enforce', () => {
  it('never blocks when it cannot read the documents', async () => {
    /* A gate nobody can pass is an outage with a legal justification written on
       it. If the list endpoint is absent we cannot show a partner what they are
       agreeing to OR record that they did — so we do not hold them to it. A
       venue reaching review unaccepted is something a human catches; a partner
       locked out of their own venues on a Friday night is not. */
    bench.deploy.get_legal_documents = false
    renderApp({ route: '/', signedIn: true })

    await screen.findByRole('heading', { name: /welcome back, thabo/i })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says so plainly on the legal screen rather than pretending all is well', async () => {
    bench.deploy.get_legal_documents = false
    renderApp({ route: '/legal', signedIn: true })

    expect(await screen.findByText(/can’t show these right now/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing about your venues is affected/i)).toBeInTheDocument()
    /* And still not our process. */
    expect(document.body.textContent).not.toMatch(/shotright\.api|endpoint|we’ve asked/i)
  })

  it('does not tell someone with nothing outstanding that they are up to date on an unreadable bench', async () => {
    /* "You're up to date" over a failed read is the same class of lie as an
       empty booking diary over a missing method. */
    bench.deploy.get_legal_documents = false
    renderApp({ route: '/legal', signedIn: true })

    await screen.findByText(/can’t show these right now/i)
    expect(screen.queryByText(/you’re up to date/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing for you to accept/i)).not.toBeInTheDocument()
  })
})

/* ============================================================================
   THE GATE, DRIVEN THROUGH THE WHOLE WIZARD.

   Placed here rather than in venue-add.test.jsx because what is being tested is
   the legal rule, not the wizard. The five steps are walked in full every time
   on purpose: the entire risk of gating at submit is that a partner reaches the
   end of a long form and loses it, so a test that shortcuts to the last step
   would be testing the version of this feature that cannot hurt anyone.
   ========================================================================= */

const next = (user) => user.click(screen.getByRole('button', { name: /^next$/i }))

const chooseFirst = async (user, name) => {
  const select = screen.getByRole('combobox', { name })
  const option = [...select.options].find((o) => o.value)
  if (option) await user.selectOptions(select, option.value)
}

async function walkToReview(user, name = 'Nomsa’s Shisanyama') {
  await user.type(await screen.findByRole('textbox', { name: /^mood$/i }), 'Chilled')
  await user.click(screen.getByRole('button', { name: /add \+|^add$/i }))
  await next(user)

  await user.type(await screen.findByRole('textbox', { name: /venue name/i }), name)
  await user.type(screen.getByRole('textbox', { name: /manager name/i }), 'Nomsa')
  await user.type(screen.getByRole('textbox', { name: /manager surname/i }), 'Dlamini')
  await user.type(screen.getByRole('textbox', { name: /contact number/i }), '+27 82 111 2222')
  await user.type(screen.getByRole('combobox', { name: /^address/i }), '4th Ave, Mamelodi')
  await chooseFirst(user, /dress code/i)
  await chooseFirst(user, /atmosphere/i)
  /* Coordinates are set by picking an address now — the numeric fields are
     gone, because a partner reads a street name rather than a decimal. */
  await user.click(await screen.findByRole('button', { name: /Gauteng, South Africa/i }))
  await waitFor(() => {
    const node = document.querySelector('[data-field="latitude"]')
    expect(node?.getAttribute('data-latitude')).toBeTruthy()
  })

  await next(user) // hours
  await next(user) // menu
  await next(user) // review
  return name
}

describe('submitting a venue with something outstanding', () => {
  it('warns on the review step, before Submit is pressed', async () => {
    /* Being bounced off a finished form is a bad surprise however carefully the
       work is kept. Someone who is told first can accept and submit once. */
    seed(TERMS)
    const { user } = renderApp({ route: '/venues/new', signedIn: true })
    await walkToReview(user)

    expect(await screen.findByText(/one thing before you submit/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /read it now/i })).toBeInTheDocument()
  })

  it('does not create the venue, and does not lose the five steps', async () => {
    /* THE WHOLE RISK OF GATING HERE, in one test. */
    seed(TERMS)
    const { user } = renderApp({ route: '/venues/new', signedIn: true })
    const name = await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(await screen.findByText(/standing between your venue and our reviewers/i)).toBeInTheDocument()
    expect(bench.venues.some((v) => v.venue_name === name)).toBe(false)

    /* Saved server-side before the redirect, so it survives the tab closing —
       not merely held in a component that is about to unmount. */
    await waitFor(() => expect(bench.drafts.length).toBeGreaterThan(0))
    const draft = bench.drafts.at(-1)
    expect(draft.venue_name).toBe(name)
  })

  it('tells them their work is kept, in the same breath as the rule', async () => {
    seed(TERMS)
    const { user } = renderApp({ route: '/venues/new', signedIn: true })
    await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(await screen.findByText(/everything you filled in has been kept/i)).toBeInTheDocument()
    expect(screen.getByText(/won’t have to do any of it again/i)).toBeInTheDocument()
  })

  it('lets the venue through once the document is accepted', async () => {
    seed({ ...TERMS, accepted: 1, accepted_on: '2026-08-07 10:15:00' })
    const { user } = renderApp({ route: '/venues/new', signedIn: true })
    const name = await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(bench.venues.some((v) => v.venue_name === name)).toBe(true))
  })

  it('lets the venue through when the bench cannot answer at all', async () => {
    /* Deliberate, and the most important line in useLegalStanding. We will not
       stop a partner submitting on the strength of a question we could not ask.
       An unaccepted venue in the review queue is caught by a human; a partner
       who cannot submit because an endpoint is absent is not caught by anyone. */
    bench.deploy.get_legal_documents = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })
    const name = await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(bench.venues.some((v) => v.venue_name === name)).toBe(true))
  })
})
