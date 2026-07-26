import { useState, useEffect, useRef } from 'react'
import { useProfile, useUpdateProfile } from '../../hooks/useVendor'
import { useAuthStore } from '../../store/authStore'
import { Button, Input, PasswordInput, Card, Alert } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'

/**
 * Issue #19 — Vendor profile edit.
 *
 * Two separate submissions on purpose: profile fields and credentials travel on
 * different endpoints. The password is sent once, over the authenticated
 * session, and is never held in the store, cached by TanStack Query, or echoed
 * back by the server — the update goes through Frappe's own credential handling.
 */
const FIELD_LABELS = {
  vendor_name: 'your name',
  business_name: 'business name',
  phone: 'phone',
}

/** "your name", "your name and phone", "your name, business name and phone" */
const LABELS_FOR = (keys) => {
  const words = keys.map((k) => FIELD_LABELS[k] || k)
  if (words.length === 1) return words[0]
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export default function Profile() {
  const { data: profile, isLoading, error } = useProfile()
  const updateProfile = useUpdateProfile()
  const setStoreProfile = useAuthStore((s) => s.setProfile)

  const [form, setForm] = useState({ vendor_name: '', business_name: '', phone: '' })
  const [passwords, setPasswords] = useState({ new_password: '', confirm: '' })
  const [notice, setNotice] = useState(null)
  const [formError, setFormError] = useState(null)
  const [warning, setWarning] = useState(null)
  const dirty = useRef(false)

  /**
   * Seed the form from the server, but never overwrite what the partner is
   * currently typing.
   *
   * This used to run on every change of `profile`, and TanStack Query refetches
   * on window focus — so alt-tabbing away mid-edit and back silently wiped the
   * form. `dirty` is cleared after a save, which is what lets the fresh
   * server values land once the round trip finishes.
   */
  useEffect(() => {
    if (!profile || dirty.current) return
    setForm({
      vendor_name: profile.vendor_name || '',
      business_name: profile.business_name || '',
      phone: profile.phone || '',
    })
  }, [profile])

  const set = (key) => (e) => {
    dirty.current = true
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  /**
   * Save, then check the bench actually kept it.
   *
   * A 200 from `update_vendor_profile` does not mean the field was stored:
   * Frappe drops kwargs a whitelisted method does not declare, so a field named
   * wrongly is a silent no-op. This screen used to report "Profile updated."
   * on the strength of that 200 and then re-render the old value — which is how
   * "it doesn't persist" looked from the outside, with nothing to point at.
   *
   * `updateProfile` returns the profile re-read AFTER the write, so comparing is
   * cheap and the answer is authoritative.
   */
  const saveDetails = async (event) => {
    event.preventDefault()
    setNotice(null)
    setFormError(null)
    setWarning(null)
    try {
      const saved = await updateProfile.mutateAsync(form)
      dirty.current = false
      setStoreProfile(saved)

      const missed = ['vendor_name', 'business_name', 'phone'].filter(
        (key) => (form[key] || '').trim() && (saved?.[key] || '').trim() !== form[key].trim(),
      )

      if (missed.length) {
        setForm({
          vendor_name: saved?.vendor_name || '',
          business_name: saved?.business_name || '',
          phone: saved?.phone || '',
        })
        setWarning(
          `Saved, but ${LABELS_FOR(missed)} did not stick — the app couldn't store ` +
            `${missed.length === 1 ? 'that field' : 'those fields'} yet. Everything else was saved. ` +
            `Please let the Sho’t Right team know.`,
        )
        return
      }

      setNotice('Profile updated.')
    } catch (err) {
      setFormError(err.message)
    }
  }

  const savePassword = async (event) => {
    event.preventDefault()
    setNotice(null)
    setFormError(null)

    if (passwords.new_password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (passwords.new_password !== passwords.confirm) {
      setFormError('Passwords do not match.')
      return
    }

    try {
      await updateProfile.mutateAsync({ new_password: passwords.new_password })
      setPasswords({ new_password: '', confirm: '' })
      setNotice('Password changed.')
    } catch (err) {
      setFormError(err.message)
    }
  }

  if (isLoading) return <Spinner label="Loading profile…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink-900">Profile</h1>

      <Alert variant="success">{notice}</Alert>
      <Alert variant="warning">{warning}</Alert>
      <Alert variant="danger">{formError}</Alert>

      <Card title="Your details">
        <form onSubmit={saveDetails} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Your name" name="vendor_name" required value={form.vendor_name} onChange={set('vendor_name')} />
            <Input label="Business name" name="business_name" value={form.business_name} onChange={set('business_name')} />
          </div>
          <Input label="Phone" name="phone" type="tel" value={form.phone} onChange={set('phone')} />
          <Input
            label="Email"
            name="email"
            value={profile?.email || ''}
            disabled
            hint="Your email is your sign-in identity and can't be changed here."
          />
          <Button type="submit" loading={updateProfile.isPending}>
            Save changes
          </Button>
        </form>
      </Card>

      <Card title="Change password">
        <form onSubmit={savePassword} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordInput
              label="New password"
              name="new_password"
              autoComplete="new-password"
              required
              hint="At least 8 characters."
              value={passwords.new_password}
              onChange={(e) => setPasswords((p) => ({ ...p, new_password: e.target.value }))}
            />
            <PasswordInput
              label="Confirm password"
              name="confirm"
              autoComplete="new-password"
              required
              value={passwords.confirm}
              onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
            />
          </div>
          <Button type="submit" variant="secondary" loading={updateProfile.isPending}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  )
}
