import { useRef, useState } from 'react'
import { parseMenuFile, MENU_TEMPLATE_HEADERS } from '../../../../utils/menuImport'
import { Button, Input, Alert, Toast, UploadProgress } from '../../../../components/ui'
import MenuItemForm from './MenuItemForm'

/**
 * Wizard step 4 — menu categories and items.
 *
 * Follows `add a menu.png` and `menu items loaded.png`: a category is created
 * from a single input, then each category owns a table of items with columns
 * IMAGE / NAME / PRICE / DETAILS / ACTIONS, its own "MENU UPLOAD EXCEL", and
 * round add and delete controls beside its heading.
 *
 * Everything is held in wizard state and written on submit, like the other
 * steps — the venue does not exist yet. Item photos are the exception: they
 * upload immediately (C4) so the partner sees them, and are linked on save.
 */
const rand = () => Math.random().toString(36).slice(2, 9)

/** "R 140.60" — ZAR, always two decimals, matching the designs. */
const formatPrice = (value) =>
  `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Details are rich text; the table shows a plain-text preview of it. */
const toPreview = (html) => {
  const text = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5 fill-none stroke-current stroke-[1.75]">
      <path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5 fill-none stroke-current stroke-[1.75]">
      <path d="M3.5 5.5h13M8 5.5V4h4v1.5M5.5 5.5l.8 11h7.4l.8-11" strokeLinejoin="round" />
    </svg>
  )
}

function RoundButton({ onClick, label, filled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        filled
          ? 'grid size-8 place-items-center rounded-full bg-brand-500 text-ink-900 transition hover:bg-brand-600'
          : 'grid size-8 place-items-center rounded-full text-brand-ink ring-2 ring-inset ring-brand-edge transition hover:bg-brand-50'
      }
    >
      {children}
    </button>
  )
}

export default function MenuStep({ value, onChange }) {
  const [categoryName, setCategoryName] = useState('')
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [upload, setUpload] = useState(null)
  // { categoryId, item|null } — null item means "adding".
  const [editing, setEditing] = useState(null)
  const importRefs = useRef({})

  const categories = value.categories

  const setCategories = (next) => onChange({ ...value, categories: next })

  const addCategory = () => {
    const name = categoryName.trim()
    if (!name) return setError('Give the category a name.')
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return setError(`"${name}" already exists.`)
    }
    setCategories([...categories, { id: rand(), name, items: [] }])
    setCategoryName('')
    setError(null)
    setToast('Menu category successfully created')
  }

  const removeCategory = (id) => setCategories(categories.filter((c) => c.id !== id))

  const saveItem = (categoryId, item) => {
    setCategories(
      categories.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              items: item.id
                ? c.items.map((i) => (i.id === item.id ? item : i))
                : [...c.items, { ...item, id: rand() }],
            },
      ),
    )
    setEditing(null)
    setToast(item.id ? 'Menu item updated' : 'Menu item added')
  }

  const deleteItem = (categoryId, itemId) => {
    setCategories(
      categories.map((c) =>
        c.id !== categoryId ? c : { ...c, items: c.items.filter((i) => i.id !== itemId) },
      ),
    )
    setEditing(null)
  }

  /**
   * Per-category Excel/CSV import. Rows carrying a different heading are kept —
   * dropping them silently would lose a partner's work with no explanation —
   * and land in their own category instead.
   */
  const importInto = async (category, event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setUpload({ fileName: file.name, percent: 35 })
      const rows = await parseMenuFile(file)
      setUpload({ fileName: file.name, percent: 80 })

      const next = categories.map((c) => ({ ...c, items: [...c.items] }))
      const findOrAdd = (name) => {
        let match = next.find((c) => c.name.toLowerCase() === name.toLowerCase())
        if (!match) {
          match = { id: rand(), name, items: [] }
          next.push(match)
        }
        return match
      }

      rows.forEach((row) => {
        const target = row.heading ? findOrAdd(row.heading) : next.find((c) => c.id === category.id)
        target.items.push({
          id: rand(),
          name: row.item_name,
          price: row.price,
          details: row.description ? `<p>${row.description}</p>` : '',
          image: '',
        })
      })

      setCategories(next)
      setUpload(null)
      setToast(`${rows.length} item${rows.length === 1 ? '' : 's'} imported from "${file.name}".`)
    } catch (err) {
      setUpload(null)
      setError(err.message)
    } finally {
      event.target.value = ''
    }
  }

  /** The template the designs offer for download, so uploads match what we parse. */
  const downloadTemplate = () => {
    const csv = [
      MENU_TEMPLATE_HEADERS.join(','),
      'STARTERS,Prawn Cocktail,80.00,"Tomatoes, creamy burrata and a great summer starter."',
      'MAINS,Chicken Cordon Bleu Casserole,140.60,"Chicken wrapped around cheese, breaded and baked."',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'shot-right-menu-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <Input
          className="min-w-64 flex-1"
          aria-label="Menu category"
          placeholder="Please enter menu category"
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCategory()
            }
          }}
        />
        <Button onClick={addCategory} className="shrink-0">
          Add
        </Button>
        <button
          type="button"
          onClick={downloadTemplate}
          className="ml-auto shrink-0 py-2.5 text-sm font-bold tracking-wide text-brand-ink uppercase hover:text-brand-900"
        >
          Download menu list template +
        </button>
      </div>

      {upload && <UploadProgress fileName={upload.fileName} percent={upload.percent} />}
      {error && <Alert variant="danger">{error}</Alert>}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {categories.length === 0 && (
        <div className="rounded-3xl border-2 border-dashed border-brand-300 p-10 text-center">
          <p className="text-sm font-bold text-ink-900">No menu categories yet</p>
          <p className="mt-1 text-sm text-ink-500">
            Add one above — starters, mains, dessert — then fill it with items.
          </p>
        </div>
      )}

      {categories.map((category) => (
        <section key={category.id} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-ink-900 uppercase">
              {category.name} - Menu
            </h2>
            <RoundButton
              filled
              label={`Add item to ${category.name}`}
              onClick={() => setEditing({ categoryId: category.id, item: null })}
            >
              <svg viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-2">
                <path d="M10 5v10M5 10h10" strokeLinecap="round" />
              </svg>
            </RoundButton>
            <RoundButton
              label={`Delete ${category.name}`}
              onClick={() => removeCategory(category.id)}
            >
              <TrashIcon />
            </RoundButton>

            <button
              type="button"
              onClick={() => importRefs.current[category.id]?.click()}
              className="ml-auto text-sm font-bold tracking-wide text-brand-ink uppercase hover:text-brand-900"
            >
              Menu upload excel
            </button>
            <input
              ref={(el) => {
                importRefs.current[category.id] = el
              }}
              type="file"
              accept=".csv,.txt,.xlsx"
              className="hidden"
              onChange={(e) => importInto(category, e)}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-ink-700 uppercase">
                  <th className="px-4 py-2 font-normal">Image</th>
                  <th className="px-4 py-2 font-normal">Name</th>
                  <th className="px-4 py-2 font-normal">Price</th>
                  <th className="px-4 py-2 font-normal">Details</th>
                  <th className="px-4 py-2 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {category.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-500">
                      Nothing in this category yet.
                    </td>
                  </tr>
                )}
                {category.items.map((item) => (
                  <tr key={item.id} className="border-b-4 border-white bg-ink-50">
                    <td className="px-4 py-3">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt=""
                          className="size-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="grid size-9 place-items-center rounded-full bg-white text-[9px] text-ink-500">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-900 uppercase">{item.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-900">
                      {formatPrice(item.price)}
                    </td>
                    <td className="max-w-md px-4 py-3 text-ink-700">{toPreview(item.details)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <RoundButton
                          label={`Edit ${item.name}`}
                          onClick={() => setEditing({ categoryId: category.id, item })}
                        >
                          <EditIcon />
                        </RoundButton>
                        <RoundButton
                          label={`Delete ${item.name}`}
                          onClick={() => deleteItem(category.id, item.id)}
                        >
                          <TrashIcon />
                        </RoundButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editing?.categoryId === category.id && (
            <MenuItemForm
              item={editing.item}
              onSave={(item) => saveItem(category.id, item)}
              onDelete={editing.item ? () => deleteItem(category.id, editing.item.id) : undefined}
              onCancel={() => setEditing(null)}
            />
          )}
        </section>
      ))}
    </div>
  )
}
