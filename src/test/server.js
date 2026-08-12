import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { bench, headingsFor, venueById } from './bench'

/* ------------------------------------------------------------ Frappe shapes */

/** A missing whitelisted method. Names the method, as Frappe does. */
const methodMissing = (method) =>
  HttpResponse.json(
    {
      exc_type: 'DoesNotExistError',
      exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${method}`,
    },
    { status: 404 },
  )

/** A missing DOCUMENT. Same status, same exc_type, no method named — which is
    exactly why `isMethodMissing` has to read the text. */
const docMissing = () =>
  HttpResponse.json(
    { exc_type: 'DoesNotExistError', exception: 'frappe.exceptions.DoesNotExistError: Venue not found' },
    { status: 404 },
  )

/** `frappe.throw`. Note the HTML — Frappe messages are markup. */
const validationError = (html) =>
  HttpResponse.json(
    {
      exc_type: 'ValidationError',
      exception: `frappe.exceptions.ValidationError: ${html}`,
      _server_messages: JSON.stringify([JSON.stringify({ message: html })]),
    },
    { status: 417 },
  )

const permissionError = (html) =>
  HttpResponse.json(
    {
      exc_type: 'PermissionError',
      exception: `frappe.exceptions.PermissionError: ${html}`,
      _server_messages: JSON.stringify([JSON.stringify({ message: html })]),
    },
    { status: 403 },
  )

const ok = (message) => HttpResponse.json({ message })

/**
 * Drop kwargs the method doesn't declare — silently, at 200.
 *
 * This is the single most important line in the fake bench. It is how a field
 * named wrongly becomes a no-op that nothing reports, and it is why the app
 * reads back after writing instead of trusting a 200.
 */
const declaredOnly = (method, args) => {
  const allow = bench.declared[method]
  if (!allow) return args
  return Object.fromEntries(Object.entries(args).filter(([k]) => allow.includes(k)))
}

const record = (method, args) => bench.calls.push({ method, args })

/* ------------------------------------------------------------------ handlers */

/**
 * One handler per whitelisted method.
 *
 * `bench.deploy` is keyed on the SHORT name (`get_venue_photos`), because that
 * is what a test writer thinks in — `bench.deploy.get_venue_photos = false` to
 * model "not shipped yet". The 404 it produces names the full method, exactly
 * as Frappe does, since that text is the only thing separating a missing method
 * from a missing document.
 */
const method = (fullName, handler) => {
  const short = fullName.replace(/^shotright\.api\./, '')
  return http.all(`*/api/method/${fullName}`, async ({ request }) => {
    if (bench.deploy[short] === false) return methodMissing(fullName)

    let args = {}
    if (request.method === 'POST') args = await request.json().catch(() => ({}))
    else args = Object.fromEntries(new URL(request.url).searchParams)

    record(short, args)
    return handler(args)
  })
}

/** Stock Frappe methods, which are keyed on their full dotted name. */
const generic = (name, handler) =>
  http.all(`*/api/method/${name}`, async ({ request }) => {
    if (bench.deploy[name] === false) return methodMissing(name)
    let args = {}
    if (request.method === 'POST') args = await request.json().catch(() => ({}))
    else args = Object.fromEntries(new URL(request.url).searchParams)
    record(name, args)
    return handler(args)
  })

const parse = (value, fallback) => {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Serialise a venue's moods the way `bench.moodReadShape` says.
 *
 * The portal must survive all three, because which one it gets depends on which
 * endpoint answered — and after a `get_venue_detail` 404 it is reading the
 * dashboard row instead, which is a different serialiser again.
 */
const shapeMoods = (moods) => {
  const ids = Array.isArray(moods) ? moods : []
  if (bench.moodReadShape === 'rows') return ids.map((id) => ({ mood: id }))
  if (bench.moodReadShape === 'labels')
    return ids.map((id) => bench.moods.find((m) => m.name === id)?.mood_name || id)
  return ids
}

/** Built as a list so order is explicit and easy to read. */
const apiHandlers = [
  method('shotright.api.login', ({ email, password }) => {
    const user = bench.users.find((u) => u.email === email)
    if (!user || user.password !== password) {
      return validationError('Invalid login credentials')
    }
    /**
     * An account that exists but has not verified its email.
     *
     * With OTP live, a bench can answer login with `otp_required` and NO token
     * rather than a hard error — the credentials were right, there is just a
     * step left. Modelled because the portal has to handle it: treating it as a
     * session drops someone on a dashboard where every call fails.
     */
    if (!user.enabled) {
      if (bench.loginNeedsOtp) return ok({ otp_required: true, email: user.email })
      return validationError('User is disabled')
    }
    bench.session = user.email
    return ok({ api_key: 'KEY', api_secret: 'SECRET', user: user.email })
  }),

  method('shotright.api.register_vendor', (args) => {
    if (bench.users.some((u) => u.email === args.email)) {
      return validationError('User <strong>already exists</strong>')
    }
    bench.users.push({
      email: args.email,
      password: args.password,
      enabled: !bench.otpRequired,
    })
    if (bench.otpRequired) return ok({ otp_required: true, email: args.email })
    bench.session = args.email
    bench.profile = {
      ...bench.profile,
      email: args.email,
      first_name: args.first_name,
      last_name: args.last_name,
      business_name: args.business_name,
    }
    return ok({ api_key: 'KEY', api_secret: 'SECRET', user: args.email })
  }),

  method('shotright.api.verify_otp', ({ email, code }) => {
    // The app sends `code`. Worth stating: the first draft of this fake bench
    // read `otp`, so verification "failed" for a correct code — the same class
    // of parameter-name mismatch that has caused six real bugs here, produced
    // this time by the test double rather than the app.
    if (String(code) !== bench.otpCode) return validationError('That code is not right')
    const user = bench.users.find((u) => u.email === email)
    if (user) user.enabled = true
    bench.session = email
    return ok({ api_key: 'KEY', api_secret: 'SECRET', user: email })
  }),

  method('shotright.api.resend_otp', () => ok({ sent: true })),
  method('shotright.api.request_password_reset', () => ok({ sent: true })),
  /**
   * Validates the code and returns a session, like the real one.
   *
   * The first draft returned `{ok: true}` unconditionally, so a WRONG reset
   * code appeared to work — the test asserting an error found none. A double
   * that accepts anything cannot fail the case it exists to cover.
   */
  method('shotright.api.reset_password', ({ email, code, new_password }) => {
    if (String(code) !== bench.otpCode) return validationError('That code is not right')
    const user = bench.users.find((u) => u.email === email)
    if (user) {
      user.password = new_password
      user.enabled = true
    }
    bench.session = email
    return ok({ api_key: 'KEY', api_secret: 'SECRET', user: email })
  }),

  /* ----------------------------------------------------------- dashboard */
  method('shotright.api.get_vendor_dashboard', () =>
    ok({
      profile: { ...bench.profile },
      stats: { venues: bench.venues.length },
      venues: bench.venues.map((v) => ({ ...v })),
    }),
  ),

  /* -------------------------------------------------------------- venues */
  /**
   * `get_venue_detail` and `get_vendor_dashboard` are different serialisers
   * over the same doctype and do NOT return the same fields. `bench.detailOmits`
   * models that: production omits `address` here while the dashboard carries
   * it, which is why the edit form opened with a blank address.
   */
  method('shotright.api.get_venue_detail', ({ venue_name }) => {
    const venue = venueById(venue_name)
    if (!venue) return docMissing()
    const out = { ...venue, moods: shapeMoods(venue.moods) }
    for (const field of bench.detailOmits || []) delete out[field]
    return ok(out)
  }),

  method('shotright.api.create_venue', (args) => {
    const id = `VEN-${String(bench.venues.length + 1).padStart(5, '0')}`
    const venue = {
      name: id,
      venue_name: args.venue_name,
      address: args.address || '',
      latitude: args.latitude ?? null,
      longitude: args.longitude ?? null,
      dress_code: args.dress_code || '',
      atmosphere_desc: args.atmosphere_desc || '',
      moods: parse(args.moods, []) || [],
      operating_hours: parse(args.operating_hours, []) || [],
      // The server owns this. A client must never be able to set it.
      workflow_state: 'Pending',
    }
    bench.venues.push(venue)
    return ok({ ...venue })
  }),

  method('shotright.api.update_venue', (args) => {
    const { venue_name, ...rest } = args
    const venue = venueById(venue_name)
    if (!venue) return docMissing()

    // Unlike everything else on this bench, update_venue REFUSES unknown
    // fields rather than dropping them. Reproduced from production.
    const refused = Object.keys(rest).filter((k) => !bench.venueWritable.includes(k))
    if (refused.length) {
      return validationError(`Cannot update field(s): ${[...refused, 'cmd'].sort().join(', ')}`)
    }

    for (const [key, value] of Object.entries(rest)) {
      if (key === 'new_name') {
        venue.venue_name = value
        continue
      }

      /**
       * `moods` is a CHILD TABLE on Venue, and `venue.update()` hands each row
       * to Frappe's `_init_child`, which does `value["doctype"] = doctype`.
       * A list of plain strings therefore explodes:
       *
       *   TypeError: 'str' object does not support item assignment
       *
       * Reproduced from production, 28 Jul. `create_venue` accepts mood ids as
       * strings; `update_venue` passes them straight through to `venue.update`
       * and does not. That asymmetry is the bug, and modelling it here is what
       * makes the test fail before the fix.
       */
      const parsed = key === 'moods' || key === 'operating_hours' ? parse(value, value) : value
      if (
        bench.moodsAreChildRows &&
        key === 'moods' &&
        Array.isArray(parsed) &&
        parsed.some((row) => typeof row === 'string')
      ) {
        return HttpResponse.json(
          {
            exc_type: 'TypeError',
            exception: "TypeError: 'str' object does not support item assignment",
            exc: JSON.stringify([
              'Traceback (most recent call last):\n  File "apps/shotright/shotright/venue_service.py", line 89, in update_venue\n    venue.update(fields)\n  File "apps/frappe/frappe/model/base_document.py", line 321, in _init_child\n    value["doctype"] = doctype\nTypeError: \'str\' object does not support item assignment\n',
            ]),
          },
          { status: 500 },
        )
      }

      venue[key] = parsed
    }
    return ok({ ...venue })
  }),

  /* ---------------------------------------------------------------- menu */
  method('shotright.api.get_venue_products', ({ venue_name }) => {
    if (!venueById(venue_name)) return docMissing()
    return ok(headingsFor(venue_name))
  }),

  method('shotright.api.add_product_heading', (args) => {
    const name = `PH-${bench.headings.length + 1}`
    bench.headings.push({
      name,
      venue: args.venue_name || args.venue,
      heading: args.heading || args.heading_name,
    })
    return ok({ name, heading: args.heading || args.heading_name })
  }),

  method('shotright.api.add_product_item', (args) => {
    const name = `PI-${bench.items.length + 1}`
    bench.items.push({
      name,
      parent_heading: args.heading_name || args.heading || args.parent_heading,
      item_name: args.item_name,
      price: Number(args.price) || 0,
      description: args.description || '',
    })
    return ok({ name })
  }),

  /**
   * Item edit / delete, and bookings — none of which exist on the real bench.
   *
   * `bench.deploy` starts them FALSE, because "not deployed" is the truthful
   * default and a test that wants the happy path should have to say so. That is
   * the opposite of how the rest of this file is set up, and deliberately: for
   * everything else the endpoint exists and a test opts OUT; for these the
   * endpoint doesn't and a test opts IN.
   */
  method('shotright.api.update_product_item', (args) => {
    const item = bench.items.find((i) => i.name === (args.item || args.name))
    if (!item) return docMissing()
    if (args.item_name !== undefined) item.item_name = args.item_name
    if (args.price !== undefined) item.price = Number(args.price) || 0
    if (args.description !== undefined) item.description = args.description
    return ok({ ok: true })
  }),

  method('shotright.api.delete_product_item', (args) => {
    const id = args.item || args.name
    const before = bench.items.length
    bench.items = bench.items.filter((i) => i.name !== id)
    return before === bench.items.length ? docMissing() : ok({ ok: true })
  }),

  /**
   * SHIPPED 7 Aug, and modelled to the real contract rather than to what is
   * convenient to assert against:
   *
   * - **ownership is checked before anything is read**, against `Venue.vendor`,
   *   so `venue_name` alone is never enough — a venue that isn't ours throws
   *   rather than returning an empty list, which would read as "no bookings".
   * - **`from_date`/`to_date` are inclusive and independent** — either, both or
   *   neither.
   * - **`limit` arrives as a string** because form encoding makes it one. The
   *   real service runs it through `cint`; this drops it through `Number` for
   *   the same reason, and caps at 500 so a test can prove we never ask for
   *   more than the server will give.
   * - **not gated on `workflow_state`** — a Pending venue still has guests
   *   arriving, so bench state about the venue's review does not filter this.
   */
  method('shotright.api.get_venue_bookings', (args) => {
    const venue = bench.venues.find((v) => v.name === args.venue_name)
    if (!venue) return validationError('Not permitted')

    const from = args.from_date || ''
    const to = args.to_date || ''
    const limit = Math.min(Number(args.limit) || 20, 500)

    const rows = (bench.bookings[args.venue_name] || [])
      .filter((b) => (!from || String(b.arrival_date) >= from) && (!to || String(b.arrival_date) <= to))
      .sort((a, b) =>
        `${a.arrival_date} ${a.arrival_time}`.localeCompare(`${b.arrival_date} ${b.arrival_time}`),
      )
      .slice(0, limit)

    /* party_size is computed server-side — `booking_register.py` does the same,
       and two surfaces disagreeing about whether children are covers is the bug
       this models away. */
    return ok(
      rows.map((b) => ({
        name: b.name,
        arrival_date: b.arrival_date,
        arrival_time: b.arrival_time,
        adults: b.adults ?? 0,
        children: b.children ?? 0,
        party_size: (b.adults ?? 0) + (b.children ?? 0),
        contact_name: b.contact_name,
        contact_cell_phone: b.contact_cell_phone,
        creation: b.creation || '2026-08-01 09:00:00',
      })),
    )
  }),

  /* -------------------------------------------------------------- places */

  /**
   * The proxy. Note what it does NOT return: no rating, no reviews, no photos,
   * no atmosphere attributes. Those may not be stored, so the portal must never
   * be in a position to receive them by accident — a double that handed them
   * over would let a `...place` spread put them in the database and the suite
   * would call it a pass.
   */
  method('shotright.api.search_places', ({ query }) =>
    ok(
      bench.places
        .filter((p) => !query || p.display_name.toLowerCase().includes(String(query).toLowerCase()))
        .map((p) => ({
          place_id: p.place_id,
          display_name: p.display_name,
          formatted_address: p.formatted_address,
          claimed: Boolean(p.claimed),
        })),
    ),
  ),

  method('shotright.api.get_place_details', ({ place_id }) => {
    const place = bench.places.find((p) => p.place_id === place_id)
    if (!place) return docMissing()
    if (bench.placeClaimed || place.claimed)
      return validationError('That venue is <strong>already claimed</strong> by another account')
    return ok({
      place_id: place.place_id,
      display_name: place.display_name,
      formatted_address: place.formatted_address,
      location: { latitude: place.latitude, longitude: place.longitude },
      national_phone_number: place.phone || '',
      attribution: 'Powered by Google',
    })
  }),

  /* --------------------------------------------------------------- legal */

  method('shotright.api.get_legal_documents', () =>
    ok(
      bench.legal.map((d) => ({
        name: d.name,
        title: d.title,
        document_type: d.document_type || '',
        version: d.version || '',
        effective_date: d.effective_date || '',
        content: d.content ?? '',
        required: d.required === undefined ? 1 : d.required,
        accepted: d.accepted ? 1 : 0,
        accepted_on: d.accepted_on || '',
      })),
    ),
  ),

  /**
   * Accept, with the silent-no-op switch built in.
   *
   * `legalAcceptSilentlyFails` returns a perfectly ordinary 200 and writes
   * nothing — the shape of a kwarg the handler never declared. The portal is
   * required to catch this by reading back, and to say "we couldn't record
   * that" rather than showing a tick. A test double that cannot reproduce the
   * bug cannot prove the fix.
   */
  method('shotright.api.accept_legal_document', (args) => {
    const id = args.document || args.legal_document || args.name || args.document_name
    const doc = bench.legal.find((d) => d.name === id)
    if (!doc) return docMissing()
    if (bench.legalAcceptSilentlyFails) return ok({ ok: true })
    doc.accepted = 1
    doc.accepted_on = '2026-08-07 10:15:00'
    /* What they agreed to, not just that they agreed. A record that cannot name
       a version cannot answer the only question anyone will ever ask of it. */
    doc.accepted_version = args.version || doc.version || ''
    return ok({ ok: true })
  }),

  /* -------------------------------------------------------------- drafts */
  method('shotright.api.save_venue_draft', (args) => {
    const id = args.draft_id || `DRAFT-${bench.drafts.length + 1}`
    const existing = bench.drafts.find((d) => d.draft_id === id)
    const row = {
      draft_id: id,
      name: id,
      venue_name: args.venue_name || '',
      step: Number(args.step) || 0,
      completed: args.completed ?? 0,
      payload: typeof args.payload === 'string' ? args.payload : JSON.stringify(args.payload || {}),
      modified: '2026-07-28 10:00:00',
    }
    if (existing) Object.assign(existing, row)
    else bench.drafts.push(row)
    return ok({ ...row })
  }),

  method('shotright.api.list_venue_drafts', () =>
    ok(
      bench.drafts
        .filter((d) => !d.completed)
        .map((d) => {
          const row = { ...d }
          /* A listing that never says `draft_id` is not hypothetical — it is
             what `frappe.get_all` returns unless someone aliases the field. */
          if (bench.draftIdField === 'name') delete row.draft_id
          return row
        }),
    ),
  ),

  method('shotright.api.get_venue_draft', ({ draft_id }) => {
    const draft = bench.drafts.find((d) => d.draft_id === draft_id)
    return draft ? ok({ ...draft }) : docMissing()
  }),

  method('shotright.api.discard_venue_draft', ({ draft_id }) => {
    if (bench.draftDiscardSilentlyFails) return ok({ ok: true })
    bench.drafts = bench.drafts.filter((d) => d.draft_id !== draft_id)
    return ok({ ok: true })
  }),

  /* -------------------------------------------------------------- photos */
  method('shotright.api.get_venue_photos', ({ venue_name }) =>
    ok((bench.photos[venue_name] || []).map((p) => ({ ...p }))),
  ),

  method('shotright.api.set_venue_photos', (args) => {
    const rows = parse(args.photos, []) || []
    bench.photos[args.venue_name] = rows.map((r) => ({ ...r }))
    return ok({ ok: true })
  }),

  /* ------------------------------------------------------------- profile */
  method('shotright.api.update_vendor_profile', (args) => {
    const kept = declaredOnly('update_vendor_profile', args)
    Object.assign(bench.profile, kept)
    return ok({ ok: true })
  }),

  /* --------------------------------------------------------------- moods */
  method('shotright.api.get_popular_moods', () => ok([])),
  method('shotright.api.get_popular_venue_options', () => ok(null)),
  /**
   * Takes `text`, returns `{status, mood, label}`.
   *
   * The first draft of this handler read `mood_name` and returned a bare row,
   * so the wizard announced `"undefined" added.` and carried a mood with no id.
   * The contract is the one `matchMood` implements as the local fallback in
   * `services/moods.js` — that is the shape the UI is written against, so it is
   * the shape the fake bench has to speak.
   */
  method('shotright.api.resolve_mood', ({ text }) => {
    const key = String(text || '').trim().toLowerCase()
    const found = bench.moods.find((m) => m.mood_name.toLowerCase() === key)
    if (found) return ok({ status: 'canonical', mood: found.name, label: found.mood_name })

    const created = { name: `MOOD-${bench.moods.length + 1}`, mood_name: String(text).trim() }
    bench.moods.push(created)
    // A mood nobody has approved yet: attached to the venue, but flagged so the
    // wizard can say it is not in customer search until the team reviews it.
    return ok({ status: 'suggested', mood: created.name, label: created.mood_name })
  }),

  /* ------------------------------------------------------ menu import job */
  method('shotright.api.start_menu_import', () => ok({ name: 'MI-1', status: 'Queued', stage: 'uploaded' })),
  method('shotright.api.get_menu_import_status', () =>
    bench.importFails
      ? ok({
          name: 'MI-1',
          status: 'Failed',
          stage: 'reading',
          error_message: 'Row 4: Price is not a number',
        })
      : ok({ name: 'MI-1', status: 'Completed', stage: 'done', total: 0, processed: 0 }),
  ),
  method('shotright.api.cancel_menu_import', () => ok({ ok: true })),
  method('shotright.api.import_products_from_excel', () =>
    bench.importFails
      ? validationError('Row 4: <strong>Price</strong> is not a number')
      : ok({ created: 0 }),
  ),
  method('shotright.api.bulk_import_products', () => ok({ created: 0 })),

  /* ------------------------------------------------------ review screens */
  method('shotright.api.get_review_fix_items', () => ok([])),
  method('shotright.api.get_venue_review', () => ok(null)),
  method('shotright.api.get_venue_review_sections', () => ok([])),
  method('shotright.api.get_review_sections', () => ok([])),
  method('shotright.api.get_venue_progress', () => ok([])),
  method('shotright.api.set_review_fix_item', () => ok({ ok: true })),
  method('shotright.api.contact_support', () => ok({ name: 'SUP-1' })),

  /* --------------------------------------------------------- stock Frappe */
  generic('frappe.client.delete', ({ doctype, name }) => {
    if (doctype === 'Product Item') {
      const before = bench.items.length
      bench.items = bench.items.filter((i) => i.name !== name)
      if (bench.items.length === before) return docMissing()
    }
    if (doctype === 'Product Heading') {
      bench.headings = bench.headings.filter((h) => h.name !== name)
      bench.items = bench.items.filter((i) => i.parent_heading !== name)
    }
    return ok({ ok: true })
  }),

  generic('frappe.client.get_list', ({ doctype, filters }) => {
    if (doctype === 'File') {
      const f = parse(filters, {}) || {}
      const venue = f.attached_to_name
      return ok((bench.photos[venue] || []).map((p) => ({ ...p })))
    }
    return ok([])
  }),

  generic('frappe.client.set_value', () => ok({ ok: true })),

  http.all('*/api/method/upload_file', async ({ request }) => {
    if (bench.deploy.upload_file === false) return methodMissing('upload_file')
    const form = await request.formData()
    const file = form.get('file')
    const doctype = form.get('doctype')
    const docname = form.get('docname')
    record('upload_file', { doctype, docname, fileName: file?.name })

    if (
      bench.uploadRefused === 'always' ||
      bench.uploadRefused === true ||
      (bench.uploadRefused === 'attached' && docname)
    ) {
      return permissionError(
        `User <strong>thabo@cornerkitchen.co.za</strong> does not have doctype access via role permission for document ${doctype || 'File'}`,
      )
    }

    const row = {
      name: `FILE-${bench.files.length + 1}`,
      file_url: `/files/${bench.files.length + 1}-${file?.name || 'photo.jpg'}`,
      file_name: file?.name || 'photo.jpg',
      attached_to_name: docname || null,
    }
    bench.files.push(row)
    return ok(row)
  }),

  /* The Mood doctype is read through Frappe's generic resource API. */
  http.get('*/api/resource/Mood', () => HttpResponse.json({ data: bench.moods.map((m) => ({ ...m })) })),

  /**
   * Any `shotright.api.*` method with no handler above is NOT DEPLOYED.
   *
   * Last in the list, so every specific handler wins first. This exists because
   * the portal legitimately probes a LIST of candidate names for endpoints
   * nobody has committed to yet — update_product_item, then edit_product_item,
   * then set_product_item. Without this, the second and third probes hit
   * `onUnhandledRequest: 'error'` and surfaced as a network failure, so the app
   * reported "something went wrong" instead of "the server has no way to do
   * this" — the wrong message, from the right code.
   *
   * A truthful 404 here is what lets a capability probe mean what it says.
   */
  http.all('*/api/method/shotright.api.:method', ({ params }) =>
    methodMissing(`shotright.api.${params.method}`),
  ),

  /* Photo <img> requests. jsdom won't decode them, but they must not 'error'. */
  http.get('*/files/*', () => new HttpResponse(null, { status: 200 })),

  /**
   * Nominatim — OpenStreetMap's geocoder, called by the address field.
   *
   * Caught by `onUnhandledRequest: 'error'` on the first verbose run: the
   * suite was reaching for **the live internet**. Nothing failed, because the
   * component degrades to "address suggestions are unavailable right now" — but
   * a test that quietly depends on a third-party service is a test that goes red
   * on a train, and it was putting real load on a free community endpoint every
   * time anyone typed an address in a test.
   *
   * Returns one plausible suggestion so the autocomplete path is exercised
   * rather than only its failure branch.
   */
  http.get('https://nominatim.openstreetmap.org/search', ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') || ''
    return HttpResponse.json([
      {
        place_id: 1,
        display_name: `${q}, Gauteng, South Africa`,
        lat: '-25.7069',
        lon: '28.2294',
        address: { road: q, city: 'Pretoria', country_code: 'za' },
      },
    ])
  }),
]

export const server = setupServer(...apiHandlers)

export { methodMissing, validationError, permissionError, docMissing, ok }
