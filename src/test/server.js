import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { bench, headingsFor, venueById } from './bench'

/* ------------------------------------------------------------ Frappe shapes */

/**
 * A missing whitelisted method — as THIS bench actually reports one.
 *
 * ⚠️ Verified on shotright.thedaystar.co.za, 5 Sep. Asking for a name that is
 * not in `shotright.api` does NOT return 404 "Method Not Found". It returns:
 *
 *   417  AttributeError: module 'shotright.api' has no attribute 'x'
 *
 * This mock returned the 404, which is what a Frappe bench returns when the
 * MODULE path itself does not resolve — a different case. So every capability
 * probe in the portal passed here and failed in production: `isMethodMissing`
 * was gated on the status, and no fallback on the live site ever engaged.
 *
 * Sixth time this session a double disagreeing with the server has cost us a
 * bug, and the widest-reaching of them.
 *
 * `bench.missingMethodStyle` keeps the old shape available, because a bench
 * whose whole app is absent really does answer that way and the portal must
 * still understand it.
 */
const methodMissing = (method) => {
  if (bench.missingMethodStyle === 'not-found') {
    return HttpResponse.json(
      {
        exc_type: 'DoesNotExistError',
        exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${method}`,
      },
      { status: 404 },
    )
  }
  const attribute = method.split('.').pop()
  const module = method.split('.').slice(0, -1).join('.')
  return HttpResponse.json(
    {
      exc_type: 'AttributeError',
      exception: `AttributeError: module '${module}' has no attribute '${attribute}'`,
    },
    { status: 417 },
  )
}

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

/**
 * Frappe's answer to being called with the wrong argument name.
 *
 * A whitelisted method takes the form dict as kwargs, so a name it does not
 * declare is an unexpected keyword and the one it needs is missing — both
 * TypeErrors, and neither is silently ignored the way an undeclared field on a
 * doc write is. The portal's search for the right name depends on telling those
 * apart from a real refusal.
 */
const ITEM_PARAM_NAMES = ['item_id', 'item', 'name']

const itemParamError = (fn, args) => {
  const wanted = bench.itemIdParam
  const given = ITEM_PARAM_NAMES.filter((p) => p in args)
  const extra = given.find((p) => p !== wanted)
  if (extra) {
    return HttpResponse.json(
      {
        exc_type: 'TypeError',
        exception: `TypeError: ${fn}() got an unexpected keyword argument '${extra}'`,
      },
      { status: 417 },
    )
  }
  if (!given.includes(wanted)) {
    return HttpResponse.json(
      {
        exc_type: 'TypeError',
        exception: `TypeError: ${fn}() missing 1 required positional argument: '${wanted}'`,
      },
      { status: 417 },
    )
  }
  return null
}

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

    /* The average-spend key, renamed to whatever this bench calls it — or
       removed entirely. The portal reads the name off this payload rather than
       guessing, so the rename is the whole point of the switch. */
    if (bench.spendField !== 'average_spend') {
      const value = out.average_spend
      delete out.average_spend
      if (bench.spendField) out[bench.spendField] = value
    }
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

      /**
       * ⚠️ WHAT THE BENCH REALLY DOES WITH MOODS, verified 5 Sep by trying to
       * break it. `normalise_moods` reads a bare name, a `{mood: ...}` row, or
       * a JSON string — and THROWS on anything else rather than writing empty
       * rows and reporting success:
       *
       *   [{"name": "Romantic"}]  -> refused, existing set untouched
       *   ["Nope"]                -> refused: Unknown mood: Nope
       *
       * The portal declined to send moods at all for weeks on the theory that a
       * wrong key would silently erase them. That is real Frappe behaviour and
       * it is not this endpoint's behaviour; modelling it here is what stops
       * that caution being reinvented.
       */
      if (key === 'moods' && Array.isArray(parsed)) {
        const unreadable = parsed.find(
          (row) => !(typeof row === 'string' || (row && typeof row === 'object' && row.mood)),
        )
        if (unreadable) return validationError('Could not read that mood')
        const names = parsed.map((row) => (typeof row === 'string' ? row : row.mood))
        const unknown = names.find((n) => !bench.moods.some((m) => m.name === n || m.mood === n))
        if (unknown) return validationError(`Unknown mood: ${unknown}`)
      }

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

      /**
       * ⚠️ A FIELD THAT IS ACCEPTED AND NOT STORED.
       *
       * Frappe discards an undeclared kwarg silently at HTTP 200, so a field
       * the whitelisted method has no parameter for is taken, acknowledged and
       * dropped. This bench used to store everything it accepted, which made
       * that failure — the one behind "the starting time and the moods don't
       * persist" — impossible to write a test for.
       *
       * Fourth time a double that was tidier than the server has cost us a bug,
       * after the File docname, the unpadded Time hour and the HTML in a menu
       * description.
       */
      if ((bench.silentlyDrops || []).includes(key)) continue

      venue[key] = parsed
    }
    return ok({ ...venue })
  }),

  /**
   * Google sign-in, as a bench that HAS it would answer.
   *
   * Off by default (`bench.deploy.login_with_google`), so the ordinary suite
   * runs against a bench that has never heard of it — which is the state the
   * live one is in until the backend says otherwise, and the state in which no
   * button may appear.
   *
   * The parameter is `credential` here. The portal does not know that, so it
   * tries `credential`, `id_token` and `token` in turn; this rejects the wrong
   * ones the way Frappe does, with a TypeError about an unexpected keyword,
   * rather than quietly accepting them.
   */
  method('shotright.api.login_with_google', (args) => {
    if (!bench.deploy.login_with_google) return methodMissing('shotright.api.login_with_google')

    const unexpected = Object.keys(args).filter((k) => k !== 'credential' && k !== 'cmd')
    if (unexpected.length) {
      return HttpResponse.json(
        {
          exc_type: 'TypeError',
          exception: `TypeError: login_with_google() got an unexpected keyword argument '${unexpected[0]}'`,
        },
        { status: 417 },
      )
    }

    // The probe: no credential at all. A method that EXISTS says so by
    // refusing, and that refusal is what tells the portal it is there.
    if (!args.credential) return validationError('credential is required')

    if (args.credential === 'unverified-account') {
      return ok({ otp_required: true, email: 'new@partner.co.za' })
    }
    if (args.credential !== 'good-google-token') {
      return validationError('That Google sign-in could not be verified.')
    }
    return ok({ api_key: 'GK', api_secret: 'GS' })
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
      /* ⚠️ Frappe's Text Editor field stores HTML, so what comes back out is
         `<p>the sentence</p>` and NOT the sentence. This mock used to hand back
         exactly what was sent, which is how the live site ended up printing
         `<p>Tomatoes, creamy burrata…</p>` at a partner while every test was
         green. Third time this shape of mistake has cost us a bug (see the File
         docname in #23 and the unpadded Time hour in #27): a double may be
         simpler than the server, never different from it. */
      description: args.description ? `<p>${args.description}</p>` : '',
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
  /**
   * ⚠️ THE ITEM IS ADDRESSED AS `item_id`. Verified from the live bench:
   *
   *   TypeError: update_product_item() missing 1 required positional argument:
   *   'item_id'
   *
   * This mock used to accept `item` or `name` — the two the portal was guessing
   * at, and the two the real method does NOT declare — so a green suite covered
   * a feature that could never once have worked. Fifth time a double
   * disagreeing with the server has cost us a bug, after the File docname, the
   * unpadded Time hour, the HTML in a description, and the fields update_venue
   * silently drops.
   */
  method('shotright.api.update_product_item', (args) => {
    const wrong = itemParamError('update_product_item', args)
    if (wrong) return wrong
    const item = bench.items.find((i) => i.name === args[bench.itemIdParam])
    if (!item) return docMissing()
    if (args.item_name !== undefined) item.item_name = args.item_name
    if (args.price !== undefined) item.price = Number(args.price) || 0
    if (args.description !== undefined) item.description = args.description
    return ok({ ok: true })
  }),

  method('shotright.api.delete_product_item', (args) => {
    const wrong = itemParamError('delete_product_item', args)
    if (wrong) return wrong
    const id = args[bench.itemIdParam]
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

  /**
   * ⚠️ THE REAL CONTRACT, verified on the bench 5 Sep. Two endpoints, not one:
   *
   *   get_required_consents()          -> [{policy_type, version}]
   *   get_legal_document(policy_type)  -> {name, policy_type, version, content,
   *                                        published_on}
   *
   * This mock used to serve a single `get_legal_documents` returning everything
   * at once — a method that has never existed on the bench, in a shape it has
   * never used. The portal was written against the mock, so the whole legal
   * feature was tested against a fiction.
   */
  method('shotright.api.get_required_consents', () =>
    bench.legalListRefuses
      ? validationError('Could not read the consent list')
      : ok(
          bench.legal.map((d) => ({
            policy_type: d.policy_type || d.title,
            version: d.version || '',
            /* The live example carries only the type and the version. These are
               here because the fixture may model a bench that says more, and
               `normalise` reads an absent acceptance marker as NOT accepted —
               the safe direction. */
            ...(d.accepted ? { accepted: 1, accepted_on: d.accepted_on || '2026-09-01' } : {}),
            ...(d.required === undefined ? {} : { required: d.required }),
          })),
        ),
  ),

  /**
   * One document's text. `policy_type` is required — a Select, not free text.
   *
   * `Usage Policy` is a valid type with NOTHING PUBLISHED, so an empty answer
   * is normal here rather than a failure, and the portal must show no tickbox
   * over it rather than an error.
   */
  method('shotright.api.get_legal_document', (args) => {
    if (!args.policy_type) {
      return HttpResponse.json(
        {
          exc_type: 'TypeError',
          exception:
            "TypeError: get_legal_document() missing 1 required positional argument: 'policy_type'",
        },
        { status: 417 },
      )
    }
    const doc = bench.legal.find((d) => (d.policy_type || d.title) === args.policy_type)
    if (!doc || doc.content === undefined) return ok(null)
    return ok({
      name: `${args.policy_type}-${doc.version || '2026-01-01'}`,
      policy_type: args.policy_type,
      version: doc.publishedVersion || doc.version || '',
      content: doc.content ?? '',
      published_on: doc.effective_date || '2026-08-20 15:14:10',
    })
  }),

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
    /* Documents are addressed by `policy_type` on this bench, and the docname
       the portal now holds is the one `get_legal_document` returned — which is
       `<policy_type>-<version>`. Both resolve here.

       ⚠️ The accept METHOD NAME is still a guess. The backend confirmed
       `get_required_consents` and `get_legal_document` on 5 Sep and said nothing
       about recording an acceptance, so `canEnforce` still refuses to gate on
       it. This handler models what one would look like, not what one is. */
    const doc = bench.legal.find(
      (d) =>
        d.name === id ||
        (d.policy_type || d.title) === id ||
        `${d.policy_type || d.title}-${d.version || ''}` === id,
    )
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
    /* The real `_normalise` (venue_photos.py) refuses any row without a `file`
       docname, with exactly this message at 417. Accepting such rows here is
       how the `uploaded.name`/`uploaded.file` drift survived 63 green checks. */
    if (rows.some((r) => !r || typeof r !== 'object' || !r.file))
      return validationError('Each photo needs a `file` (the File docname)')
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
  /**
   * The importer, and what it does with the way we name the uploaded file.
   *
   * `bench.importerWants` is the parameter this bench's method actually
   * declares. Anything else gets Frappe's TypeError, which is what a whitelisted
   * method really does with an unexpected keyword — it does NOT ignore it the
   * way a doc write does. `'none'` models an importer that refuses every shape.
   */
  method('shotright.api.start_menu_import', (args) => {
    const wanted = bench.importerWants
    if (wanted && !(wanted in args)) {
      return HttpResponse.json(
        {
          exc_type: 'TypeError',
          exception: `TypeError: start_menu_import() got an unexpected keyword argument '${
            Object.keys(args).find((k) => k !== 'venue_name' && k !== 'cmd') || 'file_name'
          }'`,
        },
        { status: 417 },
      )
    }
    return ok({ name: 'MI-1', status: 'Queued', stage: 'uploaded' })
  }),
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

    /**
     * ⚠️ `doctype=Venue` IS A PERMANENT 403. Verified on the bench 22 Aug.
     *
     * Vendors hold ["All", "Guest"]; `Venue` grants write to System Manager and
     * Venue Reviewer only. There is no attach grant and there must never be
     * one — Frappe role permissions are not row-scoped, so granting it would
     * let every partner write every other partner's venue.
     *
     * Modelled here unconditionally, rather than behind `uploadRefused`,
     * because it is not a bench state that might change. It is the contract. A
     * portal that starts sending `doctype=Venue` again fails immediately here
     * rather than in production.
     */
    if (doctype === 'Venue') {
      return permissionError(
        'User <strong>thabo@cornerkitchen.co.za</strong> does not have doctype access via role permission for document Venue',
      )
    }

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

  /**
   * `shotright.api.upload_venue_photo` — the whitelisted method that elevates.
   *
   * Live on the bench since 22 Aug and the fix for three separate symptoms. It
   * takes the file and a venue and does the attach internally, so the Vendor
   * role never needs write on `Venue` at all.
   */
  http.all('*/api/method/shotright.api.upload_venue_photo', async ({ request }) => {
    if (bench.deploy.upload_venue_photo === false)
      return methodMissing('shotright.api.upload_venue_photo')

    const form = await request.formData()
    const file = form.get('file')
    const venue = form.get('venue_name') || form.get('venue') || form.get('docname')
    record('upload_venue_photo', { venue_name: venue, fileName: file?.name })

    if (!venue) return validationError('venue_name is required')
    if (!bench.venues.some((v) => v.name === venue)) return validationError('Not permitted')

    if (bench.uploadRefused === 'always' || bench.uploadRefused === true) {
      return permissionError('Not permitted')
    }

    /* Verified 22 Aug: .heic, .heif and .avif are refused with a terminal 417.
       Since the format split in `utils/image.js` the portal converts all three
       to JPEG before sending, so nothing should ever trip this. It stays
       precisely so that a regression in that conversion shows up as a failing
       test here rather than as a partner who cannot list their venue. */
    if (/\.(heic|heif|avif)$/i.test(file?.name || '')) {
      return validationError('Unsupported image format')
    }

    const row = {
      name: `FILE-${bench.files.length + 1}`,
      file_url: `/files/${bench.files.length + 1}-${file?.name || 'photo.jpg'}`,
      file_name: file?.name || 'photo.jpg',
      attached_to_name: venue,
    }
    bench.files.push(row)
    /* ⚠️ 23 Aug: the REAL endpoint returns the File docname as `file`, not
       `name` — venue_photos.py builds `{file, file_url, file_name, photos}`.
       This mock used to return the row as-is, i.e. with `name`, so the suite
       green-lit a client that read `uploaded.name` and then sent
       `file: undefined` to set_venue_photos — a 417 on the live bench that no
       test could see. The fake bench speaks the server's actual shape. */
    return ok({ file: row.name, file_url: row.file_url, file_name: row.file_name })
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
