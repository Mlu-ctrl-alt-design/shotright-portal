export const MENU_TEMPLATE_HEADERS = ['heading', 'item_name', 'price', 'description']

/**
 * The template we hand partners, in one place.
 *
 * The wizard and the venue menu page both offer this download, and the server
 * parses what comes back. Two copies of these headers is how a template starts
 * disagreeing with the parser that reads it.
 */
export function buildTemplateCsv() {
  return [
    MENU_TEMPLATE_HEADERS.join(','),
    'Cocktails,Espresso Martini,95,Double shot with a vanilla finish',
    'Cocktails,Amarula Colada,88,',
    'Small Plates,Chilli Poppers,65,6 pieces',
  ].join('\n')
}

/* ---------------------------------------------------------------- stages */

/**
 * The four things we tell a partner we are doing while we read their file.
 *
 * These are STAGES, not percentages, and that is the whole point. "62%" says
 * only that time is passing. "Found 4 categories · reading 38 items and prices"
 * says we opened the file they sent, understood it, and are working through the
 * thing they actually care about. The second one is what makes a twenty-second
 * wait feel like work rather than a hang.
 *
 * The backend publishes `stage` on the Menu Import doc (uploaded → scanning →
 * reading → checking → done), and the wizard's in-browser parse reports the same
 * four. One vocabulary, two engines — otherwise the same upload describes itself
 * differently depending on where the partner happens to be standing.
 */
export const IMPORT_STAGES = ['uploaded', 'scanning', 'reading', 'checking']

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * Turn a job into the checklist the design shows.
 *
 * Counts appear in a label only once they are KNOWN. Before that the label says
 * what we are looking for ("Looking for categories") rather than naming a number
 * we have not counted yet — a checklist that guesses is a checklist nobody reads
 * twice.
 */
export function buildStageChecklist(job = {}) {
  const stage = job.stage || 'uploaded'
  const at = IMPORT_STAGES.indexOf(stage)
  const reached = (name) => at >= IMPORT_STAGES.indexOf(name) || stage === 'done'

  const categories = job.categories_found
  const total = job.total
  const processed = job.processed ?? 0
  const missing = job.missing_price_count

  return [
    {
      key: 'uploaded',
      label: 'Uploaded your file',
    },
    {
      key: 'scanning',
      label:
        categories > 0
          ? `Found ${plural(categories, 'category', 'categories')}`
          : reached('reading')
            ? 'No categories found'
            : 'Looking for categories',
    },
    {
      key: 'reading',
      label:
        total > 0
          ? `Reading ${plural(total, 'item', 'items')} and prices`
          : 'Reading items and prices',
      // Only the reading stage has a meaningful sub-count, and only once the
      // total exists. Anywhere else this stays undefined and nothing is drawn.
      detail: total > 0 && processed > 0 && processed < total ? `${processed} of ${total}` : null,
    },
    {
      key: 'checking',
      label:
        missing > 0
          ? `${plural(missing, 'item is', 'items are')} missing a price`
          : 'Checking for missing prices',
    },
  ].map((step) => ({
    ...step,
    status:
      stage === 'done'
        ? 'done'
        : step.key === stage
          ? 'active'
          : reached(step.key)
            ? 'done'
            : 'todo',
  }))
}

/**
 * Parse a vendor's bulk menu upload (#17).
 *
 * CSV only, parsed in the browser with no dependency. Quoted fields are handled
 * because menu descriptions routinely contain commas. The server revalidates
 * everything — this parse is for fast feedback, not trust.
 *
 * `onStage(stage, facts)` is optional and reports the same four stages the
 * background importer publishes, so the wizard can show the same checklist as
 * the venue page. It is called with real information at the moment we learn it —
 * never on a timer.
 */
export async function parseMenuFile(file, onStage) {
  // Awaited: a caller that wants the browser to paint between stages returns a
  // promise from `onStage`, and this is where we give it the chance.
  const report = async (stage, facts) => {
    await onStage?.(stage, facts || {})
  }

  await report('uploaded')
  const text = await file.text()

  await report('scanning')
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

  // Blank lines are dropped, but each surviving row keeps the line number it had
  // in the partner's file — an error that cites line 12 has to mean line 12 in
  // the spreadsheet they are looking at, not line 12 of what we kept.
  const body = rows
    .slice(1)
    .map((cells, i) => ({ cells, lineNumber: i + 2 }))
    .filter(({ cells }) => cells.some((c) => c.trim()))

  // The counts the checklist promises, established BEFORE we start building
  // items — so "Found 4 categories · Reading 38 items" appears while the work
  // is still ahead of us, which is the only time it is any use.
  const headingColumn = indexOf('heading')
  const distinctCategories = new Set(
    body.map(({ cells }) => (cells[headingColumn] || '').trim().toLowerCase()).filter(Boolean),
  )
  await report('reading', { categories_found: distinctCategories.size, total: body.length })

  const parsed = []
  let missingPrices = 0

  // How often the row loop stops to let the browser paint. A menu of 30 items
  // finishes inside one chunk and the checklist simply flashes past, which is
  // the truth about a file that small. A 4,000-row export takes long enough to
  // sit through, and this is what makes "1,500 of 4,000" a real readout rather
  // than a number we made up to fill the silence.
  const CHUNK = 250

  for (let i = 0; i < body.length; i += 1) {
    if (onStage && i > 0 && i % CHUNK === 0) {
      // eslint-disable-next-line no-await-in-loop
      await report('reading', {
        categories_found: distinctCategories.size,
        total: body.length,
        processed: i,
      })
    }
    const { cells, lineNumber } = body[i]
    const heading = (cells[indexOf('heading')] || '').trim()
    const itemName = (cells[indexOf('item_name')] || '').trim()
    const rawPrice = (cells[indexOf('price')] || '').trim()

    if (!heading) throw new Error(`Line ${lineNumber}: heading is required.`)
    if (!itemName) throw new Error(`Line ${lineNumber}: item_name is required.`)

    // An EMPTY price is not an error — a lot of menus genuinely price on the
    // day, and rejecting the whole file over it would be absurd. It is counted,
    // reported by the "checking for missing prices" stage, and left at 0 for the
    // partner to fill in. A price that is present but unreadable is a different
    // thing entirely and still stops the import.
    if (!rawPrice) missingPrices += 1

    const price = rawPrice ? Number(rawPrice.replace(/[R\s,]/g, '')) : 0
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
  }

  if (parsed.length === 0) throw new Error('No rows to import.')

  await report('checking', {
    categories_found: distinctCategories.size,
    total: body.length,
    processed: body.length,
    missing_price_count: missingPrices,
  })
  return parsed
}

/** Minimal RFC4180-ish CSV reader: handles quotes, escaped quotes and CRLF. */
export function parseCsv(text) {
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
