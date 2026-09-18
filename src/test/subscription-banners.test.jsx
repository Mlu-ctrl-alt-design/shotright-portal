import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * THE BANNERS THAT ARE NOT SALES PITCHES.
 *
 * These are for partners who are already paying. A failed card is the one
 * window where a quiet prompt saves a subscription, and a cancelled plan ending
 * on Thursday is something to be told before Thursday rather than discovered.
 *
 * They follow `LegalBanner`, not the upgrade prompt: shell-level so they are
 * seen, never dismissible, and hidden on the page they point at. The upgrade
 * pitch is deliberately NOT shell-level — six places is enough for an offer,
 * and the same offer on every screen is how a banner becomes wallpaper. A
 * failing payment is not an offer.
 */

const subscribed = (subscription, extra = {}) => {
  bench.entitlements = {
    ...bench.entitlements,
    grandfathered: false,
    paywall_active: true,
    upgrade_available: true,
    subscription,
    management_url: 'https://pay.rev.cat/manage/abc',
    ...extra,
  }
}

const PRO_ACTIVE = {
  plan: 'Pro',
  status: 'Active',
  period_end: '2026-10-18 00:00:00',
  cancel_at_period_end: false,
  payment_failed: false,
}

describe('a payment that failed', () => {
  it('asks for a new card without taking anything away', async () => {
    subscribed({ ...PRO_ACTIVE, status: 'Past Due', payment_failed: true })
    renderApp({ route: '/', signedIn: true })

    const banner = await screen.findByRole('status', { name: /payment/i })
    // Says plainly that nothing is locked — the backend keeps access on
    // purpose while the store retries, and a banner implying otherwise would
    // panic someone whose venue is working fine.
    expect(banner).toHaveTextContent(/nothing is locked|still.*working|keep/i)
    expect(screen.getByRole('link', { name: /update.*card|manage/i })).toHaveAttribute(
      'href',
      'https://pay.rev.cat/manage/abc',
    )
  })

  it('offers no dead link when we have no manage URL yet', async () => {
    /* `management_url` is null until a sync has run. An empty href is a button
       that silently reloads the page — worse than no button. */
    subscribed({ ...PRO_ACTIVE, status: 'Past Due', payment_failed: true }, {
      management_url: null,
    })
    renderApp({ route: '/', signedIn: true })

    await screen.findByRole('status', { name: /payment/i })
    expect(screen.queryByRole('link', { name: /update.*card|manage/i })).not.toBeInTheDocument()
  })
})

describe('a plan that is ending', () => {
  it('says when, so nobody is surprised on the day', async () => {
    subscribed({ ...PRO_ACTIVE, cancel_at_period_end: true, period_end: '2026-10-15 00:00:00' })
    renderApp({ route: '/', signedIn: true })

    const banner = await screen.findByRole('status', { name: /plan ending/i })
    expect(banner).toHaveTextContent(/15 October 2026/)
    // Factual, not a win-back nag: they cancelled on purpose.
    expect(banner).toHaveTextContent(/until then|keep everything/i)
  })

  it('warns near the end of a trial, not at the start of one', async () => {
    // A full timestamp, not a date truncated to midnight: that loses up to a
    // day and makes the assertion depend on what time the suite runs.
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    subscribed({ ...PRO_ACTIVE, status: 'Trialing', period_end: soon })
    renderApp({ route: '/', signedIn: true })

    expect(await screen.findByRole('status', { name: /trial/i })).toHaveTextContent(/2 days/)
  })

  it('says nothing while a trial still has weeks to run', async () => {
    const later = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    subscribed({ ...PRO_ACTIVE, status: 'Trialing', period_end: later })
    renderApp({ route: '/', signedIn: true })

    // The dashboard renders; no banner nags someone still evaluating.
    await screen.findByRole('navigation', { name: /main/i })
    expect(screen.queryByRole('status', { name: /trial/i })).not.toBeInTheDocument()
  })

  it('stays quiet on the page it would point at', async () => {
    subscribed({ ...PRO_ACTIVE, status: 'Past Due', payment_failed: true })
    renderApp({ route: '/plans', signedIn: true })

    await screen.findByRole('heading', { name: /^pro$/i })
    expect(screen.queryByRole('status', { name: /payment/i })).not.toBeInTheDocument()
  })
})
