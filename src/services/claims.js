import api, { call, callGet } from './api'

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

export const MIN_QUERY = 2
/** The Select options on `Venue Claim.claimant_role`, verbatim. */
export const CLAIMANT_ROLES = ['Owner', 'Manager', 'Authorised agent']
export const MAX_EVIDENCE_FILES = 6
export const MAX_EVIDENCE_MB = 10
export const EVIDENCE_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'

export const MY_CLAIMS_QUERY = ['venue-claims', 'mine']

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
