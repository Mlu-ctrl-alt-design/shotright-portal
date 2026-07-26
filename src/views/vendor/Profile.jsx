import { useState, useEffect } from 'react'
import { useProfile, useUpdateProfile } from '../../hooks/useVendor'
import { useAuthStore } from '../../store/authStore'
import { Button, Input, Card, Alert } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'

/**
 * Issue #19 — Vendor profile edit.
 *
 * Two separate submissions on purpose: profile fields and credentials travel on
 * different endpoints. The password is sent once, over the authenticated
 * session, and is never held in the store, cached by TanStack Query, or echoed
 * back by the server — the update goes through Frappe's own credential handling.
 */
export default function Profile() {
  const { data: profile, isLoading, error } = useProfile()
  const updateProfile = useUpdateProfile()
  const setStoreProfile = useAuthStore((s) => s.setProfile)

  const [form, setForm] = useState({ vendor_name: '', business_name: '', phone: '' })
  const [passwords, setPasswords] = useState({ new_password: '', confirm: '' })
  const [notice, setNotice] = useState(null)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    if (profile) {
      setForm({
        vendor_name: profile.vendor_name || '',
        business_name: profile.business_name || '',
        phone: profile.phone || '',
      })
    }
  }, [profile])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const saveDetails = async (event) => {
    event.preventDefault()
    setNotice(null)
    setFormError(null)
    try {
      const updated = await updateProfile.mutateAsync(form)
      setStoreProfile(updated)
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
            <Input
              label="New password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              hint="At least 8 characters."
              value={passwords.new_password}
              onChange={(e) => setPasswords((p) => ({ ...p, new_password: e.target.value }))}
            />
            <Input
              label="Confirm password"
              name="confirm"
              type="password"
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
