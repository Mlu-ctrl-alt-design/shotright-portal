import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { proStatus } from '../services/plan'
import { paymentPolling } from '../components/layout/PaymentReturnBanner'

/**
 * "PRO" beside the logo for a partner on a live Pro plan. Read off the
 * subscription itself, never off the fail-open entitlements: a badge that
 * appeared because a request failed would tell someone they have paid.
 */

const withSubscription = (subscription) => {
  bench.entitlements = { ...bench.entitlements, subscription }
}

describe('who is badged', () => {
  it.each([
    [{ plan: 'Pro', status: 'Active' }, 'active'],
    [{ plan: 'Pro', status: 'Past Due' }, 'active'],
    [{ plan: 'Pro', status: 'Trialing' }, 'trial'],
    [{ plan: 'Pro', status: 'Cancelled' }, null],
    [{ plan: 'Pro', status: 'Expired' }, null],
    [{ plan: 'Free', status: 'Active' }, null],
    [null, null],
    [undefined, null],
  ])('%j -> %s', (sub, expected) => {
    expect(proStatus(sub)).toBe(expected)
  })
})

describe('the badge', () => {
  it('shows PRO for an active Pro partner', async () => {
    withSubscription({ plan: 'Pro', status: 'Active' })
    renderApp({ route: '/', signedIn: true })

    expect((await screen.findAllByText('PRO')).length).toBeGreaterThan(0)
  })

  it('says PRO TRIAL on a trial', async () => {
    withSubscription({ plan: 'Pro', status: 'Trialing' })
    renderApp({ route: '/', signedIn: true })

    expect((await screen.findAllByText('PRO TRIAL')).length).toBeGreaterThan(0)
    expect(screen.queryByText('PRO')).not.toBeInTheDocument()
  })

  it('shows nothing without a live Pro subscription, grandfathered or not', async () => {
    withSubscription(null)
    bench.entitlements = { ...bench.entitlements, grandfathered: true }
    renderApp({ route: '/', signedIn: true })

    await screen.findByText(/your venues/i)
    expect(screen.queryByText(/^PRO/)).not.toBeInTheDocument()
  })

  it('shows nothing when the bench cannot be asked', async () => {
    bench.deploy.get_entitlements = false
    renderApp({ route: '/', signedIn: true })

    await screen.findByText(/your venues/i)
    expect(screen.queryByText(/^PRO/)).not.toBeInTheDocument()
  })
})

describe('after paying', () => {
  const saved = { ...paymentPolling }
  beforeEach(() => {
    paymentPolling.intervalMs = 20
    paymentPolling.tries = 5
  })
  afterEach(() => Object.assign(paymentPolling, saved))

  it('appears once the payment confirms, without a reload', async () => {
    withSubscription(null)
    renderApp({ route: '/?payment=success&attempt=VPA-0000000950', signedIn: true })
    await screen.findByText(/switching on pro/i)
    expect(screen.queryByText('PRO')).not.toBeInTheDocument()

    withSubscription({ plan: 'Pro', status: 'Active' })

    expect(await screen.findByText(/pro is on/i)).toBeInTheDocument()
    expect((await screen.findAllByText('PRO')).length).toBeGreaterThan(0)
  })
})
