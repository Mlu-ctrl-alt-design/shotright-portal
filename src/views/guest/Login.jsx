import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { Button, Input, PasswordInput, Alert } from '../../components/ui'
import GoogleSignInButton from '../../components/ui/GoogleSignInButton'
import AuthLayout from '../../components/layout/AuthLayout'

/**
 * Issue #14 — partner login. Auth runs through the Auth Token Service; the
 * portal only ever holds the resulting session, never the credentials.
 *
 * Laid out to the 17 Sep `Login.dc.html`: logo over a 392px card on the warm
 * wash, Google first, then the email form behind an "or".
 *
 * **The password field is not there until an email is.** That is the design's
 * central move and it is worth stating why it is not just tidiness: most
 * partners arriving here signed in with Google, and a password box sitting
 * open under a Google button invites them to guess at a password they never
 * set. Asking for the address first makes "Continue with email" a deliberate
 * choice rather than the default one. The same reveal carries "Keep me signed
 * in", which is meaningless before there is an account to keep.
 *
 * Progressive disclosure has a cost and it is paid here: a password manager
 * cannot fill a field that is not rendered. `autocomplete` is on both inputs
 * and the password mounts as soon as the address is typed — which is the point
 * at which a manager offers to fill anyway.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/sign-in
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((s) => s.login)
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)

  // No prefill, in any environment. It used to seed fixture credentials, which
  // was harmless while the whole app was fixtures and is not now: a real
  // partner must never open this screen with somebody else's email in it.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Trimmed: a trailing space from an autofill or a phone keyboard must not be
  // the difference between a screen that asks for a password and one that
  // looks stuck.
  const hasEmail = email.trim().length > 0

  /* One place for what happens AFTER a successful sign-in, whichever way it
     came. The unverified-account branch is the reason: a Google account can
     belong to a partner who never finished verifying, and only handling that on
     the password path would send them to a dashboard they cannot use. */
  const land = (result) => {
    if (result?.otpRequired) {
      navigate('/verify', { replace: true, state: { email: result.email } })
      return
    }
    navigate(location.state?.from || '/', { replace: true })
  }

  const onGoogleCredential = async (credential) => {
    setBusy(true)
    setError(null)
    try {
      land(await loginWithGoogle(credential))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = async (event) => {
    event.preventDefault()

    // First press with an address and no password box yet: reveal it rather
    // than submitting half a form. `required` on an unmounted input cannot
    // stop anything, so the guard is here.
    if (!hasEmail || !password) return

    setBusy(true)
    setError(null)
    try {
      // An account that exists but hasn't verified goes to the same place as
      // registration, carrying the address so the code can be resent — see
      // `land`, which both ways in share.
      land(await login(email.trim(), password))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      minimal
      footer
      topRight={
        <Link to="/register" className="text-sm font-semibold text-ink-900 hover:underline">
          Register
        </Link>
      }
    >
      <h1 className="text-center text-xl font-bold tracking-tight text-ink-900">
        Log in to the Partner Portal
      </h1>

      {/* `Alert` renders nothing for a falsy child, so this is not wrapped in a
          conditional — see the component. */}
      <div className="mt-5">
        <Alert variant="danger">{error}</Alert>
      </div>

      {/* Google FIRST, above the divider. The previous screen put it under the
          password form on the reasoning that most partners have a password;
          the bench disagrees — Google sign-in is the path this portal pushes on
          the register screen, so it is the path this one opens with. */}
      <div className="mt-6 flex flex-col items-center gap-4">
        <GoogleSignInButton onCredential={onGoogleCredential} disabled={busy} />
      </div>

      <div aria-hidden="true" className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-medium text-ink-500">or</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Input
          label="Email"
          shape="rounded"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@yourvenue.co.za"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {hasEmail && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor="login-password" className="text-sm font-semibold text-ink-900">
                Password
              </label>
              {/* Beside the field it belongs to, not stranded at the bottom of
                  the card. Someone reaches for this at the moment the password
                  box defeats them. */}
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-ink-700 hover:underline"
              >
                Forgot it?
              </Link>
            </div>
            <PasswordInput
              id="login-password"
              shape="rounded"
              name="password"
              autoComplete="current-password"
              placeholder="Your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        {hasEmail && (
          <label className="mt-0.5 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 cursor-pointer accent-brand-500"
            />
            <span className="text-sm text-ink-700">Keep me signed in</span>
          </label>
        )}

        <Button
          type="submit"
          caps={false}
          shape="rounded"
          size="lg"
          className="mt-1.5 w-full"
          loading={busy}
        >
          {/* Three labels for three states. "Log in" over an empty form is a
              button that cannot do what it says; "Continue with email" is the
              truth about what the next press does. And `loading` only disables
              the button — a disabled control with an unchanged label is the
              dead-button shape this codebase keeps rediscovering, so the third
              state says what is happening. */}
          {busy ? 'Signing you in\u2026' : hasEmail ? 'Log in' : 'Continue with email'}
        </Button>
      </form>

      <p className="mt-6 border-t border-gray-200 pt-5 text-center text-sm text-ink-500">
        New here?{' '}
        <Link to="/register" className="font-semibold">
          Register as a partner
        </Link>
      </p>
    </AuthLayout>
  )
}
