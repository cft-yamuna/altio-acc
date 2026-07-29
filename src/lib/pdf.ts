// Export tabular data to a real .pdf file that downloads straight away (no print dialog),
// mirroring csv.ts. Built on jsPDF + autotable; styled to the app's paper/sage theme.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CsvCell } from './csv';

// Right-align columns that read as money/numbers so they line up like the on-screen table.
function isNumeric(v: CsvCell): boolean {
  if (typeof v === 'number') return true;
  if (v == null || v === '') return false;
  const s = String(v).replace(/[₹,%\s]/g, '');
  return s !== '' && !Number.isNaN(Number(s));
}

export function exportPdf(
  title: string,
  headers: string[],
  rows: CsvCell[][],
  opts: { subtitle?: string } = {},
): void {
  // Landscape when there are many columns, so wide tables (yearly matrix) stay readable.
  const landscape = headers.length > 8;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(38, 51, 46);
  doc.text(title, marginX, 42);

  let subY = 58;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 105, 90);
  if (opts.subtitle) { doc.text(opts.subtitle, marginX, subY); subY += 12; }
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.text(`${rows.length} row${rows.length === 1 ? '' : 's'} · generated ${stamp}`, marginX, subY);

  // Columns that are numeric in every populated row get right-aligned.
  const numCols = headers.map((_, i) => rows.length > 0 && rows.every((r) => r[i] == null || r[i] === '' || isNumeric(r[i])));
  const columnStyles: Record<number, { halign: 'right' }> = {};
  numCols.forEach((isNum, i) => { if (isNum) columnStyles[i] = { halign: 'right' }; });

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => headers.map((_, i) => (r[i] == null ? '' : String(r[i])))),
    startY: subY + 12,
    margin: { left: marginX, right: marginX },
    tableWidth: pageW - marginX * 2,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, lineColor: [228, 223, 207], lineWidth: 0.5, textColor: [46, 44, 36] },
    headStyles: { fillColor: [237, 243, 232], textColor: [47, 107, 94], fontStyle: 'bold', fontSize: 8, lineColor: [204, 197, 176] },
    alternateRowStyles: { fillColor: [250, 249, 242] },
    columnStyles,
  });

  const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  doc.save(`${safe}.pdf`);
}


