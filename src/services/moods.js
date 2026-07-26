/**
 * Mood matching, independent of where the mood list came from.
 *
 * This used to live inside `mockBackend.js` and close over a hard-coded array
 * of fourteen fixtures. That was fine while everything was fixtures and wrong
 * the moment anything wasn't: with the real backend connected, a partner's
 * typing was still being matched against invented moods, so the portal would
 * happily accept a mood the bench has never heard of and `create_venue` would
 * then reject the whole submission.
 *
 * Matching is therefore a pure function of (list, text). The caller decides
 * which list — the live Mood doctype in production, fixtures in local dev — and
 * the behaviour is identical either way.
 */

/**
 * The mood vocabulary to fall back on when the live Mood list cannot be read.
 *
 * This lives here rather than in `mockBackend.js` because it is reachable in
 * production — that module now throws if it runs in a deployed build, and this
 * list has to survive a bench outage or a missing read permission. It is a
 * degraded fallback, not fiction: the names are the ones in the approved design
 * frames, so they are the vocabulary the bench was specified from.
 *
 * It is still a guess about what the bench holds today, and `getMoods()` warns
 * to the console when it is used. The real fix is a `get_moods` endpoint —
 * `backend/mood_suggestions.py` has one ready.
 *
 * `aliases` is what makes matching useful: "boys night" and "bn out" both land
 * on "Boys Night Out" instead of fragmenting the taxonomy. The live Mood
 * doctype has no alias field yet, so real moods match on their name alone.
 */
export const FALLBACK_MOODS = [
  { name: 'MOOD-CHILLED', mood_name: 'Chilled Bar', aliases: ['chilled', 'chill', 'chilled bar'] },
  { name: 'MOOD-BOYS', mood_name: 'Boys Night Out', aliases: ['boys night', 'boys', 'bn out'] },
  { name: 'MOOD-GIRLS', mood_name: 'Girls Night Out', aliases: ['girls night', 'girls'] },
  { name: 'MOOD-SPECIAL', mood_name: 'Special Occasion', aliases: ['special', 'occasion'] },
  { name: 'MOOD-KIDDIES', mood_name: 'Kiddies Birthday', aliases: ['kiddies', 'kids birthday'] },
  { name: 'MOOD-MOTHERS', mood_name: 'Mothers Day', aliases: ['mothers', "mother's day"] },
  { name: 'MOOD-ROOFTOP', mood_name: 'Rooftop', aliases: ['roof top', 'roof'] },
  { name: 'MOOD-OUTDOOR', mood_name: 'Outdoor', aliases: ['out door', 'outdoors'] },
  { name: 'MOOD-LOCAL', mood_name: 'Local Lit', aliases: ['local', 'lit'] },
  { name: 'MOOD-NEWINTOWN', mood_name: 'New In Town', aliases: ['new in town', 'newintown'] },
  { name: 'MOOD-ROMANTIC', mood_name: 'Romantic', aliases: ['romance', 'date night'] },
  { name: 'MOOD-FAMILY', mood_name: 'Family', aliases: ['family friendly', 'families'] },
  { name: 'MOOD-CLASSY', mood_name: 'Classy', aliases: ['upmarket', 'fancy'] },
  { name: 'MOOD-SPORTY', mood_name: 'Sports', aliases: ['sport', 'sports bar', 'game day'] },
]

/** Lowercase, collapse whitespace, drop punctuation — the comparison key. */
export const normaliseMood = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Resolve one typed mood against a list of `{name, mood_name, aliases?}`.
 *
 * Returns `{status: 'canonical', mood, label}` on an exact hit against a name
 * or alias, otherwise `{status: 'unmatched', label, near}` where `near` is the
 * closest thing worth offering instead.
 *
 * `aliases` are only present on fixtures — the live Mood doctype has no alias
 * field yet (see `backend/mood_suggestions.py` for the proposed one). The
 * optional chain is what lets the same function serve both.
 *
 * Note there is no 'suggested' status here any more. Nothing can create a mood
 * on the bench, so an unmatched mood is refused at the point of entry rather
 * than accepted and dropped four steps later. `MoodStep` handles the refusal.
 */
export function matchMood(list, text) {
  const key = normaliseMood(text)
  if (!key) throw new Error('Please type a mood first.')

  const exact = (list || []).find(
    (m) =>
      normaliseMood(m.mood_name) === key ||
      (m.aliases || []).some((a) => normaliseMood(a) === key),
  )
  if (exact) return { status: 'canonical', mood: exact.name, label: exact.mood_name }

  // Cheap containment check — enough to catch "boys night out party".
  const near = (list || []).find((m) => {
    const canonicalKey = normaliseMood(m.mood_name)
    return canonicalKey.includes(key) || key.includes(canonicalKey)
  })

  return {
    status: 'unmatched',
    label: String(text).trim(),
    near: near ? { mood: near.name, label: near.mood_name } : null,
  }
}
