/**
 * Option lists for the venue details step.
 *
 * These are NOT fixtures standing in for a backend, and they deliberately do
 * not live in `mockBackend.js` — that module now throws if it is reached in a
 * production build, and these are needed there.
 *
 * They are portal-side vocabulary. `create_venue` takes `dress_code` and
 * `atmosphere_desc`, and `atmosphere_desc` is free text on the bench rather
 * than a constrained field, so offering a list is a convenience that saves
 * partners inventing a phrasing — not a claim about what the backend stores.
 *
 * Values are the ones in the approved designs (`venue details filled.png` and
 * the review screen: "Formal Wear", "Out door laid back"), extended to cover
 * the obvious cases those two imply.
 *
 * GAP: when the bench grows real Desk-managed lists for these, replace
 * `getVenueLookups` in `vendor.js` with the fetch and delete this file — staff
 * should be able to extend the vocabulary without a portal release.
 */
export const VENUE_LOOKUPS = {
  dress_codes: [
    'Formal Wear',
    'Smart Casual',
    'Casual',
    'Traditional',
    'Sports Wear',
    'No Dress Code',
  ],
  atmospheres: [
    'Out door laid back',
    'Fine dining',
    'Family friendly',
    'Lively and loud',
    'Quiet and intimate',
    'Sports bar',
  ],
}
