import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import {
  useVenue,
  useMenu,
  useCreateHeading,
  useCreateItem,
  useDeleteItem,
  useImportMenu,
} from '../../hooks/useVendor'
import { Button, Input, Card, Alert, EmptyState } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { MENU_TEMPLATE_HEADERS, buildTemplateCsv } from '../../utils/menuImport'
import { useMenuImport } from '../../hooks/useMenuImport'
import MenuImportStatus from '../../components/ui/MenuImportStatus'

const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })

/**
 * Issue #17 — Vendor adds Products/Menu, including bulk upload.
 *
 * Ownership is enforced server-side (the endpoints resolve the venue through the
 * session's Vendor Profile), so a vendor cannot reach another vendor's menu even
 * by editing the URL.
 */
export default function VenueMenu() {
  const { venueId } = useParams()
  const { data: venue } = useVenue(venueId)
  const { data: menu, isLoading, error } = useMenu(venueId)
  const headings = menu?.headings ?? []
  const menuReadMissing = menu?.unavailable

  const createHeading = useCreateHeading(venueId)
  const createItem = useCreateItem(venueId)
  const deleteItem = useDeleteItem(venueId)
  const importMenu = useImportMenu(venueId)
  const qc = useQueryClient()

  const [newHeading, setNewHeading] = useState('')
  const [drafts, setDrafts] = useState({})
  const [notice, setNotice] = useState(null)
  const [importError, setImportError] = useState(null)

  const draftFor = (headingId) => drafts[headingId] || { item_name: '', price: '', description: '' }
  const setDraft = (headingId, patch) =>
    setDrafts((d) => ({ ...d, [headingId]: { ...draftFor(headingId), ...patch } }))

  const addHeading = async (event) => {
    event.preventDefault()
    if (!newHeading.trim()) return
    await createHeading.mutateAsync(newHeading.trim())
    setNewHeading('')
  }

  const addItem = async (event, headingId) => {
    event.preventDefault()
    const draft = draftFor(headingId)
    if (!draft.item_name.trim()) return
    await createItem.mutateAsync({
      headingId,
      item_name: draft.item_name.trim(),
      price: Number(draft.price) || 0,
      description: draft.description || '',
    })
    setDrafts((d) => ({ ...d, [headingId]: { item_name: '', price: '', description: '' } }))
  }

  const [file, setFile] = useState(null)
  const headingRef = useRef(null)
  const fileInputRef = useRef(null)

  /**
   * The import runs server-side and the partner is invited to leave, so its
   * state cannot live in this component's `useState` — it is picked back up from
   * storage on mount. See `useMenuImport`.
   */
  const menuImport = useMenuImport(venueId, {
    onComplete: () => qc.invalidateQueries({ queryKey: ['menu', venueId] }),
  })

  const onUpload = async (event) => {
    const chosen = event.target.files?.[0]
    event.target.value = '' // let the same file be re-picked after a fix
    if (!chosen) return
    setImportError(null)
    setNotice(null)
    setFile(chosen)
    menuImport.start(chosen)
  }

  /**
   * "Add items by hand" — the escape hatch from a slow import.
   *
   * It stops WATCHING, not the import itself: the rows are still coming, and
   * killing them because the partner got impatient would throw away work they
   * asked for. Duplicates are skipped server-side, so the two paths can safely
   * run at once. Focus lands on the heading field, because a link that says
   * "add by hand" and then leaves you to find the form is not an escape hatch.
   */
  const addManually = () => {
    menuImport.dismiss({ keepRunning: true })
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    headingRef.current?.focus({ preventScroll: true })
  }

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shot-right-menu-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <Spinner label="Loading menu…" />
  if (error) {
    /* A 404 that ISN'T a missing endpoint means this venue is not reachable on
       the account we are signed in as. Frappe's own words for that are
       "DoesNotExistError", which was being printed at a restaurant owner
       verbatim — technically accurate and completely useless to them. */
    const notReachable = error.status === 404
    return (
      <div className="space-y-4">
        <Alert variant="danger">
          <p className="font-bold">
            {notReachable ? 'We couldn’t open this venue’s menu' : 'Something went wrong'}
          </p>
          <p className="mt-1">
            {notReachable
              ? 'This venue isn’t on the account you’re signed in with, or it has been removed. Check the list below — if it’s there, open it from that page.'
              : error.message}
          </p>
        </Alert>
        <Link to="/venues">
          <Button variant="secondary">Back to your venues</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Menu</h1>
          <p className="mt-1 text-sm text-ink-500">{venue?.venue_name}</p>
        </div>
        <Link to="/venues">
          <Button variant="ghost">Back to venues</Button>
        </Link>
      </div>

      {/* The reported "Not found" on opening a menu. A missing ENDPOINT is not
          a missing menu, and saying so is the difference between "the portal
          isn't finished" and "my restaurant's menu has been deleted". Named
          precisely, because the fix is a one-line answer from whoever owns the
          bench: what is this method actually called? */}
      {menuReadMissing && (
        <Alert variant="warning">
          <p className="font-bold">We can’t read this menu from the server yet</p>
          <p className="mt-1">
            Your menu has not been lost — the portal is asking for{' '}
            <code className="rounded bg-white/60 px-1 font-mono text-xs">{menuReadMissing}</code>,
            and this server doesn’t have it. Anything already on this menu is still there and still
            showing to customers. We’ve flagged it; adding items here may not work until it’s
            connected.
          </p>
        </Alert>
      )}

      <Alert variant="success">{notice}</Alert>
      <Alert variant="danger">{importError}</Alert>

      <Card title="Upload your menu">
        <p className="text-sm text-ink-700">
          Start from our template, fill in your dishes, and upload it here. Headings are created
          automatically as they appear.
        </p>
        <p className="mt-1 text-xs text-ink-500">
          Columns:{' '}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs">
            {MENU_TEMPLATE_HEADERS.join(', ')}
          </code>
          . CSV or Excel.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            Download the template
          </Button>
          {/* UNTITLED UI: https://www.untitledui.com/react/components/file-upload */}
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Menu file"
            accept=".csv,text/csv,.xlsx,.xls"
            onChange={onUpload}
            disabled={menuImport.busy}
            className="block min-w-56 flex-1 text-sm text-ink-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100 disabled:opacity-60"
          />
        </div>

        {menuImport.phase !== 'idle' && (
          <div className="mt-4">
            <MenuImportStatus
              {...menuImport}
              fileName={file?.name}
              fileSize={file?.size}
              onAddManually={addManually}
              onCancel={() => menuImport.dismiss({ keepRunning: false })}
              onDismiss={menuImport.reset}
              onReplaceFile={() => {
                // Stop watching, keep the rows already imported, and reopen the
                // picker — a partner who realises they sent last season's menu
                // should not have to hunt for the input again.
                menuImport.dismiss({ keepRunning: false })
                fileInputRef.current?.click()
              }}
            />
          </div>
        )}
      </Card>

      <Card title="Add a heading">
        <form onSubmit={addHeading} className="flex flex-wrap items-end gap-3">
          <Input
            ref={headingRef}
            label="Heading"
            name="heading"
            placeholder="Cocktails"
            className="min-w-56 flex-1"
            value={newHeading}
            onChange={(e) => setNewHeading(e.target.value)}
          />
          <Button type="submit" loading={createHeading.isPending}>
            Add heading
          </Button>
        </form>
      </Card>

      {headings.length === 0 ? (
        <EmptyState
          title="No menu yet"
          description="Add a heading like “Cocktails” or “Mains”, then list items under it."
        />
      ) : (
        headings.map((heading) => (
          <Card key={heading.name} title={heading.heading}>
            {heading.items.length === 0 ? (
              <p className="text-sm text-ink-500">No items under this heading yet.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {heading.items.map((item) => (
                  <li key={item.name} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{item.item_name}</p>
                      {item.description && (
                        <p className="truncate text-xs text-ink-500">{item.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="text-sm font-medium text-ink-900">{zar.format(item.price)}</span>
                      <button
                        type="button"
                        onClick={() => deleteItem.mutate(item.name)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(e) => addItem(e, heading.name)}
              className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-200 pt-4"
            >
              <Input
                label="Item"
                className="min-w-48 flex-1"
                placeholder="Espresso Martini"
                value={draftFor(heading.name).item_name}
                onChange={(e) => setDraft(heading.name, { item_name: e.target.value })}
              />
              <Input
                label="Price (ZAR)"
                type="number"
                min="0"
                step="0.01"
                className="w-32"
                value={draftFor(heading.name).price}
                onChange={(e) => setDraft(heading.name, { price: e.target.value })}
              />
              <Input
                label="Description"
                className="min-w-48 flex-1"
                value={draftFor(heading.name).description}
                onChange={(e) => setDraft(heading.name, { description: e.target.value })}
              />
              <Button type="submit" variant="secondary" loading={createItem.isPending}>
                Add item
              </Button>
            </form>
          </Card>
        ))
      )}
    </div>
  )
}
