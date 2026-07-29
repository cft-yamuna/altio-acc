// Date-range presets for the reports (month / quarter / financial-year close).
// A range is inclusive ISO dates; '' on either end means open.
import { toISODate } from './dates';

export type Preset = 'all' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'fy' | 'custom';
export type DateRange = { from: string; to: string };

/** The concrete [from,to] for a non-custom preset, relative to `now`. */
export function presetRange(preset: Exclude<Preset, 'custom'>, now: Date = new Date()): DateRange {
  if (preset === 'all') return { from: '', to: '' };
  const y = now.getFullYear();
  const m = now.getMonth(); // 0..11
  if (preset === 'week') {
    // Monday-start week through Sunday.
    const diffToMon = (now.getDay() + 6) % 7;
    const start = new Date(y, m, now.getDate() - diffToMon);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  if (preset === 'month') {
    return { from: toISODate(new Date(y, m, 1)), to: toISODate(new Date(y, m + 1, 0)) };
  }
  if (preset === 'lastMonth') {
    return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
  }
  if (preset === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { from: toISODate(new Date(y, qStart, 1)), to: toISODate(new Date(y, qStart + 3, 0)) };
  }
  if (preset === 'year') {
    // Calendar year: 1 Jan → 31 Dec.
    return { from: toISODate(new Date(y, 0, 1)), to: toISODate(new Date(y, 11, 31)) };
  }
  // financial year: 1 Apr → 31 Mar (matches the app's April-start FY)
  const startYear = m >= 3 ? y : y - 1; // month index 3 = April
  return { from: toISODate(new Date(startYear, 3, 1)), to: toISODate(new Date(startYear + 1, 2, 31)) };
}

/** True if a row's date falls within the range. Undated rows only pass an open ("all") range. */
export function inRange(date: string | null | undefined, range: DateRange): boolean {
  if (!date) return range.from === '' && range.to === '';
  const d = date.slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/** True if a "YYYY-MM" month key falls within the range (used by the monthly cashflow). */
export function monthInRange(month: string, range: DateRange): boolean {
  const mFrom = range.from ? range.from.slice(0, 7) : '';
  const mTo = range.to ? range.to.slice(0, 7) : '';
  if (mFrom && month < mFrom) return false;
  if (mTo && month > mTo) return false;
  return true;
}

/** Short human label for the active range, e.g. "01 Apr 26 – 30 Jun 26" or "all time". */
export function rangeLabel(range: DateRange): string {
  if (!range.from && !range.to) return 'all time';
  return `${range.from || '…'} → ${range.to || '…'}`;
}

/** True when the range actually narrows anything (used to show "filtered" hints). */
export function isOpenRange(range: DateRange): boolean {
  return !range.from && !range.to;
}


