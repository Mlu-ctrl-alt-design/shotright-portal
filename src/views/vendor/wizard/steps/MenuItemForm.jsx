import { lazy, Suspense, useRef, useState } from 'react'
import { uploadMenuImage } from '../../../../services/vendor'
import { Button, Input, Alert } from '../../../../components/ui'
import Spinner from '../../../../components/ui/Spinner'

const RichTextEditor = lazy(() => import('../../../../components/ui/RichTextEditor'))

/**
 * Add / edit a single menu item.
 *
 * Matches `edit a menu item.png`: a picture well labelled "SELECT TO UPDATE
 * IMAGE", name, price, and rich-text details, with Cancel / Delete / Save.
 *
 * The photo uploads as soon as it is chosen rather than on save (C4). The
 * wizard has no venue id yet, so the File is created unattached and linked on
 * submit — which also means the partner sees their photo straight away instead
 * of only after finishing the whole wizard.
 */
export default function MenuItemForm({ item, onSave, onDelete, onCancel }) {
  const [draft, setDraft] = useState(
    item ?? { id: null, name: '', price: '', details: '', image: '' },
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const pickImage = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { file_url } = await uploadMenuImage(file)
      setDraft((d) => ({ ...d, image: file_url }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const submit = () => {
    if (!draft.name.trim()) return setError('Give the item a name.')
    const price = Number(String(draft.price).replace(/[R\s,]/g, ''))
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price.')
    onSave({ ...draft, name: draft.name.trim(), price })
  }

  return (
    <div className="space-y-5 rounded-3xl bg-tint p-6">
      <div className="flex flex-wrap items-start gap-6">
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-28 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-brand-edge bg-white transition hover:bg-brand-50"
          >
            {uploading ? (
              <Spinner />
            ) : draft.image ? (
              <img src={draft.image} alt="" className="size-full object-cover" />
            ) : (
              <span className="px-2 text-center text-[10px] font-bold tracking-wide text-brand-ink uppercase">
                Select image
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={pickImage}
          />
          {draft.image && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 block w-28 text-center text-[10px] font-bold tracking-wide text-brand-ink uppercase hover:text-brand-ink"
            >
              Update image
            </button>
          )}
        </div>

        <div className="grid min-w-64 flex-1 gap-4 sm:grid-cols-2">
          <Input
            aria-label="Item name"
            placeholder="Please type in the item name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Input
            aria-label="Price"
            inputMode="decimal"
            placeholder="Price, e.g. 140.60"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
        </div>
      </div>

      <Suspense
        fallback={
          <div className="grid min-h-40 place-items-center rounded-3xl border-2 border-brand-edge bg-white">
            <Spinner label="Loading editor…" />
          </div>
        }
      >
        <RichTextEditor
          ariaLabel="Item details"
          value={draft.details}
          onChange={(details) => setDraft({ ...draft, details })}
          placeholder="Describe the dish — what is in it, and why someone should order it."
        />
      </Suspense>

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {item && onDelete && (
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button onClick={submit} disabled={uploading}>
            {item ? 'Update' : 'Add item'}
          </Button>
        </div>
      </div>
    </div>
  )
}
