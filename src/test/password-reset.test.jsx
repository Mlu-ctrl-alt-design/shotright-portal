import { describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Getting back in — password reset, and resending a verification code.
 *
 * These were built long before outgoing mail existed, so until 28 Jul they
 * could not do anything: a code was requested, no email was sent, and the
 * partner sat on stage two with nothing to type. With OTP and the mail service
 * live they are suddenly load-bearing, and they are the flows somebody reaches
 * for at exactly the moment they are already locked out and frustrated.
 *
 * The assertion that matters most is the enumeration one. A reset form that
 * says "no account with that address" is a free list of who banks with you —
 * and on a partner portal, of which restaurants are on the platform.
 */

const RESET = '/forgot-password'
const KNOWN = 'thabo@cornerkitchen.co.za'

const sendCode = async (user, email = KNOWN) => {
  await user.type(await screen.findByLabelText(/^email$/i), email)
  await user.click(screen.getByRole('button', { name: /send code/i }))
}

describe('password reset', () => {
  it('takes an email and moves on to the code', async () => {
    const { user } = renderApp({ route: RESET })

    await sendCode(user)

    expect(await screen.findByLabelText(/reset code/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument()
  })

  it('asks the server to send one', async () => {
    const { user } = renderApp({ route: RESET })

    await sendCode(user)
    await screen.findByLabelText(/reset code/i)

    const call = bench.calls.find((c) => c.method === 'request_password_reset')
    expect(call).toBeTruthy()
    expect(call.args.email).toBe(KNOWN)
  })

  it('says the same thing for an address with no account', async () => {
    /* ENUMERATION. "No account with that address" hands anyone a way to test
       emails one at a time and learn which restaurants are on the platform.
       The reply must not depend on whether the account exists. */
    const { user: u1 } = renderApp({ route: RESET })
    await sendCode(u1)
    const known = (await screen.findByText(/sent|check your email|if that address/i)).textContent

    // Explicit cleanup: `cleanup()` runs in afterEach, not between two renders
    // inside one test, so without this both apps are mounted at once and every
    // query finds two of everything.
    cleanup()

    const { user: u2 } = renderApp({ route: RESET })
    await sendCode(u2, 'nobody-at-all@example.com')
    const unknown = (await screen.findByText(/sent|check your email|if that address/i)).textContent

    expect(unknown).toBe(known)
  })

  it('does not reveal the account in the wording either', async () => {
    const { user } = renderApp({ route: RESET })

    await sendCode(user, 'nobody-at-all@example.com')
    await screen.findByLabelText(/reset code/i)

    expect(document.body.textContent).not.toMatch(
      /no account|not registered|doesn’t exist|does not exist|unknown email/i,
    )
  })

  it('sets the new password and signs them in', async () => {
    const { user } = renderApp({ route: RESET })

    await sendCode(user)
    await user.type(await screen.findByLabelText(/reset code/i), '123456')
    await user.type(screen.getByLabelText(/new password/i), 'a-brand-new-password')
    await user.click(screen.getByRole('button', { name: /set new password/i }))

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })

  it('keeps the code and password on screen when the code is wrong', async () => {
    /* Clearing the form on a wrong code means retyping a password they have
       just invented, at the worst possible moment. */
    bench.otpCode = '999999'
    const { user } = renderApp({ route: RESET })

    await sendCode(user)
    await user.type(await screen.findByLabelText(/reset code/i), '123456')
    await user.type(screen.getByLabelText(/new password/i), 'a-brand-new-password')
    await user.click(screen.getByRole('button', { name: /set new password/i }))

    // Two alerts on this screen at once — the "code sent" notice is still up
    // alongside the new error, so ask for the error by its words.
    expect(await screen.findByText(/not right|incorrect|invalid/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/new password/i)).toHaveValue('a-brand-new-password')
  })

  it('does not let the email be edited once a code is out', async () => {
    /* Changing the address after a code was sent to a different one produces a
       code that can never work, and no way to tell why. */
    const { user } = renderApp({ route: RESET })

    await sendCode(user)
    await screen.findByLabelText(/reset code/i)

    expect(screen.getByLabelText(/^email$/i)).toBeDisabled()
  })

  it('offers a way to send another code', async () => {
    const { user } = renderApp({ route: RESET })

    await sendCode(user)
    await screen.findByLabelText(/reset code/i)

    expect(screen.getByRole('button', { name: /send.*again|resend|new code/i })).toBeInTheDocument()
  })

  it('shows a server failure rather than pretending a code went out', async () => {
    /* Mail is configured now, which means it can also fail. Saying "check your
       email" over a send that errored leaves someone waiting for nothing. */
    bench.deploy.request_password_reset = false
    const { user } = renderApp({ route: RESET })

    await sendCode(user)

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/reset code/i)).not.toBeInTheDocument()
  })
})

describe('resending a verification code', () => {
  const registerToOtp = async (user) => {
    await user.type(await screen.findByLabelText(/^name$/i), 'Nomsa')
    await user.type(screen.getByLabelText(/^surname$/i), 'Dlamini')
    await user.type(screen.getByLabelText(/business name/i), 'Nomsa’s Kitchen')
    await user.type(screen.getByLabelText(/^email$/i), 'nomsa@example.co.za')
    await user.type(screen.getByLabelText(/^password$/i), 'a-good-password')
    const confirm = screen.queryByLabelText(/confirm password/i)
    if (confirm) await user.type(confirm, 'a-good-password')
    await user.click(screen.getByRole('button', { name: /^register$/i }))
    return screen.findByLabelText(/verification code/i)
  }

  it('sends another code when asked', async () => {
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await registerToOtp(user)

    await user.click(screen.getByRole('button', { name: /send a new code/i }))

    expect(bench.calls.some((c) => c.method === 'resend_otp')).toBe(true)
    expect(await screen.findByText(/sent a new code/i)).toBeInTheDocument()
  })

  it('names the address it went to, so a typo is visible', async () => {
    /* The commonest reason a code never arrives is that it went to an address
       with a typo in it. Showing it is the whole fix. */
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await registerToOtp(user)

    expect(screen.getByText(/nomsa@example\.co\.za/)).toBeInTheDocument()
  })

  it('offers a way back to change the address', async () => {
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await registerToOtp(user)

    // A link back to /register, not a button — it navigates rather than acting.
    expect(
      screen.getByRole('link', { name: /use a different email/i }),
    ).toBeInTheDocument()
  })
})
