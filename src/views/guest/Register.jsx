import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { Button, Input, Alert } from '../../components/ui'
import AuthLayout from '../../components/layout/AuthLayout'

/**
 * Issue #14 — partner registration.
 *
 * Per the domain glossary's negative constraint: an existing Customer Profile on
 * the same User must NOT block partner registration, and there is deliberately
 * no "switch view" affordance between the Customer and Partner identities. This
 * form therefore never asks about, or checks for, a customer account.
 *
 * Fields follow `register.png`: name and surname are captured separately and
 * joined into the single `vendor_name` the API already expects, so the design is
 * satisfied without changing the auth contract. The design has no phone field —
 * the number is collected later, on the venue details step.
 */
function strengthOf(password) {
  if (!password) return null
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 2) return { label: 'Weak password', tone: 'text-red-600' }
  if (score === 3) return { label: 'Fair password', tone: 'text-brand-ink' }
  return { label: 'Strong password', tone: 'text-green-600' }
}

export default function Register() {
  const navigate = useNavigate()
  const register = useAuthStore((s) => s.register)

  const [form, setForm] = useState({
    first_name: '',
    surname: '',
    email: '',
    business_name: '',
    password: '',
    confirm_password: '',
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const strength = strengthOf(form.password)

  const onSubmit = async (event) => {
    event.preventDefault()
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm_password) {
      setError('Those passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await register({
        vendor_name: `${form.first_name} ${form.surname}`.trim(),
        business_name: form.business_name,
        email: form.email,
        password: form.password,
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert variant="danger">{error}</Alert>

        <Input
          name="first_name"
          aria-label="Name"
          placeholder="Please type in your name"
          required
          value={form.first_name}
          onChange={set('first_name')}
        />
        <Input
          name="surname"
          aria-label="Surname"
          placeholder="Please type in your surname"
          required
          value={form.surname}
          onChange={set('surname')}
        />
        <Input
          name="email"
          type="email"
          autoComplete="username"
          aria-label="Email"
          placeholder="Please type in your email"
          required
          value={form.email}
          onChange={set('email')}
        />
        <Input
          name="business_name"
          aria-label="Business name"
          placeholder="Please type in your business name"
          required
          value={form.business_name}
          onChange={set('business_name')}
        />
        <div>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            aria-label="Password"
            placeholder="Please type in password"
            required
            value={form.password}
            onChange={set('password')}
          />
          {strength && (
            <p className={`mt-1.5 px-2 text-xs font-semibold ${strength.tone}`}>{strength.label}</p>
          )}
        </div>
        <Input
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          aria-label="Confirm password"
          placeholder="Confirm password"
          required
          value={form.confirm_password}
          onChange={set('confirm_password')}
        />

        <div className="pt-3 text-center">
          <Button
            type="submit"
            caps={false}
            shape="rounded"
            size="lg"
            className="w-3/5 py-3.5"
            loading={busy}
          >
            Register
          </Button>
        </div>

        <p className="pt-1 text-center">
          <Link to="/login" className="text-sm text-ink-700 underline hover:text-ink-900">
            Back to login
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
