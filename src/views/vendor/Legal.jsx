import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { acceptDocument } from '../../services/legal'
import { LEGAL_QUERY_KEY, useLegalStanding } from '../../hooks/useLegalStanding'

/**
 * Read, then accept.
 *
 * The order is the whole design. A screen that leads with a tickbox and hides
 * the text behind a link has collected a click, not an agreement — so each
 * document is on the page, open, and the control to accept it sits underneath
 * the words it refers to rather than above them.
 *
 * Three things this screen refuses to do:
 *
 *   - offer a tickbox over a document whose text did not load. Consent to an
 *     unread document is not consent, and a partner cannot tell the difference
 *     between "empty" and "failed to arrive" — we can, so it is ours to say.
 *   - accept several documents on one tick. If there are Terms and a Privacy
 *     Policy, they are two agreements and they get two decisions.
 *   - say "accepted" on anything but a confirmed, read-back server record. See
 *     `services/legal.js` — the read-back is the point of that file.
 */

const stamp = (value) => {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

function DocumentCard({ document, onAccepted }) {
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState(null)

  const readable = Boolean(document.body || document.url)

  const accept = async () => {
    setSaving(true)
    setProblem(null)
    const result = await acceptDocument(document)
    setSaving(false)
    if (result.recorded) return onAccepted()
    setProblem(result.reason)
  }

  const subtitle = [
    document.version && `Version ${document.version}`,
    document.effectiveOn && `In effect from ${stamp(document.effectiveOn)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card title={document.title} className="mt-6 first:mt-0">
      {subtitle && <p className="-mt-2 text-xs text-ink-500">{subtitle}</p>}

      {document.accepted ? (
        <Alert variant="success" className="mt-3">
          <p className="font-bold">You accepted this{document.version ? ` (version ${document.version})` : ''}</p>
          {document.acceptedOn && <p className="mt-1">On {stamp(document.acceptedOn)}.</p>}
        </Alert>
      ) : null}

      {document.body ? (
        /* Staff-authored copy off our own bench, rendered the same way the
           wizard renders a partner's own summary. It must be sanitised
           server-side on save — the same requirement RichTextEditor carries. */
        <div
          className="prose-editor mt-4 max-h-96 overflow-y-auto rounded-lg bg-canvas p-4 text-sm text-ink-900"
          dangerouslySetInnerHTML={{ __html: document.body }}
        />
      ) : document.url ? (
        <p className="mt-4 text-sm text-ink-700">
          <a className="text-brand-700 underline" href={document.url} target="_blank" rel="noreferrer">
            Open {document.title}
          </a>{' '}
          to read it in full.
        </p>
      ) : (
        <Alert variant="warning" className="mt-4">
          <p className="font-bold">We can’t show you this document right now</p>
          <p className="mt-1">
            We won’t ask you to agree to something you can’t read. Try again shortly.
          </p>
        </Alert>
      )}

      {!document.accepted && readable && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <label className="flex items-start gap-3 text-sm text-ink-900">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I have read and accept the {document.title}
              {document.version ? ` (version ${document.version})` : ''}.
            </span>
          </label>

          <Button className="mt-4" onClick={accept} disabled={!confirmed || saving} loading={saving}>
            {saving ? 'Recording…' : 'Accept'}
          </Button>

          {/* Every branch here is a case where the tick happened and the record
              did not. Saying "accepted" over any of them would put an agreement
              on file that does not exist. */}
          {problem && (
            <Alert variant="danger" className="mt-4">
              <p className="font-bold">We couldn’t record that</p>
              <p className="mt-1">
                {problem === 'no-endpoint'
                  ? 'Accepting isn’t working here yet, so we haven’t saved anything — we’d rather tell you than show you a tick that isn’t real. You can carry on with your venues in the meantime.'
                  : problem === 'not-persisted' || problem === 'unverifiable'
                    ? 'Your acceptance didn’t save, so we haven’t marked it as done. Nothing else has changed. Please try again.'
                    : 'Something went wrong on our side and nothing was saved. Please try again.'}
              </p>
            </Alert>
          )}
        </div>
      )}
    </Card>
  )
}

export default function Legal() {
  const queryClient = useQueryClient()
  const { standing, outstanding, isLoading } = useLegalStanding()
  const [params] = useSearchParams()
  /* The wizard sends people here when a submit is blocked. Knowing why you were
     moved is the difference between a rule and an interruption. */
  const cameFromSubmit = params.get('from') === 'submit'

  const refresh = () => queryClient.invalidateQueries({ queryKey: LEGAL_QUERY_KEY })

  if (isLoading) return <Spinner label="Loading documents…" />

  if (!standing?.available) {
    return (
      <Card title="Terms and policies">
        <Alert variant="info">
          <p className="font-bold">We can’t show these right now</p>
          <p className="mt-1">
            Nothing you need to do has changed, and nothing about your venues is affected. Please
            check back shortly.
          </p>
        </Alert>
      </Card>
    )
  }

  if (!standing.documents.length) {
    return (
      <Card title="Terms and policies">
        <p className="text-sm text-ink-700">There’s nothing for you to accept at the moment.</p>
      </Card>
    )
  }

  return (
    <div className="py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink-900">Terms and policies</h1>
        <p className="mt-1 text-sm text-ink-700">
          {outstanding.length
            ? 'Please read each one and accept it below. Take as long as you need — nothing is submitted until you press Accept.'
            : 'You’re up to date. These are the documents you’ve accepted, kept here so you can read them again whenever you want.'}
        </p>
      </header>

      {cameFromSubmit && outstanding.length > 0 && (
        <Alert variant="warning" className="mb-6">
          <p className="font-bold">This is the one thing standing between your venue and our reviewers</p>
          <p className="mt-1">
            Everything you filled in has been kept. Accept below and your venue goes straight
            through — you won’t have to do any of it again.
          </p>
        </Alert>
      )}

      {standing.documents.map((document) => (
        <DocumentCard key={document.id} document={document} onAccepted={refresh} />
      ))}

      {!outstanding.length && (
        <p className="mt-6 text-sm text-ink-700">
          <Link className="text-brand-700 underline" to="/">
            Back to your dashboard
          </Link>
        </p>
      )}
    </div>
  )
}
