import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import MenuSkeleton from '../components/ui/MenuSkeleton'

/**
 * A venue's menu — adding, editing and deleting.
 *
 * These three are one suite because they share a failure mode: the menu is the
 * only part of the portal where the partner does destructive work, and the
 * server is the only place that knows whether any of it happened. So every
 * assertion here checks `bench.items` / `bench.headings` after the click, not
 * just what the screen says.
 *
 * The delete tests matter most. A "Remove" that removes the row from the list
 * and not from the database is indistinguishable from a working one until the
 * partner reloads — and by then they have moved on, believing a dish nobody can
 * order is gone.
 */

const MENU_ROUTE = '/venues/VEN-00001/menu'

const addHeading = async (user, name = 'Starters') => {
  await user.type(await screen.findByLabelText(/^heading$/i), name)
  await user.click(screen.getByRole('button', { name: /add heading/i }))
  return name
}

const addItem = async (user, { heading = 'Starters', item = 'Chakalaka', price = '45' } = {}) => {
  // Each heading gets its own item form, so the fields have to be found inside
  // the right card rather than by document-wide label.
  const card = (await screen.findByRole('heading', { name: heading })).closest('section')
  await user.type(within(card).getByLabelText(/^item$/i), item)
  await user.type(within(card).getByLabelText(/price/i), price)
  await user.click(within(card).getByRole('button', { name: /add item/i }))
  return item
}

describe('add a menu', () => {
  it('creates a heading on the server', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    const name = await addHeading(user)

    await waitFor(() => expect(bench.headings.some((h) => h.heading === name)).toBe(true))
    expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
  })

  it('adds an item under the right heading, with its price', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    const item = await addItem(user)

    await waitFor(() => expect(bench.items.some((i) => i.item_name === item)).toBe(true))
    const saved = bench.items.find((i) => i.item_name === item)
    expect(saved.price).toBe(45)
    expect(saved.parent_heading).toBe(bench.headings.find((h) => h.heading === 'Starters').name)
  })

  it('shows the item on the page once it is saved', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await addItem(user)

    expect(await screen.findByText('Chakalaka')).toBeInTheDocument()
  })

  it('does not create an empty heading', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await screen.findByLabelText(/^heading$/i)
    await user.click(screen.getByRole('button', { name: /add heading/i }))

    await new Promise((r) => setTimeout(r, 300))
    expect(bench.headings).toHaveLength(0)
  })

  it('clears the field after adding, so the next one can be typed straight in', async () => {
    /* Leaving the text behind means the partner adding six headings deletes the
       previous one six times, or accidentally creates "StartersMains". */
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await waitFor(() => expect(screen.getByLabelText(/^heading$/i)).toHaveValue(''))
  })

  it('says so plainly when the menu endpoints are not deployed', async () => {
    /* This screen returned a raw "Not found" for weeks. A partner reading that
       about their own menu reasonably concludes their menu is gone. */
    bench.deploy.get_venue_products = false
    renderApp({ route: MENU_ROUTE, signedIn: true })

    const alerts = await screen.findAllByRole('alert')
    const text = alerts.map((a) => a.textContent).join(' ')
    expect(text).toMatch(/isn’t|not|yet/i)
    expect(text).not.toMatch(/DoesNotExistError|Traceback/)
  })
})

describe('edit a menu', () => {
  it('keeps existing items when a new one is added', async () => {
    /* An "add" that rewrites the whole menu is a data-loss bug wearing a
       feature's clothes. */
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await addItem(user, { item: 'Chakalaka', price: '45' })
    await waitFor(() => expect(bench.items).toHaveLength(1))

    await addItem(user, { item: 'Bunny chow', price: '90' })
    await waitFor(() => expect(bench.items).toHaveLength(2))

    expect(bench.items.map((i) => i.item_name).sort()).toEqual(['Bunny chow', 'Chakalaka'])
  })

  it('adds a second heading without disturbing the first', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user, 'Starters')
    await addItem(user, { heading: 'Starters', item: 'Chakalaka' })
    await addHeading(user, 'Mains')

    await waitFor(() => expect(bench.headings).toHaveLength(2))
    expect(bench.items).toHaveLength(1)
    expect(await screen.findByText('Chakalaka')).toBeInTheDocument()
  })

  it('sends the price as a number the server can total', async () => {
    /* Prices come off a text input. "45" sorts and sums differently from 45,
       and a menu that cannot be totalled is a menu that cannot be checked. */
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await addItem(user, { price: '45' })

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'add_product_item')).toBe(true))
    const saved = bench.items.find((i) => i.item_name === 'Chakalaka')
    expect(typeof saved.price).toBe('number')
  })
})

describe('delete a menu item', () => {
  it('removes it from the server, not just the screen', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await addItem(user)
    await waitFor(() => expect(bench.items).toHaveLength(1))

    await user.click(await screen.findByRole('button', { name: /remove/i }))

    await waitFor(() => expect(bench.items).toHaveLength(0))
    await waitFor(() => expect(screen.queryByText('Chakalaka')).not.toBeInTheDocument())
  })

  it('does not report a delete that the server refused', async () => {
    /* The one that matters. `frappe.client.delete` needs a permission the
       Vendor role may not have — and if we drop the row from the list on an
       optimistic update and swallow the error, the partner believes a dish is
       gone. They find out when somebody orders it. */
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await addItem(user)
    await waitFor(() => expect(bench.items).toHaveLength(1))

    bench.deploy['frappe.client.delete'] = false
    await user.click(await screen.findByRole('button', { name: /remove/i }))

    // Whatever it says, the item must still be on screen, because it is still
    // on the server.
    await new Promise((r) => setTimeout(r, 600))
    expect(bench.items).toHaveLength(1)
    expect(screen.getByText('Chakalaka')).toBeInTheDocument()
  })

  it('deletes only the item that was clicked', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })

    await addHeading(user)
    await addItem(user, { item: 'Chakalaka', price: '45' })
    await addItem(user, { item: 'Bunny chow', price: '90' })
    await waitFor(() => expect(bench.items).toHaveLength(2))

    const row = (await screen.findByText('Bunny chow')).closest('li')
    await user.click(within(row).getByRole('button', { name: /remove/i }))

    await waitFor(() => expect(bench.items).toHaveLength(1))
    expect(bench.items[0].item_name).toBe('Chakalaka')
  })
})

/* ============================================================================
   REPORTED 8 AUG — "in the edit menu the menu upload is not working"

   It goes through `/api/method/upload_file`, the same endpoint that was 403ing
   on venue photos the same day. One report, not two.

   What the partner saw was "We couldn't read that file" — a sentence about
   their spreadsheet, over a request in which their spreadsheet never left the
   building. So they try another file, and a CSV instead of an Excel, and a
   shorter one, and every attempt fails identically. Sending someone off to fix
   work that was never broken is worse than saying nothing.
   ========================================================================= */
describe('when the menu upload is refused', () => {
  const pickFile = async (user) => {
    const file = new File(['Heading,Item,Price\nMains,Lamb curry,450'], 'menu.csv', {
      type: 'text/csv',
    })
    await user.upload(await screen.findByLabelText(/menu file/i), file)
  }

  it('does not blame the partner’s file for our permission problem', async () => {
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    await pickFile(user)

    expect(await screen.findByText(/couldn’t upload your menu/i)).toBeInTheDocument()
    expect(screen.getByText(/problem on our side, not with your file/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn’t read that file/i)).not.toBeInTheDocument()
  })

  it('does not offer another file, because the tenth is refused like the first', async () => {
    /* The same rule the photo uploader already follows. A retry that cannot
       work is an afternoon of someone's time. */
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    await pickFile(user)

    await screen.findByText(/couldn’t upload your menu/i)
    expect(screen.queryByRole('button', { name: /try another file/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add items by hand/i })).toBeInTheDocument()
  })

  it('never puts a role permission on a restaurant owner’s screen', async () => {
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    await pickFile(user)

    await screen.findByText(/couldn’t upload your menu/i)
    expect(document.body.textContent).not.toMatch(/doctype|role permission|upload_file|403/i)
  })

  it('says the menu is untouched, so nobody goes hunting for damage', async () => {
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    await pickFile(user)

    await screen.findByText(/couldn’t upload your menu/i)
    expect(screen.getByText(/nothing wrong with it and nothing to fix/i)).toBeInTheDocument()
    expect(screen.getByText(/adding items by hand works normally/i)).toBeInTheDocument()
  })

  it('still blames the file when the file really is the problem', async () => {
    /* The fix must not become a way of never telling someone their CSV is
       broken. An upload that ARRIVED and could not be parsed is the one case
       where a different file is genuinely the answer. */
    bench.uploadRefused = false
    bench.importFails = 'parse'
    const { user } = renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    await pickFile(user)

    expect(await screen.findByText(/couldn’t read that file/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try another file/i })).toBeInTheDocument()
  })

  it('the menu upload does not send a doctype — so it needs no Venue permission', async () => {
    /* Worth pinning: this upload carries no `doctype`/`docname`, so a missing
       VENUE attach permission cannot explain it. If this path is refused too,
       the missing permission is on `File` itself — which is a different fix,
       and the distinction is filed as §19.b. */
    bench.uploadRefused = false
    const { user } = renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    await pickFile(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'upload_file')).toBe(true))
    const upload = bench.calls.find((c) => c.method === 'upload_file')
    expect(upload.args.doctype).toBeFalsy()
    expect(upload.args.docname).toBeFalsy()
  })
})

describe('a description as the bench actually stores it', () => {
  /**
   * REPORTED FROM THE LIVE SITE (screenshot, /venues/VEN-00010/menu): an item
   * read `<p>Tomatoes, creamy burrata and a great summer starter.</p>` on
   * screen — the partner's own sentence with Frappe's markup around it.
   *
   * Frappe's Text Editor field stores HTML and React escapes it, so the tags
   * are shown rather than applied. The fake bench used to hand descriptions
   * back exactly as they were sent, which is why no test could see this; it now
   * wraps them in `<p>` the way the real one does.
   */
  it('reaches the partner as words, not as markup', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })
    await addHeading(user, 'Starters')
    const card = (await screen.findByRole('heading', { name: 'Starters' })).closest('section')
    await user.type(within(card).getByLabelText(/^item$/i), 'Prawn Cocktail')
    await user.type(within(card).getByLabelText(/price/i), '80')
    await user.type(
      within(card).getByLabelText(/description/i),
      'Tomatoes, creamy burrata and a great summer starter.',
    )
    await user.click(within(card).getByRole('button', { name: /add item/i }))

    /* The bench really is holding HTML — otherwise this test proves nothing. */
    await waitFor(() => expect(bench.items.at(-1)?.description).toMatch(/^<p>/))

    expect(
      await screen.findByText('Tomatoes, creamy burrata and a great summer starter.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/<p>/)).not.toBeInTheDocument()
  })
})

describe('the menu comes first', () => {
  /**
   * This screen used to open on three empty forms — upload, add a heading, add
   * an item — with the partner's own menu underneath all of them. The forms are
   * now actions in the header, and the menu is the page.
   */
  it('folds the import away once there is a menu, and opens it on request', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })
    await addHeading(user, 'Cocktails')
    await addItem(user, { heading: 'Cocktails', item: 'Negroni', price: '85' })

    await waitFor(() => expect(screen.queryByLabelText(/menu file/i)).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /import a spreadsheet/i }))
    expect(await screen.findByLabelText(/menu file/i)).toBeInTheDocument()
  })

  it('counts what is on the menu, so the header says what the page holds', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })
    await addHeading(user, 'Cocktails')
    await addItem(user, { heading: 'Cocktails', item: 'Negroni', price: '85' })

    expect(await screen.findByText(/1 item in 1 section$/i)).toBeInTheDocument()

    await addItem(user, { heading: 'Cocktails', item: 'Old Fashioned', price: '110' })
    expect(await screen.findByText(/2 items in 1 section$/i)).toBeInTheDocument()
  })

  /**
   * A heading with nothing under it is a blank tab in the customer app. That is
   * invisible from this screen unless it is said, and it is the single most
   * likely thing to be wrong with a half-finished menu.
   */
  it('says when a section is empty, and what that means for customers', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })
    await addHeading(user, 'Cocktails')
    await addItem(user, { heading: 'Cocktails', item: 'Negroni', price: '85' })
    await addHeading(user, 'Desserts')

    expect(await screen.findByText(/desserts is empty, so customers see a blank tab/i)).toBeInTheDocument()

    const card = (await screen.findByRole('heading', { name: 'Desserts' })).closest('section')
    expect(within(card).getByText(/customers see this as an empty tab/i)).toBeInTheDocument()
  })

  /**
   * The form is on screen at this point only because the menu is empty. Adding
   * a heading makes it non-empty — so without holding it open, the form the
   * partner is typing into disappears the moment it works.
   */
  it('keeps the section form open for the next one', async () => {
    const { user } = renderApp({ route: MENU_ROUTE, signedIn: true })
    await addHeading(user, 'Cocktails')
    await addHeading(user, 'Mains')

    expect(await screen.findByRole('heading', { name: 'Cocktails' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mains' })).toBeInTheDocument()
  })
})

describe('while the menu is loading', () => {
  /**
   * The screen used to return a bare `<Spinner/>` INSTEAD of itself, so the
   * heading and the layout vanished and snapped back — and a slow menu looked
   * exactly like a broken one.
   *
   * Rendered directly rather than raced against MSW: the claim is about what
   * the placeholder IS, and a timing window is not a good place to assert it.
   */
  it('keeps the page and its shape instead of replacing them', () => {
    render(<MenuSkeleton />)

    expect(screen.getByRole('heading', { name: /^menu$/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/loading your menu/i)
    expect(screen.getByText('Sections')).toBeInTheDocument()
  })

  /* One live region carrying the words. A screen reader should hear "loading
     your menu", not a description of forty grey boxes. */
  it('does not read the placeholder boxes out to a screen reader', () => {
    const { container } = render(<MenuSkeleton />)
    const bones = container.querySelectorAll('.animate-pulse')

    expect(bones.length).toBeGreaterThan(5)
    bones.forEach((bone) => expect(bone).toHaveAttribute('aria-hidden', 'true'))
  })
})
