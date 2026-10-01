import api, { call, callGet } from './api'
import { withFallback } from './vendor'

/**
 * Claiming a venue that is already in the Sho't Right catalogue.
 *
 * Backend: shotright PRs #43, #50, #51 (`venue_claims.py`), live since 19 Sep.
 * The catalogue is 1,132 venues nobody owns, invisible to customers until
 * someone who does own one photographs it and submits it. This is the only
 * road from that catalogue to a customer's screen.
 *
 * Two ways in, one page to finish on:
 *  - from the customer app, which opens `/claim/<token>` in the browser
 *  - from the portal's own search at `/claim`, which opens the same claim and
 *    follows the same link
 *
 * What the bench guarantees, and this file relies on:
 *  - A search needs 2+ characters, returns at most 20 rows, and says whether a
 *    venue is `owned` — never by whom.
 *  - Starting a claim twice on one venue returns the same claim with a fresh
 *    link. A claim already filed comes back with `claim_url: null`.
 *  - The link's token is single-use: filing spends it. After that the claim's
 *    docname is the handle for its evidence.
 *  - Filing needs a "Venue Claim" code sent to the PARTNER's address. The code
 *    is consumed by `file_venue_claim` itself — never call `verify_otp` first,
 *    or the code is gone before the claim is filed.
 */
export const SEARCH_METHOD = 'shotright.api.search_claimable_venues'
export const START_METHOD = 'shotright.api.start_venue_claim'
export const HANDOFF_METHOD = 'shotright.api.get_venue_claim_handoff'
export const FILE_METHOD = 'shotright.api.file_venue_claim'
export const MY_CLAIMS_METHOD = 'shotright.api.get_my_venue_claims'
export const UPLOAD_EVIDENCE_METHOD = 'shotright.api.upload_venue_claim_evidence'
export const LIST_EVIDENCE_METHOD = 'shotright.api.get_venue_claim_evidence'
export const REMOVE_EVIDENCE_METHOD = 'shotright.api.remove_venue_claim_evidence'
/* The claimant taking a claim back, and the other side of a dispute: the
   partner who holds a venue somebody has claimed. Backend branch
   feat/claims-owner-side; on an older bench these are absent. */
export const WITHDRAW_METHOD = 'shotright.api.withdraw_venue_claim'
export const ON_MY_VENUES_METHOD = 'shotright.api.get_claims_on_my_venues'
export const RESPOND_METHOD = 'shotright.api.respond_to_venue_claim'
export const UPLOAD_RESPONSE_EVIDENCE_METHOD = 'shotright.api.upload_venue_claim_response_evidence'
export const REMOVE_RESPONSE_EVIDENCE_METHOD = 'shotright.api.remove_venue_claim_response_evidence'

export const MIN_QUERY = 2
/** The Select options on `Venue Claim.claimant_role`, verbatim. */
export const CLAIMANT_ROLES = ['Owner', 'Manager', 'Authorised agent']
export const MAX_EVIDENCE_FILES = 6
export const MAX_EVIDENCE_MB = 10
export const EVIDENCE_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'

export const MY_CLAIMS_QUERY = ['venue-claims', 'mine']
/** One cache for the claims page, the dashboard notice and the nav item. */
export const ON_MY_VENUES_QUERY = ['venue-claims', 'on-my-venues']
/** Where those claims are answered. */
export const ON_MY_VENUES_PATH = '/claims-on-your-venues'
/** `respond_to_venue_claim` refuses anything longer. */
export const MAX_RESPONSE_CHARS = 4000
/** Claims a claimant can still withdraw. */
export const OPEN_STATUSES = ['Started', 'Submitted']

export const searchClaimable = async (query) => {
  const rows = await callGet(SEARCH_METHOD, { query })
  return (rows || []).map((row) => ({
    id: row.venue,
    name: row.venue_name,
    town: row.town || '',
    province: row.province || '',
    owned: !!row.owned,
  }))
}

/**
 * The token is the last path segment of `claim_url`. Read from the URL rather
 * than trusted to be a whole portal address: with `shotright_portal_url` unset
 * the bench returns a bare `/claim/<token>`, and either shape must work.
 */
export const tokenFromClaimUrl = (url) => {
  const match = /\/claim\/([^/?#]+)/.exec(url || '')
  return match ? match[1] : null
}

/** @returns `{claim, venueName, status, token}` — `token` null once filed. */
export const startClaim = async (venueId) => {
  const result = await call(START_METHOD, { venue_name: venueId })
  return {
    claim: result.claim,
    venueName: result.venue_name,
    status: result.status,
    token: tokenFromClaimUrl(result.claim_url),
  }
}

/** Guest-readable: the token is the authorisation. The venue's name only. */
export const resolveHandoff = async (token) => {
  const result = await callGet(HANDOFF_METHOD, { token })
  return {
    claim: result.claim,
    venue: result.venue,
    venueName: result.venue_name,
    status: result.status,
  }
}

/** Same endpoint every code goes through; the purpose picks the template. */
export const sendClaimCode = (email) => call('shotright.api.send_otp', { email, purpose: 'Venue Claim' })

export const fileClaim = async ({ token, code, role, note }) => {
  const result = await call(FILE_METHOD, {
    token,
    code,
    claimant_role: role || null,
    note: note || null,
  })
  return { claim: result.claim, status: result.status, disputed: !!result.disputed }
}

export const getMyClaims = async () => {
  const rows = await callGet(MY_CLAIMS_METHOD)
  return (rows || []).map((row) => ({
    claim: row.claim,
    venue: row.venue,
    venueName: row.venue_name || row.venue,
    status: row.status,
    startedAt: row.started_at || '',
    decidedAt: row.decided_at || '',
    reason: row.decision_reason || '',
    disputed: !!row.disputed,
  }))
}

const evidenceRow = (row) => ({ id: row.file, name: row.file_name, size: Number(row.file_size) || 0 })

/** `handle` is the live token before filing, the claim's docname after. */
export const listEvidence = async (handle) =>
  ((await callGet(LIST_EVIDENCE_METHOD, { handle })) || []).map(evidenceRow)

export const uploadEvidence = async (handle, file) => {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('handle', handle)
  const { data } = await api.post(`/api/method/${UPLOAD_EVIDENCE_METHOD}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return (data.message?.evidence || []).map(evidenceRow)
}

export const removeEvidence = async (handle, fileId) =>
  ((await call(REMOVE_EVIDENCE_METHOD, { handle, file: fileId })) || []).map(evidenceRow)

/** The claimant takes back their own open claim. */
export const withdrawClaim = async (claim) => {
  const result = await call(WITHDRAW_METHOD, { claim })
  return { claim: result.claim, status: result.status, venue: result.venue }
}

/**
 * Filed claims on the partner's venues, as the bench lets an OWNER see them:
 * the claimant's role, never who they are. An older bench has no such list,
 * and having nothing to show is the truthful answer there — the nav item and
 * the dashboard notice simply do not appear.
 */
export const getClaimsOnMyVenues = () =>
  withFallback(
    'get_claims_on_my_venues',
    async () => ((await callGet(ON_MY_VENUES_METHOD)) || []).map(claimOnMyVenue),
    async () => [],
  )

const claimOnMyVenue = (row) => ({
  claim: row.claim,
  venue: row.venue,
  venueName: row.venue_name || row.venue,
  status: row.status,
  filedAt: row.filed_at || '',
  decidedAt: row.decided_at || '',
  role: row.claimant_role || '',
  venueIsYours: !!row.venue_is_yours,
  canRespond: !!row.can_respond,
  responded: !!row.responded,
  response: row.response || '',
  respondedAt: row.responded_at || '',
  evidence: (row.evidence || []).map(evidenceRow),
})

/** @returns the claim as `getClaimsOnMyVenues` shapes it. */
export const respondToClaim = async ({ claim, response }) =>
  claimOnMyVenue(await call(RESPOND_METHOD, { claim, response }))

export const uploadResponseEvidence = async (claim, file) => {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('claim', claim)
  const { data } = await api.post(`/api/method/${UPLOAD_RESPONSE_EVIDENCE_METHOD}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return (data.message?.evidence || []).map(evidenceRow)
}

export const removeResponseEvidence = async (claim, fileId) =>
  ((await call(REMOVE_RESPONSE_EVIDENCE_METHOD, { claim, file: fileId })) || []).map(evidenceRow)
