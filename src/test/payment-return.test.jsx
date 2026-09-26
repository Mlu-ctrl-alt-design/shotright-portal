import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { paymentPolling } from '../components/layout/PaymentReturnBanner'

/**
 * Coming back from Payfast.
 *
 * The bench sends Payfast `?payment=success|cancelled&attempt=VPA-…` as the
 * return and cancel URLs. Payfast then tells the BENCH that money moved (the
 * ITN) a few seconds after it sends the browser back — so on arrival the
 * subscription is usually not Active yet, and the portal has to wait for it
 * rather than announce Pro it cannot see.
 */

const saved = { ...paymentPolling }
beforeEach(() => {
  paymentPolling.intervalMs = 20
  paymentPolling.tries = 5
})
afterEach(() => Object.assign(paymentPolling, saved))

const entitlementCalls = () => bench.calls.filter((c) => c.method === 'get_entitlements').length

describe('back from Payfast', () => {
  it('says the payment is being confirmed, then that Pro is on once the ITN lands', async () => {
    bench.entitlements = { ...bench.entitlements, subscription: null }
    renderApp({ route: '/?payment=success&attempt=VPA-0000000500', signedIn: true })

    expect(await screen.findByText(/payment received — switching on pro/i)).toBeInTheDocument()

    // Payfast's notification reaches the bench a moment later.
    bench.entitlements = { ...bench.entitlements, subscription: { plan: 'Pro', status: 'Active' } }

    expect(await screen.findByText(/pro is on\. thank you/i)).toBeInTheDocument()
    expect(screen.queryByText(/switching on pro/i)).not.toBeInTheDocument()
  })

  it('does not announce Pro for a subscription that is only Trialing', async () => {
    bench.entitlements = { ...bench.entitlements, subscription: { plan: 'Pro', status: 'Trialing' } }
    renderApp({ route: '/?payment=success&attempt=VPA-1', signedIn: true })

    await screen.findByText(/switching on pro/i)
    await waitFor(() => expect(entitlementCalls()).toBeGreaterThanOrEqual(3))
    expect(screen.queryByText(/pro is on/i)).not.toBeInTheDocument()
  })

  it('after a minute without the ITN, says the payment went through and quotes the reference', async () => {
    bench.entitlements = { ...bench.entitlements, subscription: null }
    renderApp({ route: '/?payment=success&attempt=VPA-0000000501', signedIn: true })

    expect(await screen.findByText(/payment went through, but pro isn’t on yet/i)).toBeInTheDocument()
    expect(screen.getByText('VPA-0000000501')).toBeInTheDocument()
    expect(entitlementCalls()).toBeGreaterThanOrEqual(paymentPolling.tries)
  })

  it('says a cancelled payment charged nothing, and does not poll', async () => {
    renderApp({ route: '/?payment=cancelled&attempt=VPA-2', signedIn: true })

    expect(await screen.findByText(/payment cancelled/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText(/switching on pro/i)).not.toBeInTheDocument()
  })

  it('removes the query string, so moving on does not replay the message', async () => {
    const { user } = renderApp({ route: '/?payment=cancelled&attempt=VPA-3', signedIn: true })
    await screen.findByText(/payment cancelled/i)

    // Dismiss, then leave and come back. If `?payment=` were still on the
    // entry we came from, the banner would come back with it.
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    await user.click(screen.getAllByRole('link', { name: /venues/i })[0])
    await user.click(screen.getAllByRole('link', { name: /dashboard/i })[0])
    await screen.findByText(/your venues/i)

    expect(screen.queryByText(/payment cancelled/i)).not.toBeInTheDocument()
  })

  it('shows nothing on an ordinary visit', async () => {
    renderApp({ route: '/', signedIn: true })

    await screen.findByText(/your venues/i)
    expect(screen.queryByText(/payment/i)).not.toBeInTheDocument()
  })

  it('still shows the message when the session lapsed while paying', async () => {
    bench.entitlements = { ...bench.entitlements, subscription: null }
    const { user } = renderApp({ route: '/?payment=cancelled&attempt=VPA-4', signedIn: false })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText(/payment cancelled/i)).toBeInTheDocument()
  })
})
