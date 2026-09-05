/**
 * Descriptions come off the bench as HTML. They must reach a partner as words.
 *
 * From the live site: a menu item read
 * `<p>Tomatoes, creamy burrata and a great summer starter.</p>` — angle
 * brackets and all — shown to the person who typed the sentence.
 */
import { describe, expect, it } from 'vitest'
import { plainText } from '../utils/html'

describe('a description off the bench', () => {
  it('loses the markup Frappe wrapped it in', () => {
    expect(plainText('<p>Tomatoes, creamy burrata and a great summer starter.</p>')).toBe(
      'Tomatoes, creamy burrata and a great summer starter.',
    )
  })

  /* Two paragraphs are two sentences, not one welded word. */
  it('keeps the gap between blocks', () => {
    expect(plainText('<p>Served warm.</p><p>Ask about today’s catch.</p>')).toBe(
      'Served warm. Ask about today’s catch.',
    )
    expect(plainText('Line one<br>Line two')).toBe('Line one Line two')
  })

  it('decodes what the bench encoded', () => {
    expect(plainText('<p>Fish &amp; chips</p>')).toBe('Fish & chips')
    expect(plainText('Salt &amp; pepper squid')).toBe('Salt & pepper squid')
  })

  /**
   * The reason this is not `dangerouslySetInnerHTML`. Descriptions are typed by
   * partners and imported from their spreadsheets; rendering them as markup
   * would put whatever is in an uploaded file into the next person's portal.
   * Parsing happens in an inert document, so this text is read, never run.
   */
  it('takes the words out of hostile markup rather than running it', () => {
    expect(plainText('<img src=x onerror="alert(1)">Crispy squid')).toBe('Crispy squid')
    expect(plainText('<script>alert(1)</script>Grilled kingklip')).not.toMatch(/</)
  })

  it.each([null, undefined, '', '   ', '<p></p>'])('has nothing to say for %s', (raw) => {
    expect(plainText(raw)).toBe('')
  })

  it('leaves plain text exactly as it is', () => {
    expect(plainText('Double shot, vanilla, a proper crema on top.')).toBe(
      'Double shot, vanilla, a proper crema on top.',
    )
  })
})
