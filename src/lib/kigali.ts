// Kigali dates and times, fast.
//
// `new Date(x).toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' })`
// costs about 0.17 ms a call: a report that dates a few thousand trips
// a few dozen times froze the page for tens of seconds. Rwanda is UTC+2
// all year (no daylight saving), so the day and hour are plain arithmetic,
// and formatted text uses one cached Intl formatter per format.

const OFFSET = 2 * 3_600_000;
const ms = (x: string | number | Date | null | undefined): number =>
  x == null ? NaN : typeof x === 'number' ? x : x instanceof Date ? x.getTime() : Date.parse(x);

// YYYY-MM-DD in Kigali ('' for no or a bad date).
export function kigaliDay(x: string | number | Date | null | undefined): string {
  const t = ms(x);
  return Number.isNaN(t) ? '' : new Date(t + OFFSET).toISOString().slice(0, 10);
}
// 0-23 in Kigali (NaN for a bad date).
export function kigaliHour(x: string | number | Date): number {
  const t = ms(x);
  return Number.isNaN(t) ? NaN : new Date(t + OFFSET).getUTCHours();
}
export const kigaliToday = () => kigaliDay(Date.now());

const formatters = new Map<string, Intl.DateTimeFormat>();
// The same text as `new Date(x).toLocale…String(locale, { …opts, timeZone: 'Africa/Kigali' })`.
export function kFormat(x: string | number | Date, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const t = ms(x);
  if (Number.isNaN(t)) return 'Invalid Date';
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'Africa/Kigali' }); formatters.set(key, f); }
  return f.format(t);
}
