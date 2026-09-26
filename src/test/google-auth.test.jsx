/**
 * Signing in with Google — as a PARTNER.
 *
 * On 26 Sep a real sign-up through this button made a customer account: the
 * portal's first guess at a method name was `login_with_google`, the mobile
 * app's customer door. The session worked; every partner call after it 404'd.
 * The first assertions here are therefore about which door is used at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { bench } from './bench'
import {
  GOOGLE_AUTH_METHOD,
  googleAuthSupported,
  loginWithGoogle,
  __resetCapabilities,
} from '../services/vendor'
import GoogleSignInButton from '../components/ui/GoogleSignInButton'
import { hasAuthToken, setAuthToken } from '../services/api'

/* Google's real button can't be clicked in jsdom; this stand-in hands over
   whatever credential the test puts in `nextCredential`. */
let nextCredential = 'good-google-token'
vi.mock('../components/ui/GoogleSignInButton', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    __esModule: true,
    default: (props) =>
      props.__real ? (
        <actual.default {...props} />
      ) : (
        <button type="button" onClick={() => props.onCredential(nextCredential)}>
          Continue with Google
        </button>
      ),
  }
})

beforeEach(() => {
  __resetCapabilities()
  setAuthToken(null)
  nextCredential = 'good-google-token'
})

const customerDoorCalls = () => bench.calls.filter((c) => c.method === 'login_with_google')

describe('which door', () => {
  it('only ever uses the partner door', () => {
    expect(GOOGLE_AUTH_METHOD).toBe('shotright.api.login_vendor_with_google')
  })

  it('never calls the customer door, even when the partner one is missing', async () => {
    expect(await googleAuthSupported()).toBe(false)
    await expect(loginWithGoogle('good-google-token')).rejects.toThrow(/isn’t available/i)
    expect(customerDoorCalls()).toHaveLength(0)
    expect(hasAuthToken()).toBe(false)
  })
})

describe('whether to offer it at all', () => {
  it('says no when the partner door is not deployed', async () => {
    expect(await googleAuthSupported()).toBe(false)
  })

  it('says yes when it is — the empty probe is refused with a 401', async () => {
    bench.deploy.login_vendor_with_google = true
    expect(await googleAuthSupported()).toBe(true)
  })

  it('probes without a token, so a probe cannot sign anyone in', async () => {
    bench.deploy.login_vendor_with_google = true
    await googleAuthSupported()

    const probes = bench.calls.filter((c) => c.method === 'login_vendor_with_google')
    expect(probes.length).toBe(1)
    expect(probes[0].args.id_token).toBeUndefined()
    expect(hasAuthToken()).toBe(false)
  })

  /* A 401 normally ends the session and sends the partner to /login. The probe
     runs on /register too, where that would throw someone out mid-signup. */
  it("the probe's 401 does not end a session", async () => {
    bench.deploy.login_vendor_with_google = true
    setAuthToken({ api_key: 'K', api_secret: 'S' })
    const expired = vi.fn()
    window.addEventListener('shotright:session-expired', expired)

    await googleAuthSupported()

    window.removeEventListener('shotright:session-expired', expired)
    expect(expired).not.toHaveBeenCalled()
    expect(hasAuthToken()).toBe(true)
  })

  it('renders nothing, and asks nothing, without a client id', async () => {
    bench.deploy.login_vendor_with_google = true
    const before = bench.calls.length

    const { container } = render(<GoogleSignInButton __real onCredential={() => {}} />)

    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    expect(bench.calls.length).toBe(before)
  })
})

describe('exchanging the token', () => {
  beforeEach(() => {
    bench.deploy.login_vendor_with_google = true
  })

  it('signs a returning partner in, sending the token as id_token', async () => {
    const result = await loginWithGoogle('good-google-token')

    expect(result.api_key).toBe('GK')
    expect(hasAuthToken()).toBe(true)
    const sent = bench.calls.filter((c) => c.method === 'login_vendor_with_google').at(-1)
    expect(sent.args).toEqual(expect.objectContaining({ id_token: 'good-google-token' }))
    expect(sent.args).not.toHaveProperty('credential')
  })

  it('reports a new partner as needing a business name, with no session', async () => {
    const result = await loginWithGoogle('new-partner-token')

    expect(result).toEqual({ businessNameRequired: true, email: 'new@partner.co.za' })
    expect(hasAuthToken()).toBe(false)
  })

  it('sends a business name when there is one, trimmed', async () => {
    const result = await loginWithGoogle('new-partner-token', "  Thandi's Bistro  ")

    expect(result.api_key).toBe('GK')
    expect(bench.googleVendorsCreated).toEqual(["Thandi's Bistro"])
  })

  it('reports a token the server would not verify, once, without retrying', async () => {
    await expect(loginWithGoogle('forged')).rejects.toThrow(/could not verify/i)
    expect(bench.calls.filter((c) => c.method === 'login_vendor_with_google')).toHaveLength(1)
    expect(hasAuthToken()).toBe(false)
  })

  it('refuses to send nothing', async () => {
    await expect(loginWithGoogle('')).rejects.toThrow()
    expect(bench.calls.some((c) => c.method === 'login_vendor_with_google')).toBe(false)
  })

  it('never names a method at the partner', async () => {
    const err = await loginWithGoogle('forged').catch((e) => e)
    expect(err.message).not.toMatch(/shotright\.api|frappe\./)
  })
})

/* The screens: a new partner arrives from Google with no business name. */
async function renderAt(path) {
  const { default: Login } = await import('../views/guest/Login')
  const { default: Register } = await import('../views/guest/Register')
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the business-name step', () => {
  beforeEach(() => {
    bench.deploy.login_vendor_with_google = true
    nextCredential = 'new-partner-token'
  })

  it('from Login: asks for the business name, then lands on the dashboard', async () => {
    const user = userEvent.setup()
    await renderAt('/login')

    await user.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(await screen.findByText(/one last thing/i)).toBeInTheDocument()
    expect(screen.getByText('new@partner.co.za')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/business name/i), 'Kasi Kitchen')
    await user.click(screen.getByRole('button', { name: /create my partner account/i }))

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    expect(bench.googleVendorsCreated).toEqual(['Kasi Kitchen'])
    expect(customerDoorCalls()).toHaveLength(0)
  })

  it('refuses a blank business name without calling the bench', async () => {
    const user = userEvent.setup()
    await renderAt('/login')
    await user.click(screen.getByRole('button', { name: /continue with google/i }))
    await screen.findByText(/one last thing/i)
    const before = bench.calls.length

    await user.click(screen.getByRole('button', { name: /create my partner account/i }))

    expect(await screen.findByText(/type in your business name/i)).toBeInTheDocument()
    expect(bench.calls.length).toBe(before)
  })

  it('Back returns to the sign-in screen, having created nothing', async () => {
    const user = userEvent.setup()
    await renderAt('/login')
    await user.click(screen.getByRole('button', { name: /continue with google/i }))
    await screen.findByText(/one last thing/i)

    await user.click(screen.getByRole('button', { name: /^back$/i }))

    expect(await screen.findByText(/log in to the partner portal/i)).toBeInTheDocument()
    expect(bench.googleVendorsCreated).toBeUndefined()
  })

  it('from Register: a business name already typed is used, and not asked again', async () => {
    const user = userEvent.setup()
    await renderAt('/register')

    await user.type(screen.getByLabelText(/business name/i), 'Typed Bistro')
    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())
    expect(screen.queryByText(/one last thing/i)).not.toBeInTheDocument()
    expect(bench.googleVendorsCreated).toEqual(['Typed Bistro'])
  })

  it('from Register with the field empty: asks, as Login does', async () => {
    const user = userEvent.setup()
    await renderAt('/register')

    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(await screen.findByText(/one last thing/i)).toBeInTheDocument()
  })
})
