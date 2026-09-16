import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { clsx } from '../../utils/clsx'
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
import { MENU_TEMPLATE_HEADERS, buildTemplateCsv } from '../../utils/menuImport'
import { useMenuImport } from '../../hooks/useMenuImport'
import MenuImportStatus from '../../components/ui/MenuImportStatus'
import MenuSkeleton from '../../components/ui/MenuSkeleton'

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
  /* Both folded away once there is a menu to look at, and both forced open
     while there isn't — on an empty menu, putting one in IS the task. */
  const [importOpen, setImportOpen] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  /**
   * The last thing removed, so it can be put back.
   *
   * Lives HERE and not on the row: a successful delete unmounts the row, so a
   * row-owned Undo would disappear at exactly the moment it was needed.
   *
   * ⚠️ Undo RE-CREATES rather than un-deletes — the item comes back with a new
   * id, at the end of its section. The alternative was to hold the delete back
   * for a few seconds so Undo could cancel it, and that was worse: the row
   * would read as gone while the server still had it, which is the exact thing
   * `delete a menu item` in the tests exists to prevent.
   */
  const [undone, setUndone] = useState(null)
  const undoTimer = useRef(null)

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const rememberRemoval = (section, item) => {
    clearTimeout(undoTimer.current)
    setUndone({
      sectionId: section.name,
      sectionLabel: section.heading,
      fields: {
        item_name: item.item_name,
        price: item.price,
        description: item.description || '',
      },
    })
    undoTimer.current = setTimeout(() => setUndone(null), 12000)
  }

  const undoRemoval = async () => {
    if (!undone) return
    clearTimeout(undoTimer.current)
    const restoring = undone
    setUndone(null)
    await createItem.mutateAsync({ headingId: restoring.sectionId, ...restoring.fields })
  }

  const draftFor = (headingId) => drafts[headingId] || { item_name: '', price: '', description: '' }
  const setDraft = (headingId, patch) =>
    setDrafts((d) => ({ ...d, [headingId]: { ...draftFor(headingId), ...patch } }))

  const addHeading = async (event) => {
    event.preventDefault()
    if (!newHeading.trim()) return
    await createHeading.mutateAsync(newHeading.trim())
    setNewHeading('')
    /* The form deliberately STAYS OPEN. Adding four sections in a row is the
       normal first-run task, and folding it away after each one turns that into
       four extra clicks. It clears and keeps focus instead.

       `setAddingSection(true)` matters on the FIRST one: until then the form is
       on screen only because the menu is empty, and adding a heading makes it
       non-empty — so without this the form the partner is typing into vanishes
       from under them the moment it works. */
    setAddingSection(true)
    headingRef.current?.focus({ preventScroll: true })
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
    setAddingSection(true)
    // The form may not be mounted yet when this runs.
    requestAnimationFrame(() => {
      headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      headingRef.current?.focus({ preventScroll: true })
    })
  }

  /* Opening the form and then leaving the partner to find it is not an
     affordance, so focus follows the disclosure. */
  const openSectionForm = () => {
    setAddingSection(true)
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
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

  if (isLoading) return <MenuSkeleton />
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

  const sections = headings
  const totalItems = sections.reduce((n, h) => n + (h.items?.length || 0), 0)
  const emptySections = sections.filter((h) => (h.items?.length || 0) === 0)

  return (
    <div className="space-y-6">
      {/* The menu is the subject of this page, so it comes first and the ways
          of adding to it are actions in the header. This screen used to open on
          three empty forms — upload, add a heading, add an item — with the
          partner's own menu below all of them. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Menu</h1>
          <p className="mt-1 text-sm text-ink-500">
            {sections.length === 0
              ? venue?.venue_name
              : `${totalItems} ${totalItems === 1 ? 'item' : 'items'} in ${sections.length} ${
                  sections.length === 1 ? 'section' : 'sections'
                }`}
          </p>
        </div>
        {sections.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setImportOpen((v) => !v)}
              aria-expanded={importOpen}
            >
              Import a spreadsheet
            </Button>
            <Button size="sm" onClick={openSectionForm} aria-expanded={addingSection}>
              Add a section
            </Button>
          </div>
        )}
      </div>

      {/* A missing ENDPOINT is not a missing menu. */}
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

      {/* Open by default on an empty menu, because then it IS the task; folded
          away once there is a menu, because then it is an occasional one. */}
      {(importOpen || sections.length === 0) && (
        <Card title="Import a spreadsheet">
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
                  menuImport.dismiss({ keepRunning: false })
                  fileInputRef.current?.click()
                }}
              />
            </div>
          )}
        </Card>
      )}

      {(addingSection || sections.length === 0) && (
        <Card title="Add a section">
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
      )}

      {sections.length === 0 ? (
        <EmptyState
          title="No menu yet"
          description="Customers open the Menu tab more than any other."
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
          {/* The rail is a summary, not navigation: the counts are the point.
              A section with nothing under it is a blank tab in the customer app,
              and that is invisible from here without them. */}
          <Card title="Sections" className="hidden lg:block">
            <ul className="-my-1 text-sm">
              <li className="flex items-center justify-between gap-3 py-1.5 font-semibold">
                <span>All items</span>
                <span className="text-ink-500">{totalItems}</span>
              </li>
              {sections.map((section) => {
                const count = section.items?.length || 0
                return (
                  <li
                    key={section.name}
                    className="flex items-center justify-between gap-3 py-1.5 text-ink-700"
                  >
                    <span className="truncate">{section.heading}</span>
                    <span className={count === 0 ? 'font-semibold text-brand-700' : 'text-ink-500'}>
                      {count}
                    </span>
                  </li>
                )
              })}
            </ul>
            {emptySections.length > 0 && (
              <p className="mt-4 border-t border-brand-100 pt-3 text-xs text-ink-700">
                {emptySections.length === 1
                  ? `${emptySections[0].heading} is empty, so customers see a blank tab.`
                  : `${emptySections.length} sections are empty, so customers see blank tabs.`}
              </p>
            )}
          </Card>

          <div className="space-y-6">
            {sections.map((section) => (
              <Card key={section.name} title={section.heading}>
                {undone?.sectionId === section.name && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-50 px-4 py-3">
                    <p className="text-sm text-ink-900">
                      Removed <span className="font-semibold">{undone.fields.item_name}</span>.
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={undoRemoval}
                      loading={createItem.isPending}
                    >
                      Undo
                    </Button>
                  </div>
                )}

                {section.items.length === 0 ? (
                  <p className="text-sm text-ink-700">
                    Nothing here yet — customers see this as an empty tab.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-200">
                    {section.items.map((item) => (
                      <MenuItemRow
                        key={item.name}
                        item={item}
                        zar={zar}
                        onSave={(values) => updateItem.mutateAsync({ itemId: item.name, ...values })}
                        onRemove={async () => {
                          const result = await deleteItem.mutateAsync(item.name)
                          /* `deleted: false` means the bench refused and the
                             item is still there — nothing to undo. */
                          if (!result || result.deleted !== false) {
                            rememberRemoval(section, item)
                          }
                          return result
                        }}
                      />
                    ))}
                  </ul>
                )}

                <form
                  onSubmit={(e) => addItem(e, section.name)}
                  className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-200 pt-4"
                >
                  <Input
                    label="Item"
                    className="min-w-48 flex-1"
                    placeholder="Espresso Martini"
                    value={draftFor(section.name).item_name}
                    onChange={(e) => setDraft(section.name, { item_name: e.target.value })}
                  />
                  <Input
                    label="Price (ZAR)"
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-32"
                    value={draftFor(section.name).price}
                    onChange={(e) => setDraft(section.name, { price: e.target.value })}
                  />
                  <Input
                    label="Description"
                    className="min-w-48 flex-1"
                    value={draftFor(section.name).description}
                    onChange={(e) => setDraft(section.name, { description: e.target.value })}
                  />
                  <Button type="submit" variant="secondary" loading={createItem.isPending}>
                    Add item
                  </Button>
                </form>
              </Card>
            ))}
          </div>
        </div>
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
  /* idle | saving | saved | failed. One value rather than three booleans,
     because the states are mutually exclusive and two of them used to be
     representable at once. */
  const [status, setStatus] = useState('idle')
  const [problem, setProblem] = useState(null)
  const savedTimer = useRef(null)

  useEffect(() => () => clearTimeout(savedTimer.current), [])

  const busy = status === 'saving'

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
    event?.preventDefault()
    setStatus('saving')
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
        setStatus('failed')
        setProblem('We can’t change a menu item yet. Your wording is still here.')
        return
      }
      setEditing(false)
      /* Said ON the row, briefly, rather than as a toast. A confirmation that
         appears somewhere else and then leaves is a confirmation nobody sees. */
      setStatus('saved')
      savedTimer.current = setTimeout(() => setStatus('idle'), 4000)
    } catch (err) {
      /* Deliberately stays in `editing`. The typed values are the partner's
         work, and throwing them away to show an error message means they retype
         from memory to try again. */
      setStatus('failed')
      setProblem(err.message)
    }
  }

  /* The way out of a failure that will not clear: put the row back as it was. */
  const discard = () => {
    setDraft({
      item_name: item.item_name,
      price: String(item.price ?? ''),
      description: item.description || '',
    })
    setProblem(null)
    setStatus('idle')
    setEditing(false)
  }

  const remove = async () => {
    setProblem(null)
    try {
      const result = await onRemove()
      if (result && result.deleted === false) {
        setProblem('We can’t remove menu items yet, so this one is still on your menu.')
      }
    } catch (err) {
      setProblem(err.message)
    }
  }

  if (!editing) {
    return (
      <li
        className={clsx(
          'flex items-center justify-between gap-4 rounded-xl px-2 py-3 transition-colors',
          // The row stays exactly where it is and dims. A spinner over the list
          // moves everything and hides the thing being changed.
          status === 'saving' && 'opacity-55',
          status === 'saved' && 'bg-green-50',
        )}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{item.item_name}</p>
          {item.description && <p className="truncate text-xs text-ink-500">{item.description}</p>}
          {problem && <p className="mt-1 text-xs font-medium text-red-700">{problem}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
              <svg viewBox="0 0 20 20" className="size-3.5 fill-none stroke-current stroke-[2.2]" aria-hidden="true">
                <path d="M4.5 10.5 8.5 14.5 15.5 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Saved
            </span>
          )}
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
          {status === 'failed' ? 'Try again' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={discard} disabled={busy}>
          {status === 'failed' ? 'Discard the change' : 'Cancel'}
        </Button>
      </form>
      {problem && (
        <p className="mt-2 text-sm font-medium text-red-700" role="alert">
          {problem} Nothing here has been sent, so you can change it and try again.
        </p>
      )}
    </li>
  )
}
