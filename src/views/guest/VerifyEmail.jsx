import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { resendOtp } from '../../services/vendor'
import { Button, Alert } from '../../components/ui'
import AuthLayout from '../../components/layout/AuthLayout'

/**
 * Email verification after registration.
 *
 * Reached only when the backend reports `otp_required`. If email verification
 * is not deployed, `register` returns a token and the router never sends anyone
 * here — so this screen shipping ahead of the backend costs nothing.
 *
 * ON THE INPUT DESIGN: this is ONE text input, not six single-character boxes.
 * Six boxes look neat in a mockup and are hostile in practice — they fight
 * paste, they fight autofill, they fight iOS's "from Messages" suggestion, and
 * screen readers announce six unlabelled fields with no indication they form
 * one value. A single input with `inputMode="numeric"` and
 * `autoComplete="one-time-code"` gets the numeric keypad on mobile AND the
 * platform's own code autofill, which is the fastest path for almost everyone.
 * The wide letter-spacing gives the same "this is a code" affordance the boxes
 * were reaching for.
 *
 * The email is carried in router state rather than the URL. Putting it in a
 * query string would leak the address into browser history, the Referer header
 * on any outbound link, and any analytics that records paths.
 */
const CODE_LENGTH = 6

export default function VerifyEmail() {
  const navigate = useNavigate()
  const location = useLocation()
  const verify = useAuthStore((s) => s.verifyEmail)

  const email = location.state?.email
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const inputRef = useRef(null)

  // Arriving here without an email means a refresh or a pasted URL — there is
  // nothing to verify against, so send them back rather than showing a form
  // that cannot work.
  useEffect(() => {
    if (!email) navigate('/register', { replace: true })
  }, [email, navigate])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const submit = async (value) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await verify(email, value)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      // Clear on failure. Leaving a wrong code in place means the next attempt
      // starts with a manual select-all, and the attempt budget is only five.
      setCode('')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const onChange = (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    // Auto-submit on the last digit. The alternative is a partner typing six
    // digits and then hunting for a button, and there is nothing else to do on
    // this screen.
    if (digits.length === CODE_LENGTH && !busy) submit(digits)
  }

  const resend = async () => {
    setError(null)
    setNotice(null)
    try {
      const result = await resendOtp(email)
      setCooldown(result?.cooldown_seconds ?? 60)
      setNotice(`We've sent a new code to ${email}.`)
    } catch (err) {
      setError(err.message)
    }
  }

  if (!email) return null

  return (
    <AuthLayout>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(code)
        }}
        className="space-y-5"
      >
        <div className="text-center">
          <h1 className="text-lg font-bold text-ink-900">Check your email</h1>
          <p className="mt-1.5 text-sm text-ink-700">
            We sent a {CODE_LENGTH}-digit code to <span className="font-semibold">{email}</span>.
            Enter it below to finish setting up your account.
          </p>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}

        <div>
          <label htmlFor="otp" className="sr-only">
            {CODE_LENGTH}-digit verification code
          </label>
          <input
            id="otp"
            ref={inputRef}
            type="text"
            inputMode="numeric"
            // Lets iOS and Android offer the code straight from the SMS/email
            // notification instead of making someone switch apps to read it.
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            aria-describedby="otp-hint"
            value={code}
            onChange={onChange}
            disabled={busy}
            className="block w-full rounded-full border-2 border-field bg-white py-3 text-center
                       font-mono text-2xl tracking-[0.6em] text-ink-900 indent-[0.6em]
                       focus:border-brand-edge focus:outline-none disabled:opacity-60"
          />
          <p id="otp-hint" className="mt-2 px-2 text-center text-xs text-ink-500">
            The code expires in 10 minutes.
          </p>
        </div>

        {/* aria-live so a screen reader hears the result of a verification
            attempt without having to go looking for it. */}
        <p className="sr-only" role="status">
          {busy ? 'Checking your code' : ''}
        </p>

        <div className="pt-1 text-center">
          <Button
            type="submit"
            caps={false}
            shape="rounded"
            size="lg"
            className="w-3/5 py-3.5"
            loading={busy}
            disabled={code.length !== CODE_LENGTH}
          >
            Verify
          </Button>
        </div>

        <div className="space-y-2 pt-1 text-center">
          <p className="text-sm text-ink-700">
            Didn&rsquo;t get it? Check your spam folder, or{' '}
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="font-semibold text-brand-ink underline disabled:no-underline disabled:opacity-60"
            >
              {cooldown > 0 ? `resend in ${cooldown}s` : 'send a new code'}
            </button>
            .
          </p>
          <p>
            <Link to="/register" className="text-sm text-ink-700 underline hover:text-ink-900">
              Use a different email
            </Link>
          </p>
        </div>
      </form>
    </AuthLayout>
  )
}
