import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * PAYING FOR PRO, FROM THE PORTAL.
 *
 * ⚠️ Payfast's checkout is a SIGNED FORM POST, not a link. The signature covers
 * the fields in the order the server sent them, so the portal must submit them
 * as received — it may not sort, filter, or add to them. That is why this suite
 * asserts on the submitted form's fields and their order rather than on a URL.
 */

const ROUTE = '/venues/import'

/** A vendor on the paying side of the cutoff, with the feature locked. */
const onFreePlan = () => {
  bench.deploy.get_entitlements = true
  bench.entitlements = {
    ...bench.entitlements,
    features: [],
    grandfathered: false,
    paywall_active: true,
    upgrade_available: true,
  }
}

describe('starting a Payfast subscription', () => {
  let submitted

  beforeEach(() => {
    submitted = []
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function () {
      submitted.push(this)
    })
  })

  it('submits the server-signed form to Payfast, exactly as received', async () => {
    onFreePlan()
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))
    await user.click(await screen.findByRole('button', { name: /upgrade to pro/i }))

    await waitFor(() => expect(submitted).toHaveLength(1))
    const form = submitted[0]

    expect(form.action).toBe(bench.checkout.action)
    expect(form.method.toLowerCase()).toBe('post')

    const sent = [...form.elements].map((el) => [el.name, el.value])
    // Order matters: Payfast rebuilds the signature from the fields as it
    // receives them, so a reordered form is an invalid one.
    expect(sent).toEqual(Object.entries(bench.checkout.fields))
  })

  it('says so plainly when the server has no gateway configured', async () => {
    onFreePlan()
    bench.checkout = null
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /see what pro includes/i }))
    await user.click(await screen.findByRole('button', { name: /upgrade to pro/i }))

    expect(await screen.findByText(/isn.t on sale yet/i)).toBeInTheDocument()
    expect(submitted).toHaveLength(0)
  })
})
