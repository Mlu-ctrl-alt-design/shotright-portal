import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { paymentPolling } from '../components/layout/PaymentReturnBanner'

/**
 * Promote a venue: pay once, by Payfast, to sit at the top of nearby searches
 * (shotright PR #61). Money is involved, so the tests pin what the partner is
 * told they are buying and exactly what goes to the bench.
 */

const PROMOTE = '/venues/VEN-00001/promote'

let submitted
beforeEach(() => {
  submitted = []
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function () {
    submitted.push(this)
  })
})

const deploy = () => {
  bench.deploy.get_promotion_offer = true
  bench.deploy.start_promotion = true
  bench.deploy.get_venue_promotions = true
}

describe('the Promote tab', () => {
  it('is a tab on every venue', async () => {
    renderApp({ route: '/venues/VEN-00001', signedIn: true })
    expect(await screen.findByRole('link', { name: /^promote$/i })).toBeInTheDocument()
  })

  it('on a bench without promotions, says so instead of offering a button', async () => {
    renderApp({ route: PROMOTE, signedIn: true })

    expect(await screen.findByText(/promotions aren’t switched on yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })

  it('says what is being bought, and prices the weeks chosen', async () => {
    deploy()
    const { user } = renderApp({ route: PROMOTE, signedIn: true })

    expect(await screen.findByText(/marked/i)).toHaveTextContent(/sponsored/i)
    expect(screen.getByRole('button', { name: /pay r\s?199 with payfast/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /3 weeks/i }))

    expect(screen.getByRole('button', { name: /pay r\s?597 with payfast/i })).toBeInTheDocument()
  })

  it('sends weeks, start and moods to the bench, then submits its Payfast form as received', async () => {
    deploy()
    const { user } = renderApp({ route: PROMOTE, signedIn: true })

    await user.click(await screen.findByRole('radio', { name: /2 weeks/i }))
    await user.click(screen.getByLabelText('Romantic'))
    await user.click(screen.getByRole('button', { name: /pay r\s?398 with payfast/i }))

    await waitFor(() => expect(submitted).toHaveLength(1))
    const call = bench.calls.find((c) => c.method === 'start_promotion')
    expect(call.args).toMatchObject({ venue_name: 'VEN-00001', weeks: 2 })
    // Left untouched, the start is the bench's call (today), not the browser's.
    expect(call.args).not.toHaveProperty('starts_on')
    expect(JSON.parse(call.args.moods)).toEqual(['Romantic'])

    const form = submitted[0]
    expect(form.action).toBe('https://sandbox.payfast.co.za/eng/process')
    expect(form.querySelector('input[name="amount"]').value).toBe('398.00')
  })

  it('explains why a venue cannot be promoted, with no way to pay', async () => {
    deploy()
    bench.promotionOffer = { ...bench.promotionOffer, can_promote: false, reason: 'rating_too_low' }
    renderApp({ route: PROMOTE, signedIn: true })

    expect(await screen.findByText(/guest ratings for this venue are too low/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })

  it("puts the bench's refusal on screen and does not go to Payfast", async () => {
    deploy()
    bench.promotionRefusal = 'Test Venue is already promoted from 2026-09-26 to 2026-10-02.'
    const { user } = renderApp({ route: PROMOTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /pay .* with payfast/i }))

    expect(await screen.findByText(/already promoted/i)).toBeInTheDocument()
    expect(submitted).toHaveLength(0)
  })

  it('lists paid promotions with what they brought in', async () => {
    deploy()
    bench.promotions = [
      {
        venue: 'VEN-00001', name: 'VP-00007', starts_on: '2026-09-21', ends_on: '2026-09-27', weeks: 1,
        price_zar: 199, moods: [], live: true, upcoming: false, bookings: 3,
      },
    ]
    renderApp({ route: PROMOTE, signedIn: true })

    const card = (await screen.findByText(/your promotions/i)).closest('section')
    expect(within(card).getByText(/live now/i)).toBeInTheDocument()
    expect(within(card).getByText(/3 bookings/i)).toBeInTheDocument()
  })
})

describe('back from Payfast, following the exact payment', () => {
  const saved = { ...paymentPolling }
  beforeEach(() => {
    paymentPolling.intervalMs = 20
    paymentPolling.tries = 5
    bench.deploy.get_payment_status = true
  })
  afterEach(() => Object.assign(paymentPolling, saved))

  it('a paid promotion says so, and links to it — not "Pro is on"', async () => {
    bench.payments['VPA-0000000900'] = { purpose: 'Promotion', status: 'Pending', venue: 'VEN-00001' }
    renderApp({ route: '/?payment=success&attempt=VPA-0000000900', signedIn: true })

    expect(await screen.findByText(/confirming your promotion/i)).toBeInTheDocument()
    bench.payments['VPA-0000000900'].status = 'Complete'

    expect(await screen.findByText(/your promotion is paid/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /see your promotions/i })).toHaveAttribute(
      'href',
      '/venues/VEN-00001/promote',
    )
    expect(screen.queryByText(/pro is on/i)).not.toBeInTheDocument()
  })

  it('a plan payment still says Pro is on', async () => {
    bench.payments['VPA-0000000901'] = { purpose: 'Subscription', status: 'Complete', plan: 'Pro' }
    renderApp({ route: '/?payment=success&attempt=VPA-0000000901', signedIn: true })

    expect(await screen.findByText(/pro is on\. thank you/i)).toBeInTheDocument()
  })

  it('a failed payment says nothing was charged', async () => {
    bench.payments['VPA-0000000902'] = { purpose: 'Promotion', status: 'Failed', venue: 'VEN-00001' }
    renderApp({ route: '/?payment=success&attempt=VPA-0000000902', signedIn: true })

    expect(await screen.findByText(/payment didn’t go through/i)).toBeInTheDocument()
  })

  it('waiting on a promotion that never confirms says the promotion, not Pro', async () => {
    bench.payments['VPA-0000000903'] = { purpose: 'Promotion', status: 'Pending', venue: 'VEN-00001' }
    renderApp({ route: '/?payment=success&attempt=VPA-0000000903', signedIn: true })

    expect(await screen.findByText(/your promotion isn’t confirmed yet/i)).toBeInTheDocument()
    expect(screen.getByText('VPA-0000000903')).toBeInTheDocument()
  })
})
