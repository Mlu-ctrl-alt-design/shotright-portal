import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { discardDraft, getDraft, listDrafts, saveDraft } from '../services/setupDraft'

const DRAFTS_KEY = ['venue-drafts']

/** The dashboard's list of unfinished setups. */
export function useSetupDrafts() {
  return useQuery({
    queryKey: DRAFTS_KEY,
    queryFn: listDrafts,
    // Drafts change when the partner is in the wizard, not while they stare at
    // the dashboard. Refetching on focus is what makes the card correct after
    // they come back from finishing one in another tab.
    staleTime: 30_000,
  })
}

const DEBOUNCE_MS = 1200

/**
 * Autosave for the wizard.
 *
 * THREE RULES, all of them learned the hard way by everyone who has built this:
 *
 * 1. SAVE ON A DEBOUNCE, NOT ON EVERY KEYSTROKE. A save per character is a
 *    write storm that makes the form feel heavy and buys nothing.
 *
 * 2. SAVE IMMEDIATELY ON STEP CHANGE. The debounce is a nicety within a step;
 *    crossing a step boundary is the moment a partner mentally banks progress,
 *    and it is also when they are most likely to walk away.
 *
 * 3. NEVER LIE ABOUT THE RESULT. `status` goes 'saving' → 'saved' | 'error',
 *    and the error is shown. An autosave indicator that reads "Saved" when the
 *    last four writes failed is worse than no indicator, because it actively
 *    talks the partner out of the caution that would have protected them.
 *
 * The first save is skipped: mounting the wizard on an empty form and instantly
 * creating a draft litters the dashboard with "Untitled venue, step 1 of 5" for
 * everyone who ever clicked Add Venue and changed their mind.
 */
export function useSetupDraft({ draftId, step, completed, payload, venueName, enabled = true }) {
  const qc = useQueryClient()
  const [id, setId] = useState(draftId || null)
  const [status, setStatus] = useState('idle')
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)

  // Held in refs so the debounce effect can read the latest values without
  // restarting its timer on every keystroke.
  const latest = useRef({ step, completed, payload, venueName })
  latest.current = { step, completed, payload, venueName }

  const idRef = useRef(id)
  idRef.current = id

  const persist = useCallback(async () => {
    const { step: s, completed: c, payload: p, venueName: v } = latest.current
    setStatus('saving')
    try {
      const saved = await saveDraft({
        id: idRef.current,
        step: s,
        completed: c,
        payload: p,
        venue_name: v,
      })
      setId(saved.id)
      setSavedAt(saved.updated_at || new Date().toISOString())
      setStatus('saved')
      setError(null)
      qc.invalidateQueries({ queryKey: DRAFTS_KEY })
      return saved
    } catch (err) {
      setStatus('error')
      setError(err.message)
      return null
    }
  }, [qc])

  // Rule 1 — debounce within a step.
  const dirty = JSON.stringify(payload)
  const first = useRef(true)
  useEffect(() => {
    if (!enabled) return
    if (first.current) {
      first.current = false
      return
    }
    const timer = setTimeout(persist, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [dirty, enabled, persist])

  // Rule 2 — and on every step change, without waiting.
  useEffect(() => {
    if (!enabled || first.current) return
    persist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const discard = useCallback(async () => {
    if (!idRef.current) return
    await discardDraft(idRef.current)
    setId(null)
    setStatus('idle')
    qc.invalidateQueries({ queryKey: DRAFTS_KEY })
  }, [qc])

  return { id, status, savedAt, error, saveNow: persist, discard }
}

/** Load a draft by id, for the wizard's resume path. */
export function useDraft(id) {
  return useQuery({
    queryKey: ['venue-draft', id],
    queryFn: () => getDraft(id),
    enabled: Boolean(id),
    // A draft is loaded once, at the top of a session, and then owned by the
    // wizard's own state. Refetching it would fight the partner's edits.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}
