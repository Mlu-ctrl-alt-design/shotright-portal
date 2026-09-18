import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * THE PRO PAYWALL, AS A PARTNER MEETS IT.
 *
 * The load-bearing tests in here are the ones where nothing is shown. Today
 * every live partner is `grandfathered` — they hold all six paid features and
 * cannot buy anything, because the site has no RevenueCat keys. A portal that
 * renders "You're on Free, upgrade to Pro" at them is telling a partner
 * something untrue about their own account, over a button that 417s.
 *
 * So the default state of `bench.entitlements` is the paywall OFF, matching the
 * live site, and every test that wants locks has to switch them on.
 */

/** A vendor on the paying side of the cutoff, with nothing bought. */
const onFreePlan = () => {
  bench.entitlements = {
    ...bench.entitlements,
    features: [],
    grandfathered: false,
    paywall_active: true,
    upgrade_available: true,
    subscription: null,
  }
}

describe('the plans page', () => {
  it('says what Pro costs and what it unlocks', async () => {
    onFreePlan()
    renderApp({ route: '/plans', signedIn: true })

    // Anchored: a loose /pro/i matches "Profile" in the nav, which would make
    // this pass against the dashboard the unknown route redirects to.
    expect(await screen.findByRole('heading', { name: /^pro$/i })).toBeInTheDocument()
    expect(screen.getByText(/149/)).toBeInTheDocument()
    // The words come from the server's catalogue, never a table in this repo.
    expect(screen.getByText(/Menu import/)).toBeInTheDocument()
  })
})

describe('a locked feature', () => {
  it('names the feature and offers the plans, instead of a form that will be refused', async () => {
    onFreePlan()
    renderApp({ route: '/venues/import', signedIn: true })

    // The server's words for this feature, not a table in this repo.
    expect(await screen.findByText(/Several venues at once/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /see plans/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/plans'),
    )
  })

  it('does not offer the file picker a partner cannot use', async () => {
    onFreePlan()
    renderApp({ route: '/venues/import', signedIn: true })

    await screen.findByText(/Several venues at once/i)
    expect(screen.queryByRole('button', { name: /choose a file|upload/i })).not.toBeInTheDocument()
  })
})

describe('the partners who are already here', () => {
  /**
   * The default `bench.entitlements` IS the live site: no cutoff, so everyone
   * is grandfathered and holds all six features, and no RevenueCat keys, so
   * nothing can be bought. Every test in here runs against that default on
   * purpose — it is the state every real partner is in today.
   */
  it('shows a grandfathered partner no lock and no pitch', async () => {
    renderApp({ route: '/venues/import', signedIn: true })

    // The working page, not a banner: the template button only exists there.
    expect(await screen.findByRole('button', { name: /download the template/i })).toBeInTheDocument()
    expect(screen.queryByText(/Several venues at once/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /see plans/i })).not.toBeInTheDocument()
  })

  it('does not pitch an upgrade nobody on this server can buy', async () => {
    // Paywall on, but RevenueCat unconfigured — the half-configured site.
    bench.entitlements = {
      ...bench.entitlements,
      features: [],
      grandfathered: false,
      paywall_active: true,
      upgrade_available: false,
    }
    renderApp({ route: '/venues/import', signedIn: true })

    expect(await screen.findByRole('button', { name: /download the template/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /see plans/i })).not.toBeInTheDocument()
  })

  it('draws no locks when the server could not be asked', async () => {
    /* One failed request must never cost a paying partner their features. */
    bench.entitlementsRefuses = true
    renderApp({ route: '/venues/import', signedIn: true })

    expect(await screen.findByRole('button', { name: /download the template/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /see plans/i })).not.toBeInTheDocument()
  })
})
