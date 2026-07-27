import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelMenuImport,
  forgetImport,
  getMenuImportStatus,
  rememberedImport,
  startMenuImport,
} from '../services/menuImport'

/**
 * Owns one venue's menu import: upload progress, polling, elapsed time, and the
 * point at which "nearly there" stops being true.
 *
 * PHASES the UI renders from:
 *   idle       nothing happening
 *   uploading  bytes going up, real percentage
 *   reading    server parsing. `progress` is rows if the backend reports them
 *   slow       still reading past `slowAfter` — offer the manual path
 *   done       finished; counts available
 *   failed     finished badly; reason available
 *
 * "uploading" and "reading" are separate because they have different progress
 * semantics. Upload has real bytes. Reading may have real rows, or nothing at
 * all on the synchronous backend. Merging them produces a bar that sprints to
 * 100% and then stops, which every user reads as a hang.
 *
 * RESUMING. On mount, a remembered job for this venue is picked back up. That
 * is what makes "you don't have to wait, you can leave the page" true rather
 * than merely comforting — the work already survived, and this is the half that
 * lets the partner see it did.
 */
const POLL_MS = 1500
const DEFAULT_ESTIMATE = 20
const DEFAULT_SLOW_AFTER = 45

export function useMenuImport(venueId, { onComplete } = {}) {
  const [phase, setPhase] = useState('idle')
  const [uploadPercent, setUploadPercent] = useState(0)
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  // True only when the work genuinely outlives the page — the UI keys its
  // "you can leave" copy off this and must never assume it.
  const [canLeave, setCanLeave] = useState(false)

  const timer = useRef(null)
  const startedAt = useRef(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const estimate = job?.estimate_seconds ?? DEFAULT_ESTIMATE
  const slowAfter = job?.slow_after_seconds ?? DEFAULT_SLOW_AFTER

  const stopPolling = () => {
    clearInterval(timer.current)
    timer.current = null
  }

  const finish = useCallback(
    (status, latest) => {
      stopPolling()
      setJob(latest)
      setPhase(status === 'Completed' ? 'done' : status === 'Failed' ? 'failed' : 'idle')
      forgetImport(venueId)
      if (status === 'Completed') onCompleteRef.current?.(latest)
    },
    [venueId],
  )

  const poll = useCallback(
    async (name) => {
      try {
        const latest = await getMenuImportStatus(name)
        setJob(latest)
        if (['Completed', 'Failed', 'Cancelled'].includes(latest.status)) {
          finish(latest.status, latest)
          return
        }
        setPhase((p) => (p === 'slow' ? 'slow' : 'reading'))
      } catch (err) {
        // A poll that 404s means the job is gone — a bench restart, a purge, or
        // a job id from another environment. Say so and stop, rather than
        // spinning for ever against something that will never answer.
        stopPolling()
        forgetImport(venueId)
        setError(
          err?.status === 404
            ? 'We lost track of that import. Check your menu below — some items may have been added — and upload again if anything is missing.'
            : err.message,
        )
        setPhase('failed')
      }
    },
    [venueId, finish],
  )

  const watch = useCallback(
    (name, since) => {
      startedAt.current = since || Date.now()
      setCanLeave(true)
      setPhase('reading')
      stopPolling()
      poll(name)
      timer.current = setInterval(() => poll(name), POLL_MS)
    },
    [poll],
  )

  /** Resume a job that was running when the partner last left. */
  useEffect(() => {
    if (!venueId) return
    const remembered = rememberedImport(venueId)
    if (remembered?.name) watch(remembered.name, remembered.startedAt)
    return stopPolling
  }, [venueId, watch])

  /** Elapsed seconds, and the promotion to `slow`. */
  useEffect(() => {
    if (phase !== 'reading' && phase !== 'slow') return
    const tick = setInterval(() => {
      const seconds = Math.round((Date.now() - (startedAt.current || Date.now())) / 1000)
      setElapsed(seconds)
      if (seconds >= slowAfter) setPhase('slow')
    }, 1000)
    return () => clearInterval(tick)
  }, [phase, slowAfter])

  const start = useCallback(
    async (file) => {
      setError(null)
      setJob(null)
      setElapsed(0)
      setUploadPercent(0)
      setPhase('uploading')
      startedAt.current = Date.now()

      try {
        const { job: started, async: isAsync } = await startMenuImport(
          venueId,
          file,
          setUploadPercent,
        )
        setCanLeave(isAsync)

        if (!isAsync || started.status === 'Completed') {
          finish(started.status || 'Completed', started)
          return
        }
        watch(started.name, startedAt.current)
      } catch (err) {
        setPhase('failed')
        setError(err.message)
      }
    },
    [venueId, finish, watch],
  )

  /**
   * Stop watching. Rows already imported are kept — see the backend note.
   *
   * `keepRunning` is the "I'll add them by hand instead" path: the partner
   * stops looking at the progress, but the job carries on and its rows still
   * land. Cancelling outright is the other button.
   */
  const dismiss = useCallback(
    async ({ keepRunning = true } = {}) => {
      stopPolling()
      if (!keepRunning && job?.name) {
        try {
          await cancelMenuImport(job.name)
        } catch {
          // Best effort. A cancel that fails still leaves the partner able to
          // work; the import finishing anyway is not a harmful outcome.
        }
      }
      forgetImport(venueId)
      setPhase('idle')
      setJob(null)
    },
    [venueId, job],
  )

  const reset = useCallback(() => {
    stopPolling()
    forgetImport(venueId)
    setPhase('idle')
    setJob(null)
    setError(null)
  }, [venueId])

  return {
    phase,
    job,
    error,
    elapsed,
    estimate,
    slowAfter,
    canLeave,
    uploadPercent,
    busy: phase === 'uploading' || phase === 'reading' || phase === 'slow',
    start,
    dismiss,
    reset,
  }
}
