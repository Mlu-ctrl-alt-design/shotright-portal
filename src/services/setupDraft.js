import { call, callGet } from './api'
import { withFallback } from './vendor'
import { WIZARD_STEPS, stepIndex } from './wizardSteps'

/**
 * Resumable venue setup — "Pick up where you left off".
 *
 * A partner who gets three steps into listing their venue and then has a table
 * walk in should be able to come back tomorrow, on their phone, and carry on. As
 * things stand they lose everything, and the second attempt is the one they
 * abandon.
 *
 * TWO BACKENDS, and the difference changes what we are allowed to SAY:
 *
 *   SERVER DRAFTS (endpoints below deployed)
 *     The draft is on their account. It survives a new device, a cleared cache,
 *     a different browser — and we can email them a link back to it.
 *
 *   LOCAL DRAFTS (today)
 *     The draft lives in this browser's localStorage. It survives a reload and
 *     a closed tab. It does NOT survive a different device, a private window,
 *     or a partner who clears their history — and there is no link to email,
 *     because there is nothing on the server to link to.
 *
 * `draftsArePortable()` reports which world we are in, and the resume card
 * changes its copy accordingly. The design's line — "Nothing expires, and we
 * emailed you this link too" — is only shown when both halves are true. Printing
 * it over a localStorage draft would be a promise the software cannot keep, and
 * the partner only finds out at the exact moment it matters.
 *
 * ---------------------------------------------------------------------------
 * BACKEND CONTRACT (see docs/RESUME-SETUP.md for the full spec)
 *
 *   shotright.api.save_venue_draft(draft_id, step, completed, payload)
 *       -> {draft_id, step, completed, payload, venue_name, modified}
 *   shotright.api.list_venue_drafts()   -> [ {…same, without payload} ]
 *   shotright.api.get_venue_draft(draft_id) -> {…same, with payload}
 *   shotright.api.discard_venue_draft(draft_id) -> {ok: true}
 *
 * `payload` is opaque JSON owned by this client. The server stores and returns
 * it without interpreting it, so adding a wizard field never needs a backend
 * change. `step` and `venue_name` are extracted for the listing because the
 * dashboard needs them without downloading every draft in full.
 * ---------------------------------------------------------------------------
 */

const STORAGE_KEY = 'shotright.venueDrafts'

/** Set the first time a call proves the endpoints are or are not there. */
let portable = null
export const draftsArePortable = () => portable === true

/* --------------------------------------------------------------- local store */

const readAll = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

const writeAll = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    // Private-mode Safari, or a full quota. The draft is then not saved at all,
    // and the caller is told so rather than being handed a false receipt.
    return false
  }
}

const localId = () => `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/* -------------------------------------------------------------------- shape */

/**
 * One shape for both backends.
 *
 * `updated_at` is an ISO string in both cases so the card can say "saved 2 days
 * ago" without caring where the draft came from. `portable` travels ON the draft
 * rather than being read globally, because a listing can legitimately mix the
 * two during the switchover — a server draft made this morning alongside a local
 * one made last week.
 */
const normalise = (raw, isPortable) => ({
  id: raw.draft_id || raw.id,
  step: raw.step || WIZARD_STEPS[0].key,
  stepIndex: stepIndex(raw.step),
  completed: raw.completed || [],
  venue_name: raw.venue_name || '',
  updated_at: raw.modified || raw.updated_at || null,
  payload: raw.payload ?? null,
  portable: isPortable,
})

/* ------------------------------------------------------------------- reads */

export async function listDrafts() {
  return withFallback(
    'list_venue_drafts',
    async () => {
      const rows = await callGet('shotright.api.list_venue_drafts')
      portable = true
      return (rows || []).map((r) => normalise(r, true))
    },
    async () => {
      portable = false
      return Object.values(readAll())
        .map((d) => normalise(d, false))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    },
  )
}

export async function getDraft(id) {
  if (!id) return null
  return withFallback(
    'get_venue_draft',
    async () => {
      const row = await callGet('shotright.api.get_venue_draft', { draft_id: id })
      portable = true
      return row ? normalise(row, true) : null
    },
    async () => {
      portable = false
      const row = readAll()[id]
      return row ? normalise(row, false) : null
    },
  )
}

/* ------------------------------------------------------------------ writes */

/**
 * Save (or create) a draft. Returns the draft, or throws.
 *
 * Deliberately NOT silent on failure. Autosave that quietly stops working is
 * the cruellest version of this feature: the partner keeps typing, sees a
 * "saved" they earned an hour ago, and loses the lot. The caller surfaces what
 * this returns — see `useSetupDraft`.
 */
export async function saveDraft({ id, step, completed = [], payload, venue_name = '' }) {
  return withFallback(
    'save_venue_draft',
    async () => {
      const row = await call('shotright.api.save_venue_draft', {
        draft_id: id || undefined,
        step,
        completed: JSON.stringify(completed),
        venue_name,
        payload: JSON.stringify(payload),
      })
      portable = true
      return normalise(row, true)
    },
    async () => {
      portable = false
      const draftId = id || localId()
      const row = {
        draft_id: draftId,
        step,
        completed,
        venue_name,
        payload,
        updated_at: new Date().toISOString(),
      }
      const all = readAll()
      all[draftId] = row
      if (!writeAll(all)) {
        throw new Error(
          'This browser will not let us save your progress. You can keep going, but do not close this tab before you submit.',
        )
      }
      return normalise(row, false)
    },
  )
}

export async function discardDraft(id) {
  if (!id) return
  return withFallback(
    'discard_venue_draft',
    async () => {
      await call('shotright.api.discard_venue_draft', { draft_id: id })
      portable = true
    },
    async () => {
      portable = false
      const all = readAll()
      delete all[id]
      writeAll(all)
    },
  )
}

/* ----------------------------------------------------------------- helpers */

/**
 * "2 days ago". Rounded down, never rounded up.
 *
 * A draft saved 47 hours ago is "1 day ago", not "2 days ago" — the partner is
 * checking this against their own memory of when they last sat down with it, and
 * an over-estimate makes them doubt it is the right draft.
 */
export function savedAgo(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
