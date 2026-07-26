import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { USE_MOCKS } from '../../services/api'
import { Button, Input, Alert } from '../../components/ui'
import AuthLayout from '../../components/layout/AuthLayout'

/**
 * Issue #14 — partner login. Auth runs through the Auth Token Service; the
 * portal only ever holds the resulting session, never the credentials.
 *
 * Laid out to match `Login.png`: a centred card on the warm background, inputs
 * carrying their prompt as an italic placeholder rather than a label, a
 * circular "Remember me" control, and a sentence-case Login button.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/sign-in
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((s) => s.login)

  const [email, setEmail] = useState(USE_MOCKS ? 'vendor@shotright.co.za' : '')
  const [password, setPassword] = useState(USE_MOCKS ? 'password' : '')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={onSubmit} className="space-y-5">
        <Alert variant="danger">{error}</Alert>

        <Input
          name="email"
          type="email"
          autoComplete="username"
          aria-label="Email"
          placeholder="Please type in your email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Please type in password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* Circular control, per the design — a checkbox by behaviour, so it
            stays keyboard-operable and announces correctly. */}
        <label className="flex cursor-pointer items-center gap-3 pl-1">
          <span className="relative inline-flex">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="peer sr-only"
            />
            <span
              className={[
                'grid size-6 place-items-center rounded-full border-2 border-brand-edge transition',
                'peer-focus-visible:outline peer-focus-visible:outline-2',
                'peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600',
                remember ? 'bg-brand-500' : 'bg-white',
              ].join(' ')}
            >
              {remember && (
                <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-white stroke-[2.5]">
                  <path d="M1.5 6.5l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </span>
          <span className="text-sm text-ink-500 italic">Remember me</span>
        </label>

        <div className="pt-3 text-center">
          <Button
            type="submit"
            caps={false}
            shape="rounded"
            size="lg"
            className="w-3/5 py-3.5"
            loading={busy}
          >
            Login
          </Button>
        </div>

        <p className="pt-1 text-center">
          <Link to="/register" className="text-sm text-ink-700 underline hover:text-ink-900">
            Register as a Bloop Partner
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
