// Date helpers used by the standalone reimbursement workspace.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-04-12" or Date -> "12 Apr 26". */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mmm = MONTHS[date.getMonth()];
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd} ${mmm} ${yy}`;
}

/** ISO date string "YYYY-MM-DD" for <input type="date"> and inserts. */
export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Month key, "YYYY-MM". */
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-07" -> "Jul 2026". */
export function fmtMonth(m: string): string {
  const [y, mm] = m.split('-');
  const idx = Number(mm) - 1;
  return `${MONTHS[idx] ?? mm} ${y}`;
}

/** The last `count` month keys, newest first (for the payroll month picker). */
export function recentMonths(count = 12, from: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(monthKey(new Date(from.getFullYear(), from.getMonth() - i, 1)));
  }
  return out;
}


