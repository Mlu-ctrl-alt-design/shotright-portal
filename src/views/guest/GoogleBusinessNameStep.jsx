import { useState } from 'react'
import { Button, Input, Alert } from '../../components/ui'

/**
 * The one thing Google can't tell us: what the partner's business is called.
 *
 * Shown when `login_vendor_with_google` answers `business_name_required` —
 * Google has proved the address, but there is no partner account yet and the
 * bench will not make one without a business name. Nothing has been created at
 * this point, so "Back" really is a clean way out.
 *
 * The same Google credential is reused for the second call. It is valid for
 * about an hour; if it has expired the bench refuses it and the partner sees
 * that error here and can press Google again.
 */
export default function GoogleBusinessNameStep({ email, initialName = '', onSubmit, onBack }) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Please type in your business name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-xl font-bold tracking-tight text-ink-900">One last thing</h1>
        <p className="mt-2 text-sm text-ink-700">
          You’re signing up as <span className="font-semibold">{email}</span>. What’s your
          business called?
        </p>
      </div>

      <Alert variant="danger">{error}</Alert>

      <Input
        label="Business name"
        shape="rounded"
        name="business_name"
        autoFocus
        placeholder="e.g. Thandi’s Bistro"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <Button type="submit" caps={false} shape="rounded" size="lg" className="w-full" loading={busy}>
        {busy ? 'Creating your account…' : 'Create my partner account'}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-ink-700 underline hover:text-ink-900"
      >
        Back
      </button>
    </form>
  )
}
