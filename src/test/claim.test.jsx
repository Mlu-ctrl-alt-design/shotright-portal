import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Claiming a catalogue venue: the portal's search at /claim, and /claim/<token>,
 * the page the customer app opens and the one place a claim is finished.
 *
 * Every assertion that matters is on `bench.claims` / `bench.calls` — what the
 * bench was told — not on what the screen says it did.
 */

const COCO = { venue: 'VEN-00101', venue_name: 'Coco Melon', town: 'Soweto', province: 'Gauteng', owned: false }
const TAKEN = { venue: 'VEN-00102', venue_name: 'Coco Taken', town: 'Braamfontein', province: 'Gauteng', owned: true }

/** A claim the customer app already opened, as the bench would hold it. */
const openedFromApp = (over = {}) => {
  const claim = { name: 'VC-1', venue: COCO.venue, status: 'Started', token: 'tok-from-app', files: [], ...over }
  bench.claims.push(claim)
  return claim
}

const methodCalls = (name) => bench.calls.filter((c) => c.method === name)

describe('claim a venue — the portal search', () => {
  it('is in the nav, finds a catalogue venue and opens a claim on it', async () => {
    bench.catalogue.push(COCO, TAKEN)
    const { user } = renderApp({ route: '/', signedIn: true })

    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    await user.click(within(nav).getByRole('link', { name: /claim a venue/i }))

    await user.type(await screen.findByRole('searchbox', { name: /venue name/i }), 'coco')
    const results = await screen.findByRole('list', { name: /matching venues/i })
    expect(within(results).getAllByRole('listitem')).toHaveLength(2)
    // An owned venue is labelled BEFORE the tap, never with its owner's name.
    expect(within(results).getByText(/someone has already listed this venue/i)).toBeInTheDocument()

    await user.click(within(results).getByRole('button', { name: 'Claim Coco Melon' }))

    expect(await screen.findByRole('heading', { name: 'Coco Melon' })).toBeInTheDocument()
    expect(methodCalls('start_venue_claim')).toEqual([{ method: 'start_venue_claim', args: { venue_name: COCO.venue } }])
    // Inside the portal, not the sign-in chrome.
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0)
  })

  it('does not search on one character', async () => {
    bench.catalogue.push(COCO)
    const { user } = renderApp({ route: '/claim', signedIn: true })

    await user.type(await screen.findByRole('searchbox', { name: /venue name/i }), 'c')

    expect(await screen.findByText(/type at least 2 characters/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 400))
    expect(methodCalls('search_claimable_venues')).toHaveLength(0)
  })

  it('offers Add New when nothing in the catalogue matches', async () => {
    bench.catalogue.push(COCO)
    const { user } = renderApp({ route: '/claim', signedIn: true })

    await user.type(await screen.findByRole('searchbox', { name: /venue name/i }), 'zzz')

    expect(await screen.findByText(/no catalogue venue matches/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add a new venue/i })).toBeInTheDocument()
  })

  it('says so when the claim is already filed, instead of opening a second', async () => {
    bench.catalogue.push(COCO)
    openedFromApp({ status: 'Submitted', token: null })
    const { user } = renderApp({ route: '/claim', signedIn: true })

    // Listed under Your claims, in words a partner uses.
    expect(await screen.findByText(/under review/i)).toBeInTheDocument()

    await user.type(await screen.findByRole('searchbox', { name: /venue name/i }), 'coco')
    await user.click(await screen.findByRole('button', { name: 'Claim Coco Melon' }))

    expect(await screen.findByText(/already with us/i)).toBeInTheDocument()
    expect(bench.claims).toHaveLength(1)
  })
})

describe('claim a venue — finishing it at /claim/<token>', () => {
  it('files the claim with role, note, a document and the emailed code', async () => {
    bench.catalogue.push(COCO)
    const claim = openedFromApp()
    const { user } = renderApp({ route: '/claim/tok-from-app', signedIn: true })

    expect(await screen.findByRole('heading', { name: 'Coco Melon' })).toBeInTheDocument()

    // A role is required, and asking for one sends nothing.
    await user.click(screen.getByRole('button', { name: /send code/i }))
    expect(await screen.findByText(/how you.re connected/i)).toBeInTheDocument()
    expect(methodCalls('send_otp')).toHaveLength(0)

    await user.selectOptions(screen.getByRole('combobox', { name: /your role/i }), 'Owner')
    await user.type(screen.getByRole('textbox', { name: /anything we should know/i }), 'Bought it in 2024')

    const licence = new File(['%PDF-1.4'], 'liquor-licence.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText(/add a document/i, { selector: 'input' }), licence)
    const docs = await screen.findByRole('list', { name: /documents sent/i })
    expect(within(docs).getAllByRole('listitem')).toHaveLength(1)
    expect(methodCalls('upload_venue_claim_evidence')[0].args).toMatchObject({
      handle: 'tok-from-app',
      type: 'application/pdf',
    })
    expect(claim.files).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /send code/i }))
    await user.type(await screen.findByRole('textbox', { name: /^code$/i }), '123456')
    await user.click(screen.getByRole('button', { name: /submit claim/i }))

    expect(await screen.findByText(/claim sent/i)).toBeInTheDocument()
    expect(methodCalls('send_otp')[0].args).toEqual({ email: 'thabo@cornerkitchen.co.za', purpose: 'Venue Claim' })
    // The code is consumed by file_venue_claim itself. A verify_otp first
    // would spend it and the filing would then fail.
    expect(methodCalls('verify_otp')).toHaveLength(0)
    expect(claim).toMatchObject({ status: 'Submitted', token: null, claimant_role: 'Owner', note: 'Bought it in 2024' })
    // Evidence stays reachable after filing, by the claim's docname.
    const after = await screen.findByRole('list', { name: /documents sent/i })
    expect(within(after).getAllByRole('listitem')).toHaveLength(1)
    expect(methodCalls('get_venue_claim_evidence').at(-1).args).toEqual({ handle: 'VC-1' })
  })

  it('keeps the claim open on a wrong code', async () => {
    bench.catalogue.push(COCO)
    const claim = openedFromApp()
    const { user } = renderApp({ route: '/claim/tok-from-app', signedIn: true })

    await user.selectOptions(await screen.findByRole('combobox', { name: /your role/i }), 'Manager')
    await user.click(screen.getByRole('button', { name: /send code/i }))
    await user.type(await screen.findByRole('textbox', { name: /^code$/i }), '000000')
    await user.click(screen.getByRole('button', { name: /submit claim/i }))

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(claim.status).toBe('Started')
    expect(screen.getByRole('textbox', { name: /^code$/i })).toHaveValue('')
  })

  it('shows the bench refusing a file type, and removes a document', async () => {
    bench.catalogue.push(COCO)
    const claim = openedFromApp({ files: [{ file: 'FILE-C1', file_name: 'id.jpg', file_size: 10 }] })
    const { user } = renderApp({ route: '/claim/tok-from-app', signedIn: true })

    await user.click(await screen.findByRole('button', { name: 'Remove id.jpg' }))
    await waitFor(() => expect(claim.files).toHaveLength(0))

    // `accept` is only a hint to the picker — "All files" is one tap away — so
    // the bench's refusal is what a partner actually meets.
    const sheet = new File(['a,b'], 'accounts.csv', { type: 'text/csv' })
    const anyFile = userEvent.setup({ applyAccept: false })
    await anyFile.upload(screen.getByLabelText(/add a document/i, { selector: 'input' }), sheet)
    expect(await screen.findByText(/is neither/i)).toBeInTheDocument()
    expect(claim.files).toHaveLength(0)
  })

  it('explains a dead link instead of a blank page', async () => {
    renderApp({ route: '/claim/not-a-real-token', signedIn: true })

    expect(await screen.findByRole('heading', { name: /can.t be used/i })).toBeInTheDocument()
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /find your venue/i })).toHaveAttribute('href', '/claim')
  })
})

describe('claim a venue — arriving from the app without a partner account', () => {
  it('shows a guest the venue, and brings them back to it after signing in', async () => {
    bench.catalogue.push(COCO)
    openedFromApp()
    const { user } = renderApp({ route: '/claim/tok-from-app' })

    expect(await screen.findByRole('heading', { name: 'Coco Melon' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /your role/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /i already have one/i }))
    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('combobox', { name: /your role/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Coco Melon' })).toBeInTheDocument()
  })

  it('brings a new partner back after register and email verification', async () => {
    bench.catalogue.push(COCO)
    bench.otpRequired = true
    openedFromApp()
    const { user } = renderApp({ route: '/claim/tok-from-app' })

    await user.click(await screen.findByRole('link', { name: /create a partner account/i }))
    await user.type(await screen.findByLabelText(/^name$/i), 'Nomsa')
    await user.type(screen.getByLabelText(/^surname$/i), 'Dlamini')
    await user.type(screen.getByLabelText(/business name/i), 'Coco Melon (Pty) Ltd')
    await user.type(screen.getByLabelText(/^email$/i), 'nomsa@cocomelon.co.za')
    await user.type(screen.getByLabelText(/^password$/i), 'a-good-password')
    const confirm = screen.queryByLabelText(/confirm password/i)
    if (confirm) await user.type(confirm, 'a-good-password')
    await user.click(screen.getByRole('button', { name: /^register$/i }))
    await user.type(await screen.findByLabelText(/verification code/i), '123456')

    expect(await screen.findByRole('combobox', { name: /your role/i })).toBeInTheDocument()
    // The code goes to the address they just proved, not the app account.
    expect(screen.getByText('nomsa@cocomelon.co.za')).toBeInTheDocument()
  })
})
