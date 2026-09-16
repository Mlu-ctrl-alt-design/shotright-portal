import { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * Legal documents, and the vendor's acceptance of them.
 *
 * ⚠️ THIS FILE HAS A DIFFERENT FAILURE MODE FROM EVERY OTHER SERVICE HERE.
 *
 * Everywhere else, a write we cannot confirm is a bad afternoon: the partner
 * retypes a price, re-uploads a photo, and nothing outside the portal has
 * changed. Consent is not like that. If this screen says "accepted" and no row
 * exists on the bench, we have manufactured a record of agreement that isn't
 * real — and the first time it matters will be a dispute, months later, with
 * nothing to produce.
 *
 * So three rules apply here that are stricter than the rest of the codebase:
 *
 * 1. **Only an explicit server success counts as recorded.** No optimism, no
 *    `?? {ok: true}` (which `setBookingStatus` does quite reasonably), and the
 *    acceptance is READ BACK before the UI is allowed to say it worked. Frappe
 *    drops undeclared kwargs silently at HTTP 200 — a 200 here proves nothing
 *    on its own, and it is the exact shape of the six bugs this project has
 *    already had.
 * 2. **Never ask someone to accept text they cannot see.** A document whose
 *    body failed to load gets no checkbox. Consent to an unread document is not
 *    consent, and a tickbox over an empty panel is worse than an outage.
 * 3. **Never block on a capability we cannot fulfil.** If the bench can list
 *    documents but not record acceptance, gating submission would trap every
 *    partner behind a button that cannot work. The gate engages only when BOTH
 *    halves are deployed — see `canEnforce` below.
 *
 * NOT DEPLOYED YET, as far as this portal knows. The backend said on 7 Aug that
 * legal documents exist; no method name or shape came with that, so this is
 * written the way everything unshipped here is written — candidate names tried
 * in order, generous field aliasing, and a screen that is honest about which of
 * the two halves it has. When the real names land, the list below is the only
 * thing that changes; if one of these IS the name, nothing changes at all.
 *
 * No `frappe.client.get_list` fallback, deliberately: the Vendor role has no
 * doctype access at all on this bench, so it would 403 every time and buy us a
 * misleading error instead of a clean "not deployed".
 */
/**
 * ⚠️ CORRECTED 5 Sep, from the bench itself.
 *
 * `get_legal_documents` — the plural, which this portal asked for from the
 * start — does not exist and is not going to. All seventeen names we had
 * guessed answered the same way:
 *
 *   AttributeError: module 'shotright.api' has no attribute 'get_legal_documents'
 *
 * Two real endpoints were there the whole time, and the shape is different from
 * the one guessed for: the list and the text are SEPARATE CALLS.
 *
 *   get_required_consents()          -> [{policy_type, version}]
 *   get_legal_document(policy_type)  -> {name, policy_type, version, content,
 *                                        published_on}
 *
 * Kept as a list because the mechanism costs nothing and the alternative — one
 * hardcoded name — is what produced seventeen wrong guesses. The verified name
 * is first; nothing else is a guess any more.
 */
export const LEGAL_LIST_METHODS = ['shotright.api.get_required_consents']

/** One document's text. `policy_type` is required — a Select, not free text. */
export const LEGAL_DOCUMENT_METHOD = 'shotright.api.get_legal_document'

/**
 * ⚠️ NOT "Privacy Policy". The valid values are `POPIA Notice`,
 * `Terms of Service` and `Usage Policy` — the route is `/privacy-policy`, which
 * is where the confusion comes from, and asking for that value is an error
 * rather than an empty answer.
 *
 * `Usage Policy` is valid AND has nothing published, so it returns nothing
 * rather than failing. A document with no text gets no tickbox — see rule 2 at
 * the top of this file — so that case needs no special handling here, only the
 * knowledge that it is normal.
 */
export const POLICY_TYPES = ['POPIA Notice', 'Terms of Service', 'Usage Policy']

/**
 * ⚠️ CORRECTED 13 Sep, from the bench's own access log.
 *
 * `accept_terms` is the ONE endpoint, and the three names above it were dead
 * probes. Every attempt cost three guaranteed 417s before the real call:
 *
 *   POST accept_legal_document    417   ← no such method
 *   POST accept_legal_documents   417   ← no such method
 *   POST record_legal_acceptance  417   ← no such method
 *   POST accept_terms             200   ← the acceptance, recorded
 *
 * The backend states plainly that those three "still 417 on purpose" and that
 * `accept_terms` is the only way to record a consent, so they are not a fallback
 * chain, they are three red rows in a partner's network tab on the one screen
 * where a partner is least inclined to trust us. Removed.
 *
 * Kept as a list for the same reason `LEGAL_LIST_METHODS` is: the mechanism
 * costs nothing and one hardcoded name is what produced seventeen wrong guesses.
 */
export const LEGAL_ACCEPT_METHODS = ['shotright.api.accept_terms']

/**
 * WHICH DOCUMENTS THIS USER STILL OWES, as the bench sees it.
 *
 * ⚠️ 13 Sep. `get_required_consents` is the list of ACTIVE POLICIES. It is not
 * user-scoped and it never carries an acceptance marker — every row is
 * `{policy_type, version}` and nothing else. So `normalise` read `accepted` as
 * false for every document, on every load, no matter what the user had already
 * signed: `acceptDocument` recorded the consent, read the list back, found the
 * same two rows as before, and reported `not-persisted`. The partner was told
 * "your acceptance didn't save" over a row that had saved perfectly — nine times
 * for one user, once per retry, each one a fresh Consent Record.
 *
 * `get_outstanding_consents` is the user-scoped half, and it was deployed the
 * whole time. It answers `[]` once everything is accepted, which is exactly the
 * proof rule 1 at the top of this file asks for.
 *
 * Returns null — NOT an empty set — when we could not ask. An unanswered
 * question must never read as "nothing outstanding", which would tick every box
 * on the screen off the back of a failed request.
 */
export const LEGAL_OUTSTANDING_METHOD = 'shotright.api.get_outstanding_consents'

const consentKey = (policyType, version) => `${policyType || ''}|${version || ''}`

const outstandingConsents = async () => {
  try {
    const rows = await callGet(LEGAL_OUTSTANDING_METHOD, {})
    if (!Array.isArray(rows)) return null
    return new Set(rows.map((row) => consentKey(row?.policy_type, row?.version)))
  } catch (error) {
    console.warn(
      `[shotright] ${LEGAL_OUTSTANDING_METHOD} answered ${error?.status || 'an error'}: ` +
        `${error?.message || 'no message'}. Acceptance cannot be confirmed, so every ` +
        `document stays unaccepted — the cautious direction.`,
    )
    return null
  }
}

/**
 * Mark the documents this user has already accepted.
 *
 * Absent from `outstanding` means accepted. `null` means we could not ask, and
 * then nothing is marked: same reasoning as `accepted` in `normalise`, the cost
 * of being wrong this way is asking someone to accept twice.
 *
 * A document we cannot KEY is never marked. "Absent from the outstanding list"
 * only means accepted if we are asking the list the right question, and a
 * document with no policy type would be absent from it for the wrong reason —
 * which is the one direction this screen must never be wrong in.
 */
const markAccepted = (documents, outstanding) =>
  outstanding === null
    ? documents
    : documents.map((d) => {
        if (d.accepted) return d
        if (!d.kind || !d.version) return d
        return outstanding.has(consentKey(d.kind, d.version)) ? d : { ...d, accepted: true }
      })

/**
 * WHERE ACCEPTANCE IS ENFORCED.
 *
 * `submit` — a partner can sign in, read their dashboard and edit drafts with a
 * banner up, but a venue cannot go for approval until the outstanding documents
 * are accepted. That is the moment the agreement starts to matter: it is when a
 * listing enters our review queue and heads for real customers.
 *
 * The alternative is `login`, which blocks the entire portal. It is the
 * stronger legal position and it is one word to change here — but it also means
 * a misconfigured document or a flaky accept endpoint locks every partner out
 * of their own data at once, and this file cannot tell those two apart from the
 * inside. Chosen deliberately, flagged for the business to overrule.
 */
export const ENFORCE_AT = 'submit'

/** A version we can name is the difference between a record and a shrug. */
const versionOf = (raw) =>
  raw?.version || raw?.document_version || raw?.revision || raw?.effective_date || ''

/**
 * One document, normalised.
 *
 * `accepted` is deliberately strict: only an explicit truthy acceptance marker
 * counts. An absent field means NOT accepted, which is the safe direction to be
 * wrong in — the cost is asking someone to accept twice, and the cost the other
 * way is a venue going live under an agreement nobody made.
 */
const normalise = (raw, index) => {
  const accepted = Boolean(
    raw?.accepted ?? raw?.is_accepted ?? raw?.accepted_by_vendor ?? raw?.accepted_on ?? false,
  )
  return {
    /* `policy_type` and `published_on` are the REAL field names on this bench,
       confirmed 5 Sep. They lead; the rest are the aliases this file already
       carried, kept because they cost nothing and a second bench may differ. */
    id: raw?.name || raw?.document || raw?.id || raw?.policy_type || `legal-${index}`,
    title:
      raw?.title ||
      raw?.policy_type ||
      raw?.document_name ||
      raw?.document_type ||
      raw?.subject ||
      'Document',
    kind: raw?.policy_type || raw?.document_type || raw?.type || raw?.category || '',
    version: String(versionOf(raw) || ''),
    effectiveOn:
      raw?.effective_date || raw?.published_on || raw?.effective_from || raw?.valid_from || '',
    /* Frappe Text Editor fields come back as HTML. `url` is the fallback for a
       document held as a file rather than a field. */
    body: raw?.content || raw?.body || raw?.document_html || raw?.description || '',
    url: raw?.url || raw?.file_url || raw?.document_url || '',
    /* Everything is required unless the server says otherwise. Same reasoning
       as `accepted`: default to the cautious reading. */
    required: raw?.required === undefined ? true : Boolean(raw.required),
    accepted,
    acceptedOn: raw?.accepted_on || raw?.acceptance_date || '',
  }
}


/**
 * The consent list carries a policy type and a version. Not the text.
 *
 * So each document is fetched separately, and that is the whole reason this
 * function exists: rule 2 at the top of this file says nobody is asked to
 * accept something they cannot read, and until the text is in hand we do not
 * know whether we can show it.
 *
 * FETCHED IN PARALLEL, and a failure for one is that document's problem alone.
 * One unpublished policy must not take the other two off the screen — and there
 * IS one: `Usage Policy` is a valid type with nothing published behind it, so
 * an empty answer here is a normal Tuesday rather than an outage.
 */
const withText = async (rows) =>
  Promise.all(
    rows.map(async (row, index) => {
      const type = row?.policy_type || row?.type || row?.document_type
      if (!type) return normalise(row, index)

      let document = null
      try {
        document = await callGet(LEGAL_DOCUMENT_METHOD, { policy_type: type })
      } catch (error) {
        console.warn(
          `[shotright] ${LEGAL_DOCUMENT_METHOD}(policy_type="${type}") failed: ` +
            `${error?.message || 'no message'}. That document gets no tickbox.`,
        )
      }

      /**
       * The consent row wins on `version`, and that is deliberate. It says
       * which version a partner is being asked to agree to; the document says
       * which one is published. When they differ, the thing to record is what
       * was asked for — and the mismatch is worth a line in the console,
       * because it means the required version is not the one on screen.
       */
      if (document && row?.version && document.version && row.version !== document.version) {
        console.warn(
          `[shotright] ${type}: consent asks for version ${row.version}, the published ` +
            `document is ${document.version}. The partner is reading the wrong text.`,
        )
      }

      /* The consent row wins on version — it says what is being agreed to — and
         the document supplies everything the consent list does not carry: the
         text, the docname, and when it was published. */
      return normalise(
        {
          ...(document || {}),
          ...row,
          version: row?.version || document?.version || '',
          content: document?.content ?? '',
        },
        index,
      )
    }),
  )

/**
 * @returns `{available, documents, outstanding, canAccept, method}`
 *
 * `available: false` means we could not ask — NOT that there is nothing to
 * accept. Callers must not read an unanswered question as a clean bill of
 * health, which is why `outstanding` is an array and the gate checks
 * `available` separately rather than trusting `outstanding.length === 0`.
 */
export const getLegalDocuments = async () => {
  if (USE_MOCKS) {
    const rows = (await import('./mockBackend')).mockBackend.getLegalDocuments?.() || []
    const documents = (await rows).map(normalise)
    return { available: true, documents, outstanding: outstandingOf(documents), canAccept: true }
  }

  /**
   * ⚠️ A METHOD THAT EXISTS AND REFUSES IS NOT THE END OF THE LIST.
   *
   * Seen on the live site, 5 Sep:
   *
   *   GET /api/method/shotright.api.get_legal_documents  →  417
   *
   * 417 is Frappe's ValidationError: the request reached the bench, the method
   * ran, and it threw. This loop used to return on the first such error, so one
   * unhappy candidate hid the three behind it — and since the portal sends NO
   * arguments at all, the likeliest cause is an argument the method requires
   * and we do not know about.
   *
   * So a refusal is remembered and the next name is tried. The first error is
   * what gets reported if every one of them fails, because it came from the
   * method most likely to be the real one.
   */
  let firstError = null
  let firstErrorMethod = null

  for (const method of LEGAL_LIST_METHODS) {
    let payload
    try {
      payload = await withFallback(
        method,
        async () => await callGet(method, {}),
        async () => undefined,
      )
    } catch (error) {
      /**
       * The bench's own words, to the CONSOLE and never to the partner.
       *
       * Whatever it says — a missing argument, no vendor profile, a broken
       * document row — is the one thing that turns "legal documents don't load"
       * into a one-line question for whoever owns the bench. Losing it inside a
       * generic failure state is how this stays unfixed.
       */
      console.warn(
        `[shotright] ${method} answered ${error?.status || 'an error'}: ` +
          `${error?.message || 'no message'}. The portal sends no arguments to this ` +
          `method — if it requires one, that is the gap.`,
      )
      if (!firstError) {
        firstError = error
        firstErrorMethod = method
      }
      continue
    }
    if (payload === undefined) continue

    const rows = Array.isArray(payload) ? payload : payload?.documents || payload?.data || []
    /* Two calls, in parallel: the texts, and what this user still owes. The
       second is the only thing on this screen that can tell an accepted
       document from an unaccepted one — see LEGAL_OUTSTANDING_METHOD. */
    const [withTexts, outstandingSet] = await Promise.all([withText(rows), outstandingConsents()])
    const documents = markAccepted(withTexts, outstandingSet)
    return {
      available: true,
      documents,
      outstanding: outstandingOf(documents),
      method,
    }
  }

  if (firstError) {
    return {
      available: false,
      documents: [],
      outstanding: [],
      errored: true,
      error: firstError,
      method: firstErrorMethod,
    }
  }

  return { available: false, documents: [], outstanding: [] }
}

/** Required, not yet accepted. The only list the gate cares about. */
export const outstandingOf = (documents) => documents.filter((d) => d.required && !d.accepted)

/**
 * Record acceptance of one document, and PROVE it.
 *
 * The read-back is the whole function. A 200 from Frappe means the request was
 * routed, not that anything was written: kwargs the method does not declare are
 * dropped silently, so `document=` reaching a handler that expects `doc=` is a
 * cheerful 200 over an empty table. Everywhere else in this codebase that costs
 * a retype. Here it would put "Accepted 7 August 2026" on screen over nothing.
 *
 * @returns `{recorded, method, reason}` — `recorded` is true ONLY when the
 *          document came back marked accepted. Anything else, including a
 *          perfectly healthy-looking 200, returns false with a reason.
 */
export const acceptDocument = async (document) => {
  if (!document?.id) return { recorded: false, reason: 'no-document' }

  if (USE_MOCKS) {
    await (await import('./mockBackend')).mockBackend.acceptLegalDocument?.(document.id)
    return { recorded: true }
  }

  for (const method of LEGAL_ACCEPT_METHODS) {
    let responded = false
    try {
      const result = await withFallback(
        method,
        async () => {
          /* Every alias the handler might declare, sent together. Frappe drops
             the ones it does not know rather than objecting, so this costs
             nothing and removes a whole class of silent no-op. The VERSION goes
             with it: "they accepted" is a weaker record than "they accepted
             v2.1 on this date". */
          await call(method, {
            /* `policy_type` + `version` is `accept_terms`'s primary contract,
               and it records exactly what the partner was ASKED to accept —
               the consent row wins on version, see `withText`. The docname
               aliases stay as the fallback for a document we only know by
               name; the endpoint ignores them when the pair is present. */
            policy_type: document.kind || undefined,
            version: document.version || undefined,
            document: document.id,
            legal_document: document.id,
            name: document.id,
            document_name: document.id,
            accepted: 1,
          })
          return true
        },
        async () => undefined,
      )
      if (result === undefined) continue
      responded = true
    } catch (error) {
      return { recorded: false, method, reason: 'threw', error }
    }

    if (!responded) continue

    /* The proof. If the server cannot show us the acceptance it just took, we
       do not tell a partner it was recorded. */
    const after = await getLegalDocuments()
    if (!after.available) return { recorded: false, method, reason: 'unverifiable' }

    const found = after.documents.find((d) => d.id === document.id)
    if (found?.accepted) return { recorded: true, method, document: found }
    return { recorded: false, method, reason: 'not-persisted' }
  }

  return { recorded: false, reason: 'no-endpoint' }
}

/**
 * May the portal hold a partner to this?
 *
 * Only when it can both READ the documents and RECORD an acceptance. A gate we
 * cannot let anyone through is not a gate, it is an outage with a legal
 * justification written on it.
 *
 * Note this deliberately does NOT probe the accept endpoint — probing it means
 * calling it, and calling it means recording an acceptance nobody made. So the
 * unknown case resolves to "do not enforce": we would rather a venue reach the
 * review queue unaccepted, where a human sees it, than lock a partner out of
 * work they have already paid for.
 */
export const canEnforce = (standing) => Boolean(standing?.available)
