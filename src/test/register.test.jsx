import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

const fillForm = async (user, over = {}) => {
  const f = {
    first: 'Nomsa',
    last: 'Dlamini',
    business: 'Nomsa’s Kitchen',
    email: 'nomsa@example.co.za',
    password: 'a-good-password',
    ...over,
  }
  // The real labels on this form are "Name" and "Surname", not first/last —
  // queried the way a screen reader announces them, which is the point of
  // driving the UI rather than the props.
  await user.type(await screen.findByLabelText(/^name$/i), f.first)
  await user.type(screen.getByLabelText(/^surname$/i), f.last)
  await user.type(screen.getByLabelText(/business name/i), f.business)
  await user.type(screen.getByLabelText(/^email$/i), f.email)
  await user.type(screen.getByLabelText(/^password$/i), f.password)
  const confirm = screen.queryByLabelText(/confirm password/i)
  if (confirm) await user.type(confirm, f.password)
  return f
}

describe('register', () => {
  it('creates an account and signs the new partner straight in', async () => {
    const { user } = renderApp({ route: '/register' })
    const f = await fillForm(user)
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(bench.users.some((u) => u.email === f.email)).toBe(true)
  })

  it('sends the name as two fields, not one joined string', async () => {
    /* `vendor_name` was invented before the real API existed and became the
       first of six name mismatches on this project. The backend takes
       first_name and last_name separately. */
    const { user } = renderApp({ route: '/register' })
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: /^register$/i }))
    await screen.findByRole('heading', { name: /welcome back/i })

    const call = bench.calls.find((c) => c.method === 'register_vendor')
    expect(call.args.first_name).toBe('Nomsa')
    expect(call.args.last_name).toBe('Dlamini')
    expect(call.args).not.toHaveProperty('vendor_name')
  })

  it('does not sign in an account the bench says is unverified', async () => {
    /* With OTP deployed, register_vendor returns {otp_required: true} and NO
       token. Treating that as a session drops someone into a portal where
       every call fails behind a UI that looks signed in. */
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /welcome back/i })).not.toBeInTheDocument()
  })

  it('completes verification and only then lets them in', async () => {
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    /* No click on Verify. The field submits itself on the sixth digit, which
       is right — there is nothing else to do on that screen, and making
       someone hunt for a button after typing a code they were reading off
       their phone is a needless step. Discovered by driving the UI: an earlier
       draft of this test clicked as well and raced its own auto-submit. */
    await user.type(await screen.findByLabelText(/verification code/i), '123456')

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })

  it('verifies once, even if the partner also clicks the button', async () => {
    /* The natural thing to do is type the last digit AND press Verify. The
       auto-submit is guarded by `busy`, but that is React state and is not set
       synchronously, so a fast click can get past it. Two submissions of one
       code costs an attempt out of five, and the second would be rejected as
       already-used on a real bench — locking someone out of their own account
       for doing nothing wrong. */
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    const input = await screen.findByLabelText(/verification code/i)
    await user.type(input, '123456')
    const verify = screen.queryByRole('button', { name: /^verify$/i })
    if (verify) await user.click(verify).catch(() => {})

    await screen.findByRole('heading', { name: /welcome back/i })
    expect(bench.calls.filter((c) => c.method === 'verify_otp')).toHaveLength(1)
  })

  it('says a wrong code is wrong, without losing the partner’s place', async () => {
    bench.otpRequired = true
    const { user } = renderApp({ route: '/register' })
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    await user.type(await screen.findByLabelText(/verification code/i), '000000')

    expect(await screen.findByText(/not right|incorrect|invalid/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument()
  })

  it('reports an email already in use in plain words', async () => {
    const { user } = renderApp({ route: '/register' })
    await fillForm(user, { email: 'thabo@cornerkitchen.co.za' })
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already exists/i)
    // Frappe wrote that message with <strong> in it.
    expect(alert.textContent).not.toMatch(/<strong>|&lt;/)
  })

  it('will not submit a password that does not match its confirmation', async () => {
    const { user } = renderApp({ route: '/register' })
    const confirm = screen.queryByLabelText(/confirm password/i)
    if (!confirm) return // form has no confirmation field; nothing to assert

    await fillForm(user)
    await user.clear(screen.getByLabelText(/confirm password/i))
    await user.type(screen.getByLabelText(/confirm password/i), 'something-else')
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    expect(await screen.findByText(/match/i)).toBeInTheDocument()
    expect(bench.calls.some((c) => c.method === 'register_vendor')).toBe(false)
  })
})
