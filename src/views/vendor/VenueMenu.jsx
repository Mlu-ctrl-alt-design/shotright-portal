import { useState } from 'react'
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
import { parseMenuFile, MENU_TEMPLATE_HEADERS } from '../../utils/menuImport'

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
  const { data: headings = [], isLoading, error } = useMenu(venueId)

  const createHeading = useCreateHeading(venueId)
  const createItem = useCreateItem(venueId)
  const deleteItem = useDeleteItem(venueId)
  const importMenu = useImportMenu(venueId)

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

  const onUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // let the same file be re-picked after a fix
    if (!file) return

    setImportError(null)
    setNotice(null)
    try {
      const rows = await parseMenuFile(file)
      const { created } = await importMenu.mutateAsync(rows)
      setNotice(`Imported ${created} item${created === 1 ? '' : 's'}.`)
    } catch (err) {
      setImportError(err.message)
    }
  }

  if (isLoading) return <Spinner label="Loading menu…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

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

      <Alert variant="success">{notice}</Alert>
      <Alert variant="danger">{importError}</Alert>

      <Card title="Bulk upload">
        <p className="text-sm text-ink-500">
          Upload a CSV with the columns{' '}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs">
            {MENU_TEMPLATE_HEADERS.join(', ')}
          </code>
          . Headings are created automatically as they appear.
        </p>
        <p className="mt-2 text-xs text-ink-500">
          Exporting your spreadsheet as CSV keeps the import dependency-free. An .xlsx path can be
          added later with SheetJS if vendors need it.
        </p>
        <div className="mt-4 flex items-center gap-3">
          {/* UNTITLED UI: https://www.untitledui.com/react/components/file-upload */}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onUpload}
            disabled={importMenu.isPending}
            className="block w-full text-sm text-ink-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
          {importMenu.isPending && <Spinner />}
        </div>
      </Card>

      <Card title="Add a heading">
        <form onSubmit={addHeading} className="flex flex-wrap items-end gap-3">
          <Input
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
