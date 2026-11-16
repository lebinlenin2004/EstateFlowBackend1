import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(utc)
dayjs.extend(timezone)

/** Start and end of the calendar day containing `ref`, in the organization's timezone, as real instants. */
export function dayBounds(tz, ref = new Date()) {
  const d = dayjs(ref).tz(tz)
  return { start: d.startOf('day').toDate(), end: d.endOf('day').toDate() }
}
export const MINUTE = 60 * 1000
