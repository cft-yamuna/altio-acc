// The single shared money formatter. Indian grouping, 2 decimals.
// e.g. 486000 -> "4,86,000.00"; with symbol -> "₹ 4,86,000.00".

const grouping = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inr(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (n == null || Number.isNaN(n)) return '0.00';
  return grouping.format(n);
}

export function inrSymbol(value: number | string | null | undefined): string {
  return `₹ ${inr(value)}`;
}

// Whole-rupee (no decimals), used on tiles: "₹ 8,50,000".
const groupingWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export function inrWhole(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (n == null || Number.isNaN(n)) return '₹ 0';
  return `₹ ${groupingWhole.format(n)}`;
}

// Never compare money with === 0. Balances are "zero" within half a paisa.
export function isZeroMoney(x: number): boolean {
  return Math.abs(x) < 0.005;
}

// Parse a typed money string ("7,20,000.00") to a number.
export function parseMoney(s: string): number {
  const cleaned = s.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}


