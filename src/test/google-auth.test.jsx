/**
 * Signing in with Google, on a bench that may not have it.
 *
 * The mobile app has Google sign-in, so something exists on the backend; the
 * portal has never been told what it is called. That makes the FIRST assertion
 * here the important one — a sign-in button is the most trusted control on the
 * page, and one that cannot sign anyone in does not read as "not ready yet", it
 * reads as a broken product.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { bench } from './bench'
import {
  GOOGLE_AUTH_METHODS,
  googleAuthSupported,
  loginWithGoogle,
  __resetCapabilities,
} from '../services/vendor'
import GoogleSignInButton from '../components/ui/GoogleSignInButton'
import { hasAuthToken, setAuthToken } from '../services/api'

beforeEach(() => {
  __resetCapabilities()
  setAuthToken(null)
})

describe('whether to offer it at all', () => {
  it('says no when the bench has none of the candidate methods', async () => {
    expect(await googleAuthSupported()).toBe(false)
  })

  it('says yes when one of them answers', async () => {
    bench.deploy.login_with_google = true
    expect(await googleAuthSupported()).toBe(true)
  })

  /* The probe sends NO credential, so it can never sign anyone in or out. A
     method that exists proves it by refusing the empty call. */
  it('probes without a credential', async () => {
    bench.deploy.login_with_google = true
    await googleAuthSupported()

    const probes = bench.calls.filter((c) => c.method === 'login_with_google')
    expect(probes.length).toBeGreaterThan(0)
    probes.forEach((c) => expect(c.args.credential).toBeUndefined())
    expect(hasAuthToken()).toBe(false)
  })

  /**
   * With no client id configured there is nothing to sign in WITH, so the
   * button must not render — and must not fire a single request finding that
   * out. This is the default in every environment that has not set one up.
   */
  it('renders nothing, and asks nothing, without a client id', async () => {
    bench.deploy.login_with_google = true
    const before = bench.calls.length

    const { container } = render(<GoogleSignInButton onCredential={() => {}} />)

    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/^or$/i)).not.toBeInTheDocument()
    expect(bench.calls.length).toBe(before)
  })
})

describe('exchanging the token', () => {
  beforeEach(() => {
    bench.deploy.login_with_google = true
  })

  it('signs the partner in', async () => {
    const result = await loginWithGoogle('good-google-token')

    expect(result.api_key).toBe('GK')
    expect(hasAuthToken()).toBe(true)
  })

  /**
   * The parameter name is a guess, and unlike a form field a wrong kwarg on a
   * whitelisted method is fatal — Frappe raises TypeError rather than ignoring
   * it. So a wrong name has to be tried past, not surfaced.
   */
  it('finds the parameter name the method actually takes', async () => {
    const result = await loginWithGoogle('good-google-token')
    expect(result.api_key).toBe('GK')

    const accepted = bench.calls.filter((c) => c.method === 'login_with_google').at(-1)
    expect(accepted.args).toHaveProperty('credential')
  })

  /**
   * A Google account can belong to a partner who never finished verifying.
   * Walking them past that is how someone lands on a dashboard with nothing to
   * authenticate with — the bug the password path already carries a branch for.
   */
  it('sends an unverified account to verification, not to the dashboard', async () => {
    const result = await loginWithGoogle('unverified-account')

    expect(result.otpRequired).toBe(true)
    expect(result.email).toBe('new@partner.co.za')
    expect(hasAuthToken()).toBe(false)
  })

  /* A refused token is a real answer and must not be retried around the
     candidate list as though the method were missing. */
  it('reports a token the server would not verify', async () => {
    await expect(loginWithGoogle('forged')).rejects.toThrow(/could not be verified/i)
    expect(hasAuthToken()).toBe(false)
  })

  it('refuses to send nothing', async () => {
    await expect(loginWithGoogle('')).rejects.toThrow()
    expect(bench.calls.some((c) => c.method === 'login_with_google')).toBe(false)
  })

  it('never names a method at the partner', async () => {
    const err = await loginWithGoogle('forged').catch((e) => e)
    GOOGLE_AUTH_METHODS.forEach((m) => expect(err.message).not.toContain(m))
    expect(err.message).not.toMatch(/shotright\.api|frappe\./)
  })
})
