import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Both new halves of a venue claim:
 *
 *  - the OWNER's side — somebody has claimed one of this partner's venues, and
 *    they answer it in words and documents at /claims-on-your-venues
 *  - the CLAIMANT withdrawing their own open claim from "Your claims"
 *
 * Assertions are on what reached the fake bench (`bench.claimsOnMine`,
 * `bench.claims`, `bench.calls`), not only on what the screen says.
 */

const methodCalls = (name) => bench.calls.filter((c) => c.method === name)

/** A filed claim on one of the partner's venues, as the bench sends it to the OWNER. */
const claimOnMine = (over = {}) => {
  const row = {
    claim: 'VCL-00012',
    venue: 'VEN-00101',
    venue_name: 'Coco Melon',
    status: 'Submitted',
    filed_at: '2026-09-30 10:12:00',
    claimant_role: 'Manager',
    decided_at: null,
    venue_is_yours: true,
    can_respond: true,
    responded: false,
    response: '',
    responded_at: null,
    evidence: [],
    ...over,
  }
  bench.claimsOnMine.push(row)
  return row
}

const mainNav = async () => (await screen.findAllByRole('navigation', { name: 'Main' }))[0]

describe('claims on your venues — finding them', () => {
  it('shows no nav item to a partner nobody has claimed from', async () => {
    renderApp({ route: '/', signedIn: true })

    const nav = await mainNav()
    await within(nav).findByRole('link', { name: /messages/i })
    await waitFor(() => expect(methodCalls('get_claims_on_my_venues').length).toBeGreaterThan(0))
    expect(within(nav).queryByRole('link', { name: /claims on your venues/i })).not.toBeInTheDocument()
  })

  it('puts a notice on the dashboard and an item in the nav, both leading to the claim', async () => {
    claimOnMine()
    const { user } = renderApp({ route: '/', signedIn: true })

    const nav = await mainNav()
    expect(await within(nav).findByRole('link', { name: /claims on your venues, 1 open/i })).toBeInTheDocument()

    const notice = await screen.findByRole('link', { name: /someone has claimed coco melon/i })
    expect(notice).toHaveTextContent(/nothing changes while a reviewer looks at it/i)
    await user.click(notice)

    expect(await screen.findByRole('heading', { name: 'Claims on your venues' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /your response/i })).toBeInTheDocument()
  })

  it('reaches the page from the claim notice in Messages', async () => {
    bench.inbox.push({
      name: 'NL-9',
      subject: 'Someone has claimed Coco Melon',
      type: 'Alert',
      read: 0,
      creation: '2026-09-30 10:12:00',
      document_type: 'Venue Claim',
      email_content: '<p>Somebody has filed a claim on <strong>Coco Melon</strong>.</p><p><strong>Nothing has changed.</strong></p>',
    })
    claimOnMine()
    const { user } = renderApp({ route: '/messages', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /someone has claimed coco melon/i }))
    await user.click(await screen.findByRole('link', { name: /go to claims on your venues/i }))

    expect(await screen.findByRole('heading', { name: 'Claims on your venues' })).toBeInTheDocument()
  })

  it('a message about anything else carries no such link', async () => {
    bench.inbox.push({
      name: 'NL-1',
      subject: 'New booking at Coco Melon',
      type: 'Alert',
      read: 0,
      creation: '2026-09-30 10:12:00',
      email_content: '<p>Zuko booked a table.</p>',
    })
    const { user } = renderApp({ route: '/messages', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /new booking at coco melon/i }))
    expect(await screen.findByText('Zuko booked a table.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /go to claims on your venues/i })).not.toBeInTheDocument()
  })

  it('on a bench without the endpoint, nothing breaks and nothing is offered', async () => {
    bench.deploy.get_claims_on_my_venues = false
    renderApp({ route: '/claims-on-your-venues', signedIn: true })

    expect(await screen.findByText(/no claims on your venues/i)).toBeInTheDocument()
    const nav = await mainNav()
    expect(within(nav).queryByRole('link', { name: /claims on your venues/i })).not.toBeInTheDocument()
  })
})

describe('claims on your venues — answering one', () => {
  it('says nothing has changed, names the role but never the claimant', async () => {
    claimOnMine()
    renderApp({ route: '/claims-on-your-venues', signedIn: true })

    expect(await screen.findByText(/nothing has changed yet/i)).toBeInTheDocument()
    expect(screen.getByText(/guests can still find and book it/i)).toBeInTheDocument()
    expect(screen.getByText(/claiming to be the manager/i)).toBeInTheDocument()
    expect(screen.getByText(/we don.t share who made the claim/i)).toBeInTheDocument()
  })

  it('sends the written response to the bench, and lets it be updated', async () => {
    const row = claimOnMine()
    const { user } = renderApp({ route: '/claims-on-your-venues', signedIn: true })

    const box = await screen.findByRole('textbox', { name: /your response/i })
    const send = screen.getByRole('button', { name: /send response/i })
    expect(send).toBeDisabled()

    await user.type(box, 'We have run Coco Melon since 2019. The lease is in our name.')
    await user.click(send)

    expect(await screen.findByText(/your response has been sent to the reviewer/i)).toBeInTheDocument()
    expect(methodCalls('respond_to_venue_claim')).toEqual([
      {
        method: 'respond_to_venue_claim',
        args: { claim: 'VCL-00012', response: 'We have run Coco Melon since 2019. The lease is in our name.' },
      },
    ])
    expect(row).toMatchObject({ responded: true, response: 'We have run Coco Melon since 2019. The lease is in our name.' })

    await user.type(box, ' Licence attached.')
    await user.click(screen.getByRole('button', { name: /update response/i }))
    await waitFor(() => expect(row.response).toMatch(/Licence attached\.$/))
  })

  it('shows the bench refusing once the claim has been decided', async () => {
    const row = claimOnMine()
    const { user } = renderApp({ route: '/claims-on-your-venues', signedIn: true })

    await user.type(await screen.findByRole('textbox', { name: /your response/i }), 'It is ours.')
    row.status = 'Declined' // decided in the Desk while the page was open
    await user.click(screen.getByRole('button', { name: /send response/i }))

    expect(await screen.findByText(/can no longer be responded to/i)).toBeInTheDocument()
    expect(row.response).toBe('')
  })

  it('uploads and removes the owner’s own documents', async () => {
    const row = claimOnMine()
    const { user } = renderApp({ route: '/claims-on-your-venues', signedIn: true })

    const lease = new File(['%PDF-1.4'], 'lease.pdf', { type: 'application/pdf' })
    await user.upload(await screen.findByLabelText(/add a document for coco melon/i, { selector: 'input' }), lease)

    const docs = await screen.findByRole('list', { name: /your documents for coco melon/i })
    expect(within(docs).getAllByRole('listitem')).toHaveLength(1)
    expect(methodCalls('upload_venue_claim_response_evidence')[0].args).toMatchObject({
      claim: 'VCL-00012',
      type: 'application/pdf',
    })
    expect(row.evidence).toHaveLength(1)

    // jsdom's FormData drops the part's filename on the way through MSW (see
    // server.js), so the row is named "blob" here; a browser keeps "lease.pdf".
    await user.click(within(docs).getByRole('button', { name: /^remove /i }))
    await waitFor(() => expect(row.evidence).toHaveLength(0))
    expect(methodCalls('remove_venue_claim_response_evidence')[0].args).toEqual({ claim: 'VCL-00012', file: 'FILE-R1' })
  })

  it('shows the bench refusing a spreadsheet', async () => {
    const row = claimOnMine()
    const anyFile = userEvent.setup({ applyAccept: false })
    renderApp({ route: '/claims-on-your-venues', signedIn: true })

    const sheet = new File(['a,b'], 'accounts.csv', { type: 'text/csv' })
    await anyFile.upload(await screen.findByLabelText(/add a document for coco melon/i, { selector: 'input' }), sheet)

    expect(await screen.findByText(/is neither/i)).toBeInTheDocument()
    expect(row.evidence).toHaveLength(0)
  })

  it('lists a decided claim as history, with no form to answer it', async () => {
    claimOnMine({
      claim: 'VCL-00007',
      venue_name: 'Coco Taken',
      status: 'Granted',
      venue_is_yours: false,
      can_respond: false,
      decided_at: '2026-09-29 12:00:00',
    })
    renderApp({ route: '/claims-on-your-venues', signedIn: true })

    const decided = await screen.findByRole('list', { name: /decided claims/i })
    expect(within(decided).getByText('Coco Taken')).toBeInTheDocument()
    expect(within(decided).getByText(/moved to their account/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /your response/i })).not.toBeInTheDocument()
  })
})

describe('your claims — withdrawing one', () => {
  const COCO = { venue: 'VEN-00101', venue_name: 'Coco Melon', town: 'Soweto', province: 'Gauteng', owned: true }
  const filed = (over = {}) => {
    const claim = { name: 'VC-1', venue: COCO.venue, status: 'Submitted', token: null, files: [], ...over }
    bench.catalogue.push(COCO)
    bench.claims.push(claim)
    return claim
  }

  it('asks first, then withdraws the claim on the bench', async () => {
    const claim = filed()
    const { user } = renderApp({ route: '/claim', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /withdraw your claim on coco melon/i }))
    const confirm = screen.getByRole('group', { name: /withdraw your claim on coco melon\?/i })
    expect(within(confirm).getByText(/closes for good/i)).toBeInTheDocument()
    expect(methodCalls('withdraw_venue_claim')).toHaveLength(0)

    await user.click(within(confirm).getByRole('button', { name: /yes, withdraw it/i }))

    await waitFor(() => expect(claim.status).toBe('Withdrawn'))
    expect(methodCalls('withdraw_venue_claim')).toEqual([{ method: 'withdraw_venue_claim', args: { claim: 'VC-1' } }])
    const mine = await screen.findByRole('list', { name: /your claims/i })
    expect(await within(mine).findByText('Withdrawn')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw your claim/i })).not.toBeInTheDocument()
  })

  it('changes nothing when the partner keeps the claim', async () => {
    const claim = filed()
    const { user } = renderApp({ route: '/claim', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /withdraw your claim on coco melon/i }))
    await user.click(screen.getByRole('button', { name: /keep my claim/i }))

    expect(screen.queryByRole('group', { name: /withdraw your claim/i })).not.toBeInTheDocument()
    expect(methodCalls('withdraw_venue_claim')).toHaveLength(0)
    expect(claim.status).toBe('Submitted')
  })

  it('offers no withdraw on a claim that has been answered', async () => {
    filed({ status: 'Declined', decision_reason: 'We could not confirm ownership.' })
    renderApp({ route: '/claim', signedIn: true })

    expect(await screen.findByText(/could not confirm ownership/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw your claim/i })).not.toBeInTheDocument()
  })

  it('shows the bench refusing a claim decided while the page was open', async () => {
    const claim = filed()
    const { user } = renderApp({ route: '/claim', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /withdraw your claim on coco melon/i }))
    claim.status = 'Granted'
    await user.click(screen.getByRole('button', { name: /yes, withdraw it/i }))

    expect(await screen.findByText(/can no longer be withdrawn/i)).toBeInTheDocument()
    expect(claim.status).toBe('Granted')
  })
})
