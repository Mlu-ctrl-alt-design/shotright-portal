/**
 * Frappe's Time format, and the two bugs that came from guessing at it.
 *
 * Both were invisible for as long as the fake bench said `"17:00"` — a shape
 * the real bench never sends, and one with nothing to trip over. The fixture
 * now carries a single-digit hour, and these are the assertions that pin the
 * behaviour it exposed.
 */
import { describe, expect, it } from 'vitest'
import { formatTime, minutesSinceMidnight, toTimeInput } from '../utils/time'

describe('reading a time off the bench', () => {
  /* `str(timedelta(hours=9))` is "9:00:00" — the minutes are padded and the
     hour is not. Taking the first five characters gives "9:00:", which an
     <input type="time"> cannot parse and therefore renders as empty. */
  it('pads the hour Frappe leaves unpadded', () => {
    expect(toTimeInput('9:00:00')).toBe('09:00')
    expect(formatTime('9:00:00')).toBe('09:00')
  })

  it.each([
    ['09:00:00', '09:00'],
    ['9:00:00', '09:00'],
    ['9:00', '09:00'],
    ['09:00', '09:00'],
    ['17:30:00', '17:30'],
    ['0:05:00', '00:05'],
  ])('reads %s as %s', (raw, expected) => {
    expect(toTimeInput(raw)).toBe(expected)
  })

  /* An <input type="time"> given anything it cannot parse silently shows
     nothing, so "no value" has to be the empty string and not a dash. */
  it.each([null, undefined, '', 'closed', 'not a time'])('has no value for %s', (raw) => {
    expect(toTimeInput(raw)).toBe('')
  })

  it('reads as a dash where it is being displayed rather than edited', () => {
    expect(formatTime(null)).toBe('—')
  })
})

describe('comparing two times', () => {
  /**
   * The save-blocker. `"9:00:00" >= "23:00:00"` is TRUE as a string compare,
   * because "9" sorts after "2" — so a venue open nine till eleven was told
   * its closing time came first, and could not be saved at all.
   */
  it('does not think nine in the morning is after eleven at night', () => {
    expect('9:00:00' >= '23:00:00').toBe(true) // the bug, stated plainly
    expect(minutesSinceMidnight('9:00:00')).toBeLessThan(minutesSinceMidnight('23:00:00'))
  })

  it.each([
    ['8:00:00', '22:00:00'],
    ['9:00:00', '17:00:00'],
    ['7:30:00', '15:00:00'],
  ])('opens at %s and closes at %s, in that order', (open, close) => {
    expect(minutesSinceMidnight(open)).toBeLessThan(minutesSinceMidnight(close))
  })

  it('still catches hours that really are backwards', () => {
    expect(minutesSinceMidnight('22:00:00')).toBeGreaterThan(minutesSinceMidnight('9:00:00'))
  })

  /* A timedelta can hold more than 24 hours for a bar closing at 1am. The
     comparison must NOT wrap, or "closes at 25:00" reads as "closes at 01:00"
     and the venue is refused for closing before it opens. */
  it('lets a venue close after midnight', () => {
    expect(minutesSinceMidnight('25:00:00')).toBeGreaterThan(minutesSinceMidnight('17:00:00'))
  })

  /* The clock face is the other way round: 25:00 is not a thing an
     <input type="time"> or a door can show. */
  it('but shows that closing time as one o’clock', () => {
    expect(toTimeInput('25:00:00')).toBe('01:00')
  })

  it('says nothing rather than something wrong about a value it cannot read', () => {
    expect(minutesSinceMidnight('closed')).toBeNull()
  })
})
