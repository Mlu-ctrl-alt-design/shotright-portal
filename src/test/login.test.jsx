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
    await user.click(screen.getByRole('button', { name: /log in/i }))

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
    await user.click(screen.getByRole('button', { name: /log in/i }))

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
    await user.click(screen.getByRole('button', { name: /log in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/<strong>|<\/strong>|&lt;/)
  })

  it('sends the password only to the login endpoint, and never in a URL', async () => {
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /log in/i }))
    await screen.findByRole('heading', { name: /welcome back/i })

    const leaked = bench.calls.filter(
      (c) => c.method !== 'login' && JSON.stringify(c.args).includes('correct-horse'),
    )
    expect(leaked).toEqual([])
  })

  /* ==========================================================================
     THE 17 SEP DESIGN'S CENTRAL MOVE. The password field is not there until an
     email is. Most partners here signed in with Google, and a password box
     sitting open under a Google button invites them to guess at a password
     they never set.
     ======================================================================= */
  it('asks for an address before it asks for a password', async () => {
    renderApp({ route: '/login' })

    await screen.findByLabelText(/email/i)
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(screen.queryByLabelText(/keep me signed in/i)).toBeNull()
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument()
  })

  it('reveals the password and the rest once an address is typed', async () => {
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 't@cornerkitchen.co.za')

    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByText(/keep me signed in/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot it/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('a whitespace-only address does not count as an address', async () => {
    /* An autofill or a phone keyboard leaves a trailing space. Treating that
       as "they have typed an email" shows a password box for an address the
       submit guard will then refuse — a screen that looks stuck. */
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), '   ')

    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it('keeps an unauthenticated visitor out of the portal', async () => {
    renderApp({ route: '/venues', signedIn: false })

    // Bounced to the sign-in form rather than shown an empty venue list.
    //
    // Asserted on the HEADING, not the submit button. The button's label is a
    // function of form state — an untouched form reads "Continue with email" —
    // so keying the "did we land on login?" test to it would fail for a reason
    // that has nothing to do with the guard being tested.
    expect(
      await screen.findByRole('heading', { name: /log in to the partner portal/i }),
    ).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /log in/i }))

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
    await user.click(screen.getByRole('button', { name: /log in/i }))
    await screen.findByLabelText(/verification code/i)

    expect(bench.calls.some((c) => c.method === 'get_vendor_dashboard')).toBe(false)
  })

  it('lets them finish verifying and then come in', async () => {
    bench.loginNeedsOtp = true
    bench.users[0].enabled = false
    const { user } = renderApp({ route: '/login' })

    await user.type(await screen.findByLabelText(/email/i), 'thabo@cornerkitchen.co.za')
    await user.type(screen.getByLabelText(/password/i), 'correct-horse')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    await user.type(await screen.findByLabelText(/verification code/i), '123456')

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })
})
