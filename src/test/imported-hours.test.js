import { hoursFromRows } from '../utils/importedHours'

const CURRENT = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekendStartsFriday: false,
  weekday: { start: '11:00', end: '23:00' },
  weekend: { start: '11:00', end: '23:00' },
  publicHoliday: { start: '11:00', end: '23:00' },
}

const row = (day_of_week, open_time, close_time) => ({ day_of_week, open_time, close_time })

describe('imported hours into the hours editor', () => {
  it('applies a plain weekday/weekend week, so the hours shown are the hours saved', () => {
    const rows = [
      ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => row(d, '12:00:00', '22:00:00')),
      row('Saturday', '10:00:00', '23:30:00'),
      row('Sunday', '10:00:00', '23:30:00'),
    ]
    expect(hoursFromRows(rows, CURRENT)).toEqual({
      ...CURRENT,
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      weekendStartsFriday: false,
      weekday: { start: '12:00', end: '22:00' },
      weekend: { start: '10:00', end: '23:30' },
    })
  })

  it('recognises a weekend that starts on Friday', () => {
    const rows = [
      ...['Tuesday', 'Wednesday', 'Thursday'].map((d) => row(d, '17:00:00', '23:00:00')),
      ...['Friday', 'Saturday'].map((d) => row(d, '17:00:00', '02:00:00')),
    ]
    const fitted = hoursFromRows(rows, CURRENT)
    expect(fitted.weekendStartsFriday).toBe(true)
    expect(fitted.days).toEqual(['tue', 'wed', 'thu', 'fri', 'sat'])
    expect(fitted.weekend).toEqual({ start: '17:00', end: '02:00' })
  })

  it('keeps the current weekend range when the venue is closed at weekends', () => {
    const rows = ['Monday', 'Tuesday'].map((d) => row(d, '8:00:00', '16:00:00'))
    const fitted = hoursFromRows(rows, CURRENT)
    expect(fitted.days).toEqual(['mon', 'tue'])
    expect(fitted.weekday).toEqual({ start: '08:00', end: '16:00' })
    expect(fitted.weekend).toEqual(CURRENT.weekend)
  })

  it('refuses split shifts rather than keeping half of them', () => {
    const rows = [row('Monday', '12:00:00', '15:00:00'), row('Monday', '18:00:00', '22:00:00')]
    expect(hoursFromRows(rows, CURRENT)).toBeNull()
  })

  it('refuses a week the editor cannot hold', () => {
    const rows = [
      row('Monday', '12:00:00', '22:00:00'),
      row('Wednesday', '09:00:00', '17:00:00'),
      row('Saturday', '10:00:00', '23:00:00'),
    ]
    expect(hoursFromRows(rows, CURRENT)).toBeNull()
  })

  it('gives nothing for nothing', () => {
    expect(hoursFromRows([], CURRENT)).toBeNull()
    expect(hoursFromRows(null, CURRENT)).toBeNull()
    expect(hoursFromRows([row('Funday', '1:00', '2:00')], CURRENT)).toBeNull()
  })
})
