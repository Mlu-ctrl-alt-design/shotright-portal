import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import { FEATURE, hasFeature, normaliseEntitlements } from '../services/plan'

/**
 * THE FEATURE KEYS, AGAINST WHAT THE BENCH ACTUALLY SENDS.
 *
 * `services/plan.js` was written while `get_entitlements` was unreachable — the
 * bench had the code but gunicorn runs `--preload` and had not been restarted —
 * so the keys in `FEATURE` were the portal's best reading of the Pro list. Its
 * own docstring asks for them to be confirmed, and says why:
 *
 *   "a key that does not match a row reads as 'not entitled', and the
 *    fall-open rule does not save us here because the bench answered
 *    perfectly well, just about a feature nobody registered."
 *
 * The endpoint is live now, and three of the five guesses were wrong. This
 * suite is the confirmation that was asked for, pinned to the real payload so
 * it cannot drift back.
 *
 * ⚠️ The fixture below is the LIVE response, copied from the bench on
 * 2026-09-19 — not a shape anyone invented. The old fixture used
 * `{plan: 'free', features: []}`, which is a legitimate state but not one that
 * exercises a single real key, so the whole mismatch was invisible to the suite.
 */

/** Exactly what shotright.api.get_entitlements returns today. */
const LIVE_KEYS = [
  'booking_analytics',
  'menu_import',
  'venue_bulk_import',
  'venue_import_google',
  'venue_import_social',
  'venue_import_website',
]

const liveResponse = (overrides = {}) => ({
  features: [...LIVE_KEYS],
  gated: [...LIVE_KEYS],
  catalogue: Object.fromEntries(LIVE_KEYS.map((k) => [k, { label: k, description: '' }])),
  grandfathered: true,
  paywall_active: false,
  upgrade_available: false,
  subscription: null,
  management_url: null,
  plans: [],
  ...overrides,
})

describe('the keys this portal gates on', () => {
  it('names only features the bench actually registers', () => {
    for (const key of Object.values(FEATURE)) {
      expect(LIVE_KEYS, `FEATURE key "${key}" is not registered on the bench`).toContain(key)
    }
  })

  it('resolves every registered feature for an account that holds them all', () => {
    const entitlements = normaliseEntitlements(liveResponse({ grandfathered: false, paywall_active: true }))
    for (const key of Object.values(FEATURE)) {
      expect(hasFeature(entitlements, key), `"${key}" read as locked`).toBe(true)
    }
  })
})

describe('an account the paywall does not apply to', () => {
  it('is not locked out of anything when the bench says the paywall is off', () => {
    /* `paywall_active: false` is the real field name. The old code looked for
       `gate_active`, `paywall` and `enforced`, none of which the bench sends,
       so this state fell through to ordinary key matching. */
    const entitlements = normaliseEntitlements(liveResponse())
    expect(hasFeature(entitlements, FEATURE.BULK_IMPORT)).toBe(true)
    expect(hasFeature(entitlements, FEATURE.MENU_IMPORT)).toBe(true)
  })

  it('is not locked out of anything when grandfathered', () => {
    /* Every partner on the live site is grandfathered right now: they predate
       the paywall and keep every feature permanently. Showing them a lock is
       showing a paywall to somebody who has already been told they will never
       see one. */
    const entitlements = normaliseEntitlements(
      liveResponse({ grandfathered: true, paywall_active: true }),
    )
    expect(hasFeature(entitlements, FEATURE.BULK_IMPORT)).toBe(true)
  })
})

describe('the bulk import screen, against the live bench', () => {
  it('shows no lock to a partner who holds the feature', async () => {
    bench.deploy.get_entitlements = true
    bench.entitlements = liveResponse()

    renderApp({ route: '/venues/import', signedIn: true })

    expect(await screen.findByRole('button', { name: /download the template/i })).toBeInTheDocument()
  })
})
