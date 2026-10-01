import { call, callGet } from './api'
import { withFallback } from './vendor'

/**
 * The partner's messages — their Notification Log on the bench: new bookings,
 * cancellations, ratings and replies (shotright/inbox.py). The same inbox the
 * customer app reads; the bench scopes it to whoever is signed in.
 */
export const LIST_METHOD = 'shotright.api.list_inbox'
export const ENTRY_METHOD = 'shotright.api.get_inbox_entry'
/** shotright #64. On an older bench a message still opens; it just stays unread. */
export const MARK_READ_METHOD = 'shotright.api.mark_inbox_read'

/** One cache for the list, shared by the Messages page and the nav count. */
export const INBOX_QUERY = ['inbox']

const isRead = (row) => row.read === 1 || row.read === true || row.read === '1'

export const listInbox = async () => {
  const rows = (await call(LIST_METHOD)) || []
  return rows.map((row) => ({
    id: row.name,
    subject: row.subject || '(no subject)',
    type: row.type || '',
    createdAt: row.creation || '',
    read: isRead(row),
    /* What the message is about, e.g. 'Venue Claim', so the panel can link to
       the screen that acts on it. Absent on a bench older than claims-owner-side. */
    documentType: row.document_type || '',
  }))
}

export const getInboxEntry = async (id) => {
  const row = await callGet(ENTRY_METHOD, { name: id })
  return { id, subject: row?.subject || '', body: row?.email_content || '' }
}

/** Marks one message read, or all of them with `{all: true}`. Never throws on
 *  an older bench — being unable to mark read must not stop anyone reading. */
export const markRead = ({ id, all = false } = {}) =>
  withFallback(
    MARK_READ_METHOD,
    () => call(MARK_READ_METHOD, all ? { all: 1 } : { name: id }),
    async () => ({ marked: 0 }),
  )
