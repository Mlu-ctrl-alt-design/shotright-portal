import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, EmptyState } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { INBOX_QUERY, getInboxEntry, listInbox, markRead } from '../../services/inbox'
import { htmlToParagraphs } from '../../utils/htmlToText'
import { clsx } from '../../utils/clsx'

/**
 * Messages: every notification the bench has sent this partner, newest first.
 *
 * A booking or a rating used to reach a partner by email only; if the email
 * went to spam, the portal gave them no second chance to see it. Opening a
 * message marks it read, which is what the nav count is counting.
 */
export default function Messages() {
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState(null)
  const inbox = useQuery({ queryKey: INBOX_QUERY, queryFn: listInbox })

  const markAll = useMutation({
    mutationFn: () => markRead({ all: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INBOX_QUERY }),
  })

  if (inbox.isLoading) return <Spinner />
  if (inbox.isError) return <Alert variant="danger">We couldn't load your messages. Try again in a moment.</Alert>

  const rows = inbox.data || []
  const unread = rows.filter((r) => !r.read).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink-900">Messages</h1>
        {unread > 0 && (
          <Button variant="secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            Mark all as read
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No messages yet" description="New bookings, cancellations and ratings will appear here." />
      ) : (
        <Card>
          <ul className="divide-y divide-ink-100">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  aria-expanded={openId === row.id}
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-canvas"
                >
                  <span
                    aria-hidden="true"
                    className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', row.read ? 'bg-transparent' : 'bg-brand-500')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block text-sm text-ink-900', !row.read && 'font-bold')}>
                      {row.subject}
                      {!row.read && <span className="sr-only"> (unread)</span>}
                    </span>
                    <span className="block text-xs text-ink-500">{formatWhen(row.createdAt)}</span>
                  </span>
                </button>
                {openId === row.id && <MessageBody id={row.id} wasRead={row.read} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function MessageBody({ id, wasRead }) {
  const queryClient = useQueryClient()
  const entry = useQuery({
    queryKey: ['inbox', id],
    queryFn: async () => {
      const found = await getInboxEntry(id)
      if (!wasRead) {
        await markRead({ id })
        queryClient.invalidateQueries({ queryKey: INBOX_QUERY, exact: true })
      }
      return found
    },
  })

  if (entry.isLoading) return <div className="px-4 pb-3"><Spinner /></div>
  if (entry.isError) return <p className="px-9 pb-3 text-sm text-ink-500">This message couldn't be opened.</p>
  return (
    <div className="space-y-2 px-9 pb-4 text-sm text-ink-700">
      {htmlToParagraphs(entry.data.body).map((text, i) => (
        <p key={i}>{text}</p>
      ))}
    </div>
  )
}

function formatWhen(value) {
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
