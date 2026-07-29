// Tiny dependency-free CSV export. Amounts are exported as raw numbers (no ₹ /
// grouping) so they stay numeric in Excel/Sheets. A UTF-8 BOM is prepended so
// Excel reads accented/₹ text correctly.

export type CsvCell = string | number | null | undefined;

function esc(v: CsvCell): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  return lines.join('\r\n');
}

// Parse a CSV string into rows of fields. Handles quoted fields containing commas,
// newlines, and escaped quotes ("") — needed for the Razorpay reimbursement export.
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


