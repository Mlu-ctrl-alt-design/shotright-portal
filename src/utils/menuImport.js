export const MENU_TEMPLATE_HEADERS = ['heading', 'item_name', 'price', 'description']

/**
 * Parse a vendor's bulk menu upload (#17).
 *
 * CSV only, parsed in the browser with no dependency. Quoted fields are handled
 * because menu descriptions routinely contain commas. The server revalidates
 * everything — this parse is for fast feedback, not trust.
 */
export async function parseMenuFile(file) {
  const text = await file.text()
  const rows = parseCsv(text)
  if (rows.length === 0) throw new Error('That file is empty.')

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const missing = ['heading', 'item_name', 'price'].filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(
      `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        `Expected headers: ${MENU_TEMPLATE_HEADERS.join(', ')}.`,
    )
  }

  const indexOf = (col) => header.indexOf(col)
  const parsed = []

  rows.slice(1).forEach((cells, i) => {
    // Skip blank trailing lines rather than failing the whole import.
    if (cells.every((c) => !c.trim())) return

    const lineNumber = i + 2
    const heading = (cells[indexOf('heading')] || '').trim()
    const itemName = (cells[indexOf('item_name')] || '').trim()
    const rawPrice = (cells[indexOf('price')] || '').trim()

    if (!heading) throw new Error(`Line ${lineNumber}: heading is required.`)
    if (!itemName) throw new Error(`Line ${lineNumber}: item_name is required.`)

    const price = Number(rawPrice.replace(/[R\s,]/g, ''))
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Line ${lineNumber}: "${rawPrice}" is not a valid price.`)
    }

    parsed.push({
      heading,
      item_name: itemName,
      price,
      description:
        indexOf('description') === -1 ? '' : (cells[indexOf('description')] || '').trim(),
    })
  })

  if (parsed.length === 0) throw new Error('No rows to import.')
  return parsed
}

/** Minimal RFC4180-ish CSV reader: handles quotes, escaped quotes and CRLF. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair.
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
