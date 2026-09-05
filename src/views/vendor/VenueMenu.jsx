import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import {
  useVenue,
  useMenu,
  useCreateHeading,
  useCreateItem,
  useDeleteItem,
  useUpdateItem,
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
  const updateItem = useUpdateItem(venueId)
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
            Your menu hasn’t been lost — customers still see it. Adding items may not work until
            this is back.
          </p>
        </Alert>
      )}

      <Alert variant="success">{notice}</Alert>
      <Alert variant="danger">{importError}</Alert>

      <Card title="Upload your menu">
        <p className="text-sm text-ink-700">
          Start from our template. Headings are created as they appear.
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
                  <MenuItemRow
                    key={item.name}
                    item={item}
                    zar={zar}
                    onSave={(values) => updateItem.mutateAsync({ itemId: item.name, ...values })}
                    onRemove={() => deleteItem.mutateAsync(item.name)}
                  />
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

/**
 * One menu item — readable, then editable in place.
 *
 * ⚠️ A partner could add a dish and delete it, but never CHANGE one. A price
 * typed as R450 instead of R45 had to be removed and retyped, and the delete
 * they'd need for that goes through `frappe.client.delete`, which the Vendor
 * role almost certainly may not call — so the mistake was, in practice, stuck
 * on the menu.
 *
 * THE PRICE FIELD KEEPS THE TYPED STRING. This is the same trap the latitude
 * input fell into: a controlled input whose value comes from a parsed number
 * discards any keystroke that doesn't parse, so "12." loses its point and the
 * partner cannot type a decimal. Prices have decimals. The raw text is held
 * here and parsed on save.
 */
function MenuItemRow({ item, zar, onSave, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    item_name: item.item_name,
    price: String(item.price ?? ''),
    description: item.description || '',
  })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const start = () => {
    setProblem(null)
    setDraft({
      item_name: item.item_name,
      price: String(item.price ?? ''),
      description: item.description || '',
    })
    setEditing(true)
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const result = await onSave({
        item_name: draft.item_name.trim(),
        price: Number(draft.price) || 0,
        description: draft.description.trim(),
      })
      /* `saved: false` is not an exception — it means the bench has no endpoint
         for this. Their typed values stay on screen either way, so nothing has
         to be remembered and retyped from nothing. */
      if (result && result.saved === false) {
        setProblem(
          'We can’t change a menu item just yet. Your wording is still here, so you can copy ' +
            'it into a new item and remove this one.',
        )
        return
      }
      setEditing(false)
    } catch (err) {
      setProblem(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setProblem(null)
    try {
      const result = await onRemove()
      if (result && result.deleted === false) {
        setProblem(
          'We can’t remove menu items just yet, so this one is still on your menu. Nothing has ' +
            'changed.',
        )
      }
    } catch (err) {
      setProblem(err.message)
    }
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{item.item_name}</p>
          {item.description && <p className="truncate text-xs text-ink-500">{item.description}</p>}
          {problem && <p className="mt-1 text-xs font-medium text-red-700">{problem}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="text-sm font-medium text-ink-900">{zar.format(item.price)}</span>
          <button
            type="button"
            onClick={start}
            aria-label={`Edit ${item.item_name}`}
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label={`Remove ${item.item_name}`}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="py-3">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <Input
          label="Item"
          value={draft.item_name}
          onChange={(e) => setDraft((d) => ({ ...d, item_name: e.target.value }))}
          required
          className="min-w-40 flex-1"
        />
        <Input
          label="Price (ZAR)"
          inputMode="decimal"
          value={draft.price}
          onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
          className="w-32"
        />
        <Input
          label="Description"
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          className="min-w-40 flex-1"
        />
        <Button type="submit" size="sm" loading={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
      {problem && <p className="mt-2 text-sm font-medium text-red-700">{problem}</p>}
    </li>
  )
}
