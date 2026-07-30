import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Signing in.
 *
 * Driven entirely through the form — type, click, read the screen. Nothing here
 * calls a service function, because the bugs this is meant to catch live in
 * what the screen does with what the service returns, not in the service.
 */
describe('login', () => {
  it('signs a partner in and lands them on the dashboard', async () => {
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /login/i }))

    // The dashboard greets them by name — proof we got past the guard AND that
    // the profile came back, not just that the URL changed. Queried by role
    // rather than by text: "Thabo" also appears in the profile summary below,
    // and a bare text match hits both and throws.
    expect(
      await screen.findByRole('heading', { name: /welcome back, thabo/i }),
    ).toBeInTheDocument()
  })

  it('says what is wrong when the password is not right, and stays put', async () => {
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /login/i }))

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument()
    // Still on the form, with the email kept — retyping an address you already
    // typed is the small insult that makes people give up on a login screen.
    expect(screen.getByLabelText(/email/i)).toHaveValue('thabo@cornerkitchen.co.za')
  })

  it('never shows raw Frappe markup to a partner', async () => {
    /* `frappe.throw` takes HTML and `_server_messages` carries it through
       untouched. A partner once read "User <strong>x@y.z</strong> does not
       have doctype access" on their own screen, tags and all. */
    bench.users[0].password = 'x'
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'nobody@example.com')
    await user.type(screen.getByLabelText(/password/i), 'nope')
    await user.click(screen.getByRole('button', { name: /login/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/<strong>|<\/strong>|&lt;/)
  })

  it('sends the password only to the login endpoint, and never in a URL', async () => {
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /login/i }))
    await screen.findByRole('heading', { name: /welcome back/i })

    const leaked = bench.calls.filter(
      (c) => c.method !== 'login' && JSON.stringify(c.args).includes('correct-horse'),
    )
    expect(leaked).toEqual([])
  })

  it('keeps an unauthenticated visitor out of the portal', async () => {
    renderApp({ route: '/venues', signedIn: false })

    // Bounced to the sign-in form rather than shown an empty venue list.
    expect(await screen.findByRole('button', { name: /login/i })).toBeInTheDocument()
  })

  it('lets a signed-in partner straight through to their venues', async () => {
    renderApp({ route: '/venues', signedIn: true })

    expect(await screen.findByText('Corner Kitchen & Bar')).toBeInTheDocument()
  })

  it('does not strand the partner on a spinner when the bench is down', async () => {
    bench.deploy.get_vendor_dashboard = false
    renderApp({ route: '/', signedIn: true })

    // Whatever it says, it must stop saying "loading" — a permanent spinner is
    // the failure mode nobody reports because it looks like slowness.
    await waitFor(
      () => expect(screen.queryByText(/restoring session/i)).not.toBeInTheDocument(),
      { timeout: 5000 },
    )
  })
})

/**
 * An account that exists but has not verified its email.
 *
 * REPORTED 28 Jul: "not seeing the OTP screen — login goes straight through to
 * the dashboard."
 *
 * OTP lives on registration, so a partner who already has an account will never
 * see it at login, and that is correct. But there is a real hole underneath the
 * report: `login` never branched on `otp_required`. `setAuthToken` refuses a
 * response with no api_key, so the token ended up null — and then the store set
 * `status: 'authenticated'` anyway. Straight to a dashboard where every
 * subsequent call has no credentials.
 *
 * `register` has guarded against exactly this since the OTP work landed. Login
 * did not, because at the time login could not return that shape. Now it can.
 */
describe('login for an unverified account', () => {
  it('sends them to verification instead of the dashboard', async () => {
    bench.loginNeedsOtp = true
    bench.users[0].enabled = false
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /login/i }))

    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /welcome back/i })).not.toBeInTheDocument()
  })

  it('never reports a session it has no token for', async () => {
    /* The specific failure: authenticated with nothing to authenticate with. */
    bench.loginNeedsOtp = true
    bench.users[0].enabled = false
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /login/i }))
    await screen.findByLabelText(/verification code/i)

    expect(bench.calls.some((c) => c.method === 'get_vendor_dashboard')).toBe(false)
  })

  it('lets them finish verifying and then come in', async () => {
    bench.loginNeedsOtp = true
    bench.users[0].enabled = false
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /login/i }))

    await user.type(await screen.findByLabelText(/verification code/i), '123456')

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })
})
