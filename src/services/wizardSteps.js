/**
 * The five steps of venue setup, in one place.
 *
 * The wizard renders them and the dashboard's resume card names them, and those
 * two had better agree — a card that says "step 4 of 5, Menu options" and then
 * drops the partner on operating hours is worse than a card that says nothing.
 * The `key` is also what gets persisted in a draft, so renaming one is a data
 * migration, not a copy change.
 */
export const WIZARD_STEPS = [
  { key: 'mood', label: 'Setup Mood', short: 'Setup mood' },
  { key: 'details', label: "Your venue's details", short: 'Venue details' },
  { key: 'hours', label: 'Your operating hours', short: 'Operating hours' },
  { key: 'menu', label: 'Your menu options', short: 'Menu options' },
  { key: 'review', label: 'Almost done', short: 'Review & submit' },
]

export const stepIndex = (key) => {
  const index = WIZARD_STEPS.findIndex((s) => s.key === key)
  // An unknown key means a draft was written by a version of the wizard that
  // had different steps. Sending the partner back to the beginning loses
  // nothing — every field is still in the draft — whereas guessing an index
  // drops them somewhere arbitrary.
  return index === -1 ? 0 : index
}

export const stepShort = (key) => WIZARD_STEPS[stepIndex(key)].short
