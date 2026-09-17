/**
 * The five things a venue needs before it can go live, in one place.
 *
 * ⚠️ THESE USED TO BE SCREENS. They are now SECTIONS of one scrolling page.
 *
 * The five-step wizard (mood → details → hours → menu → review) was replaced on
 * 17 Sep with a single page and a progress rail, because the thing partners
 * actually complained about was not the number of screens — it was not knowing
 * how much was left, and being shown a wall of fields with no way to tell which
 * of them mattered. A rail that ticks as you fill answers both, and it can only
 * do that if the sections and the checklist come from the same list, which is
 * this one.
 *
 * WHAT CHANGED, and why each:
 *
 *   mood    → vibe      same data, now a row of chips inside the page rather
 *                       than a screen of its own.
 *   details → basics    split, because "venue details" was doing three jobs:
 *             + where   who you are, where you are, and what it feels like are
 *             + vibe    three different questions and only one of them is
 *                       paperwork.
 *   hours   → hours     unchanged.
 *   menu    → GONE      a menu does not hold up going live, and putting it in
 *                       the middle of onboarding said it did. It lives at
 *                       /venues/:id/menu, where a partner can do it sitting
 *                       down with the actual menu in front of them.
 *   review  → GONE      there is nothing to review on a page you can see all
 *                       of. The rail IS the review.
 *   photos  → NEW       promoted out of the details step to a screen of its
 *                       own, after Save. Photographs are better taken standing
 *                       in the room than remembered at a desk.
 *
 * `key` is persisted in drafts, so renaming one is a data migration rather than
 * a copy change. Old drafts carrying the retired keys still open: `stepIndex`
 * answers 0 for anything it does not recognise, which drops the partner at the
 * top of the page with every field they had already filled still in it.
 */
export const WIZARD_STEPS = [
  {
    key: 'basics',
    label: 'The basics',
    short: 'The basics',
    hint: 'Name, manager, phone',
  },
  {
    key: 'where',
    label: 'Where you are',
    short: 'Where you are',
    hint: 'Address and pin',
  },
  {
    key: 'vibe',
    label: 'The vibe',
    short: 'The vibe',
    hint: 'How it feels on a normal night',
  },
  {
    key: 'hours',
    label: 'When you are open',
    short: 'Hours',
    hint: 'The days and the times',
  },
  /**
   * ⚠️ SIX SECTIONS, NOT THE FIVE IN THE DESIGN, and this is the one that was
   * added. It is not a liberty — it is what the backend actually requires.
   *
   * `submit_venue_for_review` runs the completeness rules, and an empty
   * description is a BLOCKER: the listing is refused to Declined with "Describe
   * the venue." The old wizard satisfied that by accident, because it had an
   * atmosphere dropdown and `create_venue` maps `atmosphere` onto
   * `atmosphere_desc`. The redesign replaced that dropdown with the mood chips,
   * which leaves nothing feeding the description.
   *
   * So the choice was: mark this optional as the design does and let partners
   * finish a whole venue only to have it declined for a field we told them not
   * to bother with — or ask for one short answer up front. The guided prompts
   * exist precisely because a description can be got out of somebody in four
   * words, so this is a cheap requirement, and the rail states it before
   * anybody is blocked by it.
   */
  {
    key: 'words',
    label: 'In your own words',
    short: 'Description',
    hint: 'One line is enough',
  },
  {
    key: 'photos',
    label: 'Photos',
    short: 'Photos',
    hint: 'The screen after this one',
  },
]

/** Retired step keys, kept so a draft written before 17 Sep still resolves. */
const RETIRED = { mood: 'vibe', details: 'basics', menu: 'photos', review: 'photos' }

export const stepIndex = (key) => {
  const resolved = RETIRED[key] || key
  const index = WIZARD_STEPS.findIndex((s) => s.key === resolved)
  // An unknown key means a draft was written by a version that had different
  // sections. Sending the partner to the top loses nothing — every field is
  // still in the draft — whereas guessing an index drops them somewhere
  // arbitrary.
  return index === -1 ? 0 : index
}

export const stepShort = (key) => WIZARD_STEPS[stepIndex(key)].short
