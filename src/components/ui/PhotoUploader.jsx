import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from './index'
import { clsx } from '../../utils/clsx'
import { ACCEPT_ATTR, ImageError, formatBytes, prepareImage } from '../../utils/image'

/**
 * Venue photographs — choose, see, order, remove.
 *
 * Used in two places with the same behaviour: the setup wizard, where there is
 * no venue yet, and an existing venue's page, where there is. The only
 * difference is whether the upload can name the document it belongs to.
 *
 * THE FIRST PHOTO IS THE COVER, and that is a real editorial decision — it is
 * the single image a customer sees when the venue appears in a mood search. The
 * order is therefore part of the data, not a display detail, which is why
 * reordering is a first-class control rather than something you get by deleting
 * and re-uploading in a different sequence.
 *
 * ACCESSIBILITY, and why the tile controls are always visible rather than
 * appearing on hover:
 *
 *  - Hover-revealed controls do not exist for touch or for a keyboard. This is
 *    a portal used from a phone behind a bar as often as from a desk.
 *  - Every control is a real <button> with a name that includes the photo's
 *    position — "Move Front bar left, to position 2 of 5" — because "move left"
 *    on its own tells a screen-reader user nothing about where they are.
 *  - Reordering, adding and removing all announce through one polite live
 *    region. Photo grids are the classic case of a UI that changes silently.
 *  - The cover photo says the word "Cover", not just a coloured badge: WCAG
 *    1.4.1, and a partner glancing at eight near-identical shots of their own
 *    room needs the word anyway.
 */
export default function PhotoUploader({
  photos = [],
  onChange,
  venueId,
  max = 10,
  upload,
  disabled = false,
  label = 'Venue photos',
  hint = 'Show the room, the bar, a full table. The first photo is the one customers see.',
  notice = null,
}) {
  const [queue, setQueue] = useState([])
  const [errors, setErrors] = useState([])
  const [announcement, setAnnouncement] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const dragDepth = useRef(0)

  /* `photos` is captured by the async loop below at the moment it started, so
     dropping three files at once would have each one write back a list that
     still held only the photos present before any of them landed — two of the
     three silently lost. The ref is written on render AND immediately after
     each append, so the loop never reads a stale list even within a tick. */
  const photosRef = useRef(photos)
  photosRef.current = photos

  const remaining = Math.max(0, max - photos.length - queue.length)
  const full = remaining === 0

  /* Blob previews are created per queued file and must be released, or a
     partner who adds and removes photos a few times leaks the whole lot. */
  useEffect(
    () => () => queue.forEach((q) => q.preview && URL.revokeObjectURL(q.preview)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const addFiles = async (fileList) => {
    const chosen = Array.from(fileList || [])
    if (!chosen.length) return

    const accepted = chosen.slice(0, remaining)
    const overflow = chosen.length - accepted.length
    if (overflow > 0) {
      setErrors((e) => [
        ...e,
        {
          id: `overflow-${Date.now()}`,
          message:
            `You can add ${max} photos to a venue, so ${overflow === 1 ? 'the last one was' : `${overflow} were`} ` +
            `left out. Remove one below if you'd rather use a different picture.`,
        },
      ])
    }
    if (!accepted.length) return

    setAnnouncement(
      `Adding ${accepted.length === 1 ? 'one photo' : `${accepted.length} photos`}…`,
    )

    /* Sequential, not Promise.all. Each file is decoded onto a canvas at full
       resolution before being scaled down, and four 12-megapixel photos being
       decoded at once is enough to make a mid-range phone drop the tab. One at
       a time is also the order the partner picked them in, which is the order
       they expect them to land in. */
    for (const original of accepted) {
      const id = `${original.name}-${original.size}-${Math.random().toString(36).slice(2, 8)}`
      const preview = URL.createObjectURL(original)
      setQueue((q) => [
        ...q,
        { id, fileName: original.name, size: original.size, percent: 0, stage: 'preparing', preview },
      ])

      try {
        const prepared = await prepareImage(original)
        setQueue((q) => q.map((item) => (item.id === id ? { ...item, stage: 'uploading' } : item)))

        const saved = await upload(prepared.file, {
          venueId,
          onProgress: (fraction) =>
            setQueue((q) =>
              q.map((item) =>
                item.id === id ? { ...item, percent: Math.round(fraction * 100) } : item,
              ),
            ),
        })

        const next = [
          ...photosRef.current,
          {
            name: saved.name,
            file_url: saved.file_url,
            // The partner's own filename, not the server's. We may have
            // transcoded a .png to .jpg on the way up; showing them a name
            // they never typed, in the tile AND in any error about it, is a
            // small mystery with no upside.
            file_name: original.name,
            attached: saved.attached,
            size: prepared.file.size,
          },
        ]
        photosRef.current = next
        onChange(next)
        setAnnouncement(
          `${original.name} added${next.length === 1 ? ' as the cover photo' : ''}.`,
        )
      } catch (err) {
        /* An ImageError is something the partner can act on and is shown as
           written. Anything else is ours, and gets the file name attached so
           they at least know WHICH photo failed out of the six they dropped. */
        setErrors((e) => [
          ...e,
          {
            id,
            message:
              err instanceof ImageError
                ? err.message
                : `${original.name} didn’t upload: ${err.message || 'something went wrong.'} Try again.`,
          },
        ])
        setAnnouncement(`${original.name} could not be added.`)
      } finally {
        URL.revokeObjectURL(preview)
        setQueue((q) => q.filter((item) => item.id !== id))
      }
    }
  }

  const move = (from, to) => {
    if (to < 0 || to >= photos.length) return
    const next = [...photos]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    photosRef.current = next
    onChange(next)
    setAnnouncement(
      `${moved.file_name} moved to position ${to + 1} of ${next.length}` +
        (to === 0 ? '. This is now the cover photo.' : '.'),
    )
  }

  const remove = (index) => {
    const gone = photos[index]
    const next = photos.filter((_, i) => i !== index)
    photosRef.current = next
    onChange(next)
    setAnnouncement(
      `${gone.file_name} removed. ${next.length || 'No'} photo${next.length === 1 ? '' : 's'} left.` +
        (index === 0 && next.length ? ` ${next[0].file_name} is now the cover photo.` : ''),
    )
  }

  const onDrop = (event) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!disabled) addFiles(event.dataTransfer?.files)
  }

  return (
    <section aria-labelledby="venue-photos-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="venue-photos-heading" className="text-sm font-bold text-ink-900">
          {label}
        </h3>
        <p className="text-xs text-ink-500">
          {photos.length} of {max}
        </p>
      </div>
      <p className="text-sm text-ink-700">{hint}</p>

      {notice}

      <div
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          // Counted, because dragging over a child fires leave on the parent
          // and the zone would flicker off under the pointer.
          dragDepth.current -= 1
          if (dragDepth.current <= 0) setDragging(false)
        }}
        onDrop={onDrop}
        className={clsx(
          'rounded-3xl border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-brand-edge bg-brand-50' : 'border-field bg-white',
          (disabled || full) && 'opacity-60',
        )}
      >
        <p className="text-sm font-semibold text-ink-900">
          {full ? `That’s all ${max} photos` : 'Drag photos here, or choose them from your device'}
        </p>
        <p className="mt-1 text-xs text-ink-500">
          JPG, PNG or WebP. Big photos off a phone are fine — we shrink them for you before they go
          up.
        </p>
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || full}
            onClick={() => inputRef.current?.click()}
          >
            {photos.length ? 'Add more photos' : 'Choose photos'}
          </Button>
        </div>
        {/* UNTITLED UI: https://www.untitledui.com/react/components/file-upload */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          aria-label={`${label} — choose files`}
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = '' // so the same photo can be re-picked after a fix
          }}
        />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((error) => (
            <Alert key={error.id} variant="danger">
              <div className="flex items-start justify-between gap-3">
                <span>{error.message}</span>
                <button
                  type="button"
                  onClick={() => setErrors((e) => e.filter((x) => x.id !== error.id))}
                  className="shrink-0 font-bold underline"
                >
                  Dismiss
                </button>
              </div>
            </Alert>
          ))}
        </div>
      )}

      {(photos.length > 0 || queue.length > 0) && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo, index) => (
            <li
              key={photo.file_url || photo.name}
              className="relative overflow-hidden rounded-2xl bg-ink-50 ring-1 ring-brand-200"
            >
              <img
                src={photo.file_url}
                alt={photo.file_name}
                className="aspect-[4/3] w-full object-cover"
              />

              {index === 0 && (
                <span className="absolute top-2 left-2 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-900 uppercase">
                  Cover
                </span>
              )}

              {/* On a scrim rather than floating on the photo: a white glyph on
                  an unknown photograph has no guaranteed contrast, and these are
                  photographs of dark bars. */}
              <div className="flex items-center justify-between gap-1 bg-ink-900/85 px-2 py-1.5">
                <div className="flex gap-1">
                  <TileButton
                    label={`Move ${photo.file_name} earlier, to position ${index} of ${photos.length}`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <path d="M8 2 4 6l4 4" />
                  </TileButton>
                  <TileButton
                    label={`Move ${photo.file_name} later, to position ${index + 2} of ${photos.length}`}
                    disabled={index === photos.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <path d="M4 2l4 4-4 4" />
                  </TileButton>
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
                >
                  Remove<span className="sr-only"> {photo.file_name}</span>
                </button>
              </div>
            </li>
          ))}

          {queue.map((item) => (
            <li
              key={item.id}
              className="relative overflow-hidden rounded-2xl bg-ink-50 ring-1 ring-brand-200"
            >
              <img
                src={item.preview}
                alt=""
                className="aspect-[4/3] w-full object-cover opacity-40"
              />
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-3 text-center">
                <p className="truncate text-[11px] font-bold text-ink-900">{item.fileName}</p>
                <p className="text-[10px] text-ink-700">
                  {item.stage === 'preparing'
                    ? `Getting it ready — ${formatBytes(item.size)}`
                    : `Uploading… ${item.percent}%`}
                </p>
              </div>
              {/* Indeterminate while the canvas work happens — there is no
                  honest percentage for "decoding and scaling", so we omit
                  aria-valuenow rather than invent one. */}
              <div
                role="progressbar"
                aria-label={`Adding ${item.fileName}`}
                {...(item.stage === 'uploading'
                  ? { 'aria-valuenow': item.percent, 'aria-valuemin': 0, 'aria-valuemax': 100 }
                  : {})}
                className="absolute inset-x-0 bottom-0 h-1.5 bg-ink-200"
              >
                <div
                  className={clsx(
                    'h-full bg-brand-500 transition-[width] duration-300',
                    item.stage === 'preparing' && 'w-1/4 animate-pulse',
                  )}
                  style={item.stage === 'uploading' ? { width: `${item.percent}%` } : undefined}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TileButton({ label, disabled, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-6 place-items-center rounded-full text-white transition hover:bg-white/15 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 fill-none stroke-current stroke-2">
        <g strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </svg>
    </button>
  )
}
