/**
 * Frappe rich text as readable paragraphs.
 *
 * Notification Log bodies arrive as HTML (`<p><strong>Zuko</strong> booked…`).
 * Rendering that HTML would mean trusting whatever the bench stored; reading it
 * as text needs no trust at all. DOMParser builds an inert document — scripts
 * in it never run, images never load — and we only read its text back out.
 *
 * @returns an array of paragraphs, empty ones dropped.
 */
export function htmlToParagraphs(html) {
  if (!html) return []
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  const blocks = doc.body.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6')
  const texts = blocks.length
    ? Array.from(blocks)
        .filter((el) => !el.querySelector('p, div, li'))
        .map((el) => el.textContent)
    : [doc.body.textContent]
  return texts.map((t) => t.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
}
