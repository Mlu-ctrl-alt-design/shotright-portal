import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Input, Select, Textarea } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { useAuthStore } from '../../store/authStore'
import { rememberReturnTo } from '../../services/returnTo'
import {
  CLAIMANT_ROLES,
  EVIDENCE_ACCEPT,
  MAX_EVIDENCE_FILES,
  MAX_EVIDENCE_MB,
  MY_CLAIMS_QUERY,
  fileClaim,
  listEvidence,
  removeEvidence,
  resolveHandoff,
  sendClaimCode,
  uploadEvidence,
} from '../../services/claims'

/**
 * `/claim/<token>` — where every venue claim is finished.
 *
 * Reached two ways: the customer app opens it in the browser after someone taps
 * "this is my venue", and the portal's own search at `/claim` navigates here.
 * The token IS the authorisation until the claim is filed, so the page reads
 * the claim as a guest first and only then asks who you are.
 *
 * The person holding the link may not have a partner account yet — they were in
 * the customer app a moment ago. So a guest sees the venue's name and a way to
 * sign up or sign in that brings them back HERE afterwards, however long the
 * road (register → verify email is two screens and a detour to their inbox).
 *
 * Filing proves the partner's address with a "Venue Claim" code. The address
 * may differ from the one they use in the customer app, which is on purpose:
 * people book tables on a personal address and trade on a business one.
 */
export default function ClaimHandoff() {
  const { token } = useParams()
  const status = useAuthStore((s) => s.status)
  const handoff = useQuery({
    queryKey: ['venue-claims', 'handoff', token],
    queryFn: () => resolveHandoff(token),
    staleTime: Infinity,
  })
  const [filed, setFiled] = useState(null)

  if (filed) return <Filed filed={filed} venueName={handoff.data?.venueName} />
  if (handoff.isLoading) return <Spinner label="Opening your claim…" />
  if (handoff.isError) return <DeadLink message={handoff.error.message} signedIn={status === 'authenticated'} />

  const venueName = handoff.data.venueName

  if (status !== 'authenticated') return <GuestIntro token={token} venueName={venueName} />

  return <ClaimForm token={token} venueName={venueName} onFiled={setFiled} />
}

function Heading({ venueName }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Claim your venue</p>
      <h1 className="mt-1 text-2xl font-bold text-ink-900">{venueName}</h1>
    </div>
  )
}

function DeadLink({ message, signedIn }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900">This claim link can&rsquo;t be used</h1>
      <Alert variant="warning">{message}</Alert>
      <p className="text-sm text-ink-700">
        Links last three days and work once. If you&rsquo;ve already sent this claim, it&rsquo;s under{' '}
        <strong>Your claims</strong>. Otherwise, find your venue again and start a new claim.
      </p>
      {/* Guests pass through /login on the way, and come back to the search. */}
      <Link
        to="/claim"
        onClick={() => !signedIn && rememberReturnTo('/claim')}
        className="inline-block text-sm font-semibold text-ink-900 underline"
      >
        Find your venue
      </Link>
    </div>
  )
}

function GuestIntro({ token, venueName }) {
  const here = `/claim/${token}`
  const remember = () => rememberReturnTo(here)
  return (
    <div className="space-y-5">
      <Heading venueName={venueName} />
      <p className="text-sm leading-relaxed text-ink-700">
        To claim this venue you need a Sho&rsquo;t Right partner account. It&rsquo;s free, and it&rsquo;s where
        you&rsquo;ll add photos, your menu and take bookings once the venue is yours.
      </p>
      <p className="text-sm leading-relaxed text-ink-700">
        Use your <strong>business</strong> email address if you have one. It doesn&rsquo;t need to match the
        one you use in the Sho&rsquo;t Right app.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button as={Link} to="/register" state={{ from: here }} onClick={remember}>
          Create a partner account
        </Button>
        <Button as={Link} to="/login" state={{ from: here }} onClick={remember} variant="secondary">
          I already have one
        </Button>
      </div>
    </div>
  )
}

function ClaimForm({ token, venueName, onFiled }) {
  const email = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [role, setRole] = useState('')
  const [note, setNote] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [roleError, setRoleError] = useState(null)

  const send = useMutation({
    mutationFn: () => sendClaimCode(email),
    onSuccess: () => setCodeSent(true),
  })

  const submit = useMutation({
    mutationFn: () => fileClaim({ token, code: code.trim(), role, note: note.trim() }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: MY_CLAIMS_QUERY })
      onFiled(result)
    },
    onError: () => setCode(''),
  })

  const onSubmit = (event) => {
    event.preventDefault()
    if (!role) {
      setRoleError('Tell us how you’re connected to the venue.')
      return
    }
    if (!codeSent) {
      send.mutate()
      return
    }
    if (code.trim().length < 6) return
    submit.mutate()
  }

  return (
    <div className="space-y-6">
      <Heading venueName={venueName} />
      <p className="max-w-2xl text-sm text-ink-700">
        Tell us who you are and send us something that shows the venue is yours. A person at Sho&rsquo;t Right
        checks every claim, usually the same day, and emails you the answer.
      </p>

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Card title="1. You and the venue">
          <div className="space-y-4">
            <Select
              label="Your role"
              aria-label="Your role"
              value={role}
              error={roleError}
              onChange={(e) => {
                setRole(e.target.value)
                setRoleError(null)
              }}
            >
              <option value="">Choose one</option>
              {CLAIMANT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Textarea
              label="Anything we should know (optional)"
              aria-label="Anything we should know"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example: I bought the business in 2024, or the listing has our old name."
            />
          </div>
        </Card>

        <Card title="2. Proof it's yours">
          <p className="mb-4 text-sm text-ink-500">
            A business registration, liquor licence, lease or a recent utility bill in the venue&rsquo;s name. PDF
            or a photo, up to {MAX_EVIDENCE_FILES} files of {MAX_EVIDENCE_MB} MB each. Only the Sho&rsquo;t Right
            team can see these, and we delete them 90 days after we decide.
          </p>
          <Evidence handle={token} />
        </Card>

        <Card title="3. Confirm your email">
          <div className="space-y-4">
            <p className="text-sm text-ink-700">
              We&rsquo;ll send a 6-digit code to <strong>{email}</strong>.
            </p>
            {codeSent && (
              <Input
                label="Code"
                aria-label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                hint="Check your spam folder if it hasn't arrived in a minute."
              />
            )}
            <Alert variant="danger">{send.error?.message || submit.error?.message}</Alert>
            <div className="flex flex-wrap gap-3">
              {codeSent ? (
                <>
                  <Button type="submit" disabled={submit.isPending || code.trim().length < 6}>
                    {submit.isPending ? 'Sending…' : 'Submit claim'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => send.mutate()} disabled={send.isPending}>
                    Send a new code
                  </Button>
                </>
              ) : (
                <Button type="submit" disabled={send.isPending}>
                  {send.isPending ? 'Sending…' : 'Send code'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </form>
    </div>
  )
}

/**
 * The claimant's own documents. `handle` is the token before filing and the
 * claim's docname after, so the same list works on both sides of Submit.
 */
function Evidence({ handle }) {
  const queryClient = useQueryClient()
  const inputRef = useRef(null)
  const key = ['venue-claims', 'evidence', handle]
  const files = useQuery({ queryKey: key, queryFn: () => listEvidence(handle) })

  const add = useMutation({
    mutationFn: (file) => uploadEvidence(handle, file),
    onSuccess: (rows) => queryClient.setQueryData(key, rows),
  })
  const remove = useMutation({
    mutationFn: (fileId) => removeEvidence(handle, fileId),
    onSuccess: (rows) => queryClient.setQueryData(key, rows),
  })

  const rows = files.data || []
  const full = rows.length >= MAX_EVIDENCE_FILES

  const onPick = async (event) => {
    // One at a time, in order, so the bench's per-claim limit refuses the
    // seventh file with its own message rather than racing six uploads.
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    for (const file of picked) {
      try {
        await add.mutateAsync(file)
      } catch {
        break
      }
    }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <ul aria-label="Documents sent" className="divide-y divide-ink-100 rounded-2xl ring-1 ring-ink-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-ink-900">{row.name}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-red-700 hover:underline"
                aria-label={`Remove ${row.name}`}
                onClick={() => remove.mutate(row.id)}
                disabled={remove.isPending}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <Alert variant="danger">{add.error?.message || remove.error?.message}</Alert>
      <input
        ref={inputRef}
        type="file"
        accept={EVIDENCE_ACCEPT}
        multiple
        className="sr-only"
        aria-label="Add a document"
        onChange={onPick}
        tabIndex={-1}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={full || add.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {add.isPending ? 'Uploading…' : full ? `${MAX_EVIDENCE_FILES} documents added` : 'Add a document'}
      </Button>
    </div>
  )
}

function Filed({ filed, venueName }) {
  return (
    <div className="space-y-6">
      <Heading venueName={venueName || 'Your claim'} />
      <Alert variant="success">
        Claim sent. We&rsquo;ll email you as soon as we&rsquo;ve looked at it, usually the same day.
      </Alert>
      {filed.disputed && (
        <p className="text-sm text-ink-700">
          Another partner has already listed this venue, so we&rsquo;ll look at both sides before deciding. Clear
          proof that it&rsquo;s yours makes this much quicker.
        </p>
      )}
      <Card title="Documents">
        <p className="mb-4 text-sm text-ink-500">You can still add or remove documents until we decide.</p>
        <Evidence handle={filed.claim} />
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button as={Link} to="/claim" variant="secondary">
          See your claims
        </Button>
        <Button as={Link} to="/">
          Go to your dashboard
        </Button>
      </div>
    </div>
  )
}
