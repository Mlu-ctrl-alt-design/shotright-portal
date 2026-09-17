import { Alert, Button } from '../../../components/ui'
import PhotoUploader from '../../../components/ui/PhotoUploader'
import { useVenuePhotoSupport } from '../../../hooks/useVendor'
import { MAX_VENUE_PHOTOS, uploadVenuePhoto } from '../../../services/vendor'

/**
 * Photographs, on a screen of their own — the last thing before review.
 *
 * MOVED OUT OF THE FORM on 17 Sep, and the reason is in the copy: photographs
 * are better taken standing in the room than remembered at a desk. Buried at
 * the bottom of a long form they were the step people gave up on; alone on a
 * screen, after everything else is already saved, they are a single job with a
 * clear finish.
 *
 * The work is already safe by the time anybody gets here — the draft has been
 * autosaving since the first keystroke — so leaving without finishing costs
 * nothing, which is exactly why "Finish later" is offered plainly rather than
 * hidden behind a confirm.
 *
 * Photos go up as they are chosen rather than being held for submit: the venue
 * does not exist yet, so the File goes up unattached and is linked on create.
 * That is also what lets a RESUMED draft come back with its pictures — a draft
 * can carry a `file_url`, and could never carry a File object.
 */
export default function VenuePhotosPage({
  photos,
  onChange,
  required,
  error,
  onUploadRefused,
  onBack,
  onSubmit,
  onFinishLater,
  submitting,
  venueName,
}) {
  const { data: photosSupported } = useVenuePhotoSupport()

  return (
    <div>
      <header>
        <h1 className="text-2xl font-bold text-ink-900">Now the photos</h1>
        <p className="mt-1.5 max-w-prose text-sm text-pretty text-ink-700">
          {venueName ? (
            <>
              <span className="font-semibold">{venueName}</span> is saved. Add a few pictures and
              it goes to our team.
            </>
          ) : (
            'Your details are saved. Add a few pictures and it goes to our team.'
          )}
        </p>
      </header>

      <div className="mt-7">
        <PhotoUploader
          photos={photos}
          onChange={onChange}
          upload={uploadVenuePhoto}
          max={MAX_VENUE_PHOTOS}
          required={required}
          error={error}
          onUploadRefused={onUploadRefused}
          notice={
            // Said before they start arranging, not after they submit. Eight
            // photographs put in a deliberate order is real work, and finding
            // out at the end that none of it went anywhere is how a form loses
            // someone's trust for good.
            photosSupported === false ? (
              <Alert variant="warning">
                <p className="font-bold">Photos aren’t reaching customers yet</p>
                <p className="mt-1">
                  Reviewers see these. Customers don’t yet — the app has no place for venue photos,
                  and the order isn’t saved.
                </p>
              </Alert>
            ) : null
          }
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3.5 border-t border-ink-200 pt-5">
        <Button shape="field" onClick={onSubmit} loading={submitting}>
          Send for review
        </Button>
        <Button shape="field" variant="secondary" onClick={onBack}>
          Back to details
        </Button>
        <button
          type="button"
          onClick={onFinishLater}
          className="text-[13px] font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
        >
          Finish later
        </button>
      </div>
    </div>
  )
}
