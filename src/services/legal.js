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
export const LEGAL_LIST_METHODS = [
  'shotright.api.get_legal_documents',
  'shotright.api.get_vendor_legal_documents',
  'shotright.api.list_legal_documents',
  'shotright.api.get_terms',
]

export const LEGAL_ACCEPT_METHODS = [
  'shotright.api.accept_legal_document',
  'shotright.api.accept_legal_documents',
  'shotright.api.record_legal_acceptance',
  'shotright.api.accept_terms',
]

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
    id: raw?.name || raw?.document || raw?.id || `legal-${index}`,
    title: raw?.title || raw?.document_name || raw?.document_type || raw?.subject || 'Document',
    kind: raw?.document_type || raw?.type || raw?.category || '',
    version: String(versionOf(raw) || ''),
    effectiveOn: raw?.effective_date || raw?.effective_from || raw?.valid_from || '',
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
    const documents = rows.map(normalise)
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
            document: document.id,
            legal_document: document.id,
            name: document.id,
            document_name: document.id,
            version: document.version || undefined,
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
