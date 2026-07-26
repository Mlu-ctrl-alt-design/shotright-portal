import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { requestPasswordReset } from '../../services/vendor'
import { Button, Input, PasswordInput, Alert } from '../../components/ui'
import AuthLayout from '../../components/layout/AuthLayout'

/**
 * Password reset, in two stages on one screen.
 *
 * ENUMERATION: stage one always reports the same thing — "if that address has
 * an account, we've sent a code" — whether or not the account exists, matching
 * the backend. Saying "no account found" would turn this form into a free
 * membership checker for anyone holding a list of email addresses. The cost is
 * that someone who mistypes their address waits for a mail that never arrives;
 * the resend control and the visible address are there to make that recoverable.
 *
 * Staying on one screen rather than routing to a second is deliberate: the code
 * and the new password are entered in the same sitting, and a route change here
 * would risk losing the entered address on a refresh for no benefit.
 */
export default function ForgotPassword() {
  const navigate = useNavigate()
  const reset = useAuthStore((s) => s.resetPassword)

  const [stage, setStage] = useState('request') // 'request' | 'reset'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const sendCode = async (event) => {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await requestPasswordReset(email)
      setCooldown(result?.cooldown_seconds ?? 60)
      setStage('reset')
      setNotice(`If ${email} has an account, a reset code is on its way.`)
      setTimeout(() => codeRef.current?.focus(), 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async (event) => {
    event.preventDefault()
    if (password.length < 8) {
      setError('Your new password must be at least 8 characters.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reset(email, code, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={stage === 'request' ? sendCode : submitReset} className="space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-bold text-ink-900">Reset your password</h1>
          <p className="mt-1.5 text-sm text-ink-700">
            {stage === 'request'
              ? 'Enter the email you registered with and we’ll send you a code.'
              : 'Enter the code we sent, then choose a new password.'}
          </p>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}

        <Input
          name="email"
          type="email"
          autoComplete="username"
          aria-label="Email"
          placeholder="Please type in your email"
          required
          value={email}
          disabled={stage === 'reset'}
          onChange={(e) => setEmail(e.target.value)}
        />

        {stage === 'reset' && (
          <>
            <Input
              ref={codeRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Reset code"
              placeholder="6-digit code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <PasswordInput
              name="new_password"
              autoComplete="new-password"
              aria-label="New password"
              placeholder="Choose a new password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}

        <div className="pt-3 text-center">
          <Button
            type="submit"
            caps={false}
            shape="rounded"
            size="lg"
            className="w-3/5 py-3.5"
            loading={busy}
          >
            {stage === 'request' ? 'Send code' : 'Set new password'}
          </Button>
        </div>

        {stage === 'reset' && (
          <p className="text-center text-sm text-ink-700">
            Didn&rsquo;t get it?{' '}
            <button
              type="button"
              onClick={sendCode}
              disabled={cooldown > 0}
              className="font-semibold text-brand-ink underline disabled:no-underline disabled:opacity-60"
            >
              {cooldown > 0 ? `resend in ${cooldown}s` : 'send another code'}
            </button>
          </p>
        )}

        <p className="pt-1 text-center">
          <Link to="/login" className="text-sm text-ink-700 underline hover:text-ink-900">
            Back to login
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
