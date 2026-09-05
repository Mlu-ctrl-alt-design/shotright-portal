/**
 * Turning a Frappe rich-text field back into something a person can read.
 *
 * ⚠️ FROM THE LIVE SITE: a menu item's description came back as
 * `<p>Tomatoes, creamy burrata and a great summer starter.</p>` and the portal
 * printed exactly that — angle brackets and all — to the partner who typed the
 * sentence. Frappe's Text Editor and Small Text fields store HTML; React
 * escapes it on the way out, so the markup is shown rather than applied.
 *
 * THE FIX IS NOT `dangerouslySetInnerHTML`. This text is written by partners
 * and imported from their spreadsheets: rendering it as markup would put a
 * script tag from an uploaded file into the portal of whoever opens that venue
 * next. The menu needs one line of plain prose, not formatting, so the tags
 * come out and the text stays text.
 *
 * Parsing happens in a DOMParser document, which has no browsing context — no
 * script runs, no `onerror` fires, nothing is fetched — so hostile markup is
 * inert while it is being read for its words.
 */

/** Entities we decode by hand when there is no DOMParser (tests, SSR). */
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

const decodeBasic = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)

/**
 * The words out of a value that may or may not be HTML.
 *
 * Block-level tags become spaces rather than nothing, so `<p>One</p><p>Two</p>`
 * reads as "One Two" and not "OneTwo". Returns '' for anything unusable, so a
 * caller can treat "no description" and "a description made only of markup"
 * the same way.
 */
export function plainText(value) {
  if (value == null) return ''
  const raw = String(value)
  if (!raw.includes('<') && !raw.includes('&')) return raw.trim()

  let text
  try {
    const doc = new DOMParser().parseFromString(
      // <br> and </p> carry a line break's worth of meaning; without this they
      // vanish and two sentences are welded together.
      raw.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, ' $& '),
      'text/html',
    )
    text = doc.body?.textContent ?? ''
  } catch {
    text = decodeBasic(raw.replace(/<[^>]*>/g, ' '))
  }

  return text.replace(/\s+/g, ' ').trim()
}
