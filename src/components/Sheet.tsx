// Inline spreadsheet cell primitives — editable cells that fill their <td>.
// Used by the Vendor Payables and Bank Statement spreadsheet grids.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type Option = { value: string; label: string };

// Enter moves to the next editable cell in the same row (like Tab), instead of
// submitting. On the last field it just blurs (commits). Buttons (Add / delete)
// are skipped, so a row is only added by clicking Add.
function focusNextInRow(el: HTMLElement) {
  const row = el.closest('tr');
  if (!row) { el.blur(); return; }
  const fields = Array.from(row.querySelectorAll<HTMLElement>('input, select, textarea, button.rate-cell-btn'));
  const next = fields[fields.indexOf(el) + 1];
  if (next) next.focus();
  else el.blur();
}

// Auto-grow a textarea to fit its content (so long text wraps to 2+ lines).
// Recomputes on value change AND on width change (column resize) — otherwise a narrower
// column reflows the text to more lines but the height stays stale and clips it.
function useAutoGrow(ref: { current: HTMLTextAreaElement | null }, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
    fit();
    // Refit only when the WIDTH changes (column resize); ignore the height changes our
    // own fit() causes, so the observer doesn't feed back on itself.
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, value]);
}

// Excel-style draggable column borders. Measures the header cells' natural widths
// once the table is ready, switches to fixed layout, and adds a drag handle to each
// header's right edge. `signature` re-initialises when the column set changes
// (e.g. switching bank-account kinds); it does NOT reset on row add/edit.
export function useResizableColumns(
  ref: { current: HTMLTableElement | null },
  ready: boolean,
  signature: string,
) {
  useEffect(() => {
    const table = ref.current;
    if (!table || !ready) return;
    const ths = Array.from(table.querySelectorAll<HTMLTableCellElement>(':scope > thead > tr > th'));
    if (ths.length === 0) return;

    // clear any handles/widths from a previous signature, measure natural widths
    table.querySelectorAll('.col-resize-handle').forEach((h) => h.remove());
    table.style.tableLayout = 'auto';
    table.style.width = '';
    ths.forEach((th) => { th.style.width = ''; });
    const widths = ths.map((th) => Math.ceil(th.getBoundingClientRect().width));
    table.style.tableLayout = 'fixed';
    table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
    ths.forEach((th, i) => { th.style.width = `${widths[i]}px`; });

    const cleanups: (() => void)[] = [];
    ths.forEach((th) => {
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      const down = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = th.offsetWidth;
        const startTableW = table.offsetWidth;
        let latestW = startW;
        let raf = 0;
        const apply = () => {
          raf = 0;
          // grow/shrink the table by the SAME delta so no space is redistributed
          th.style.width = `${latestW}px`;
          table.style.width = `${startTableW + (latestW - startW)}px`;
        };
        const move = (ev: MouseEvent) => {
          latestW = Math.max(48, startW + ev.clientX - startX);
          if (!raf) raf = requestAnimationFrame(apply);
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          if (raf) cancelAnimationFrame(raf);
          apply();
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.body.classList.remove('col-resizing');
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.body.classList.add('col-resizing');
      };

      handle.addEventListener('mousedown', down);
      cleanups.push(() => { handle.removeEventListener('mousedown', down); handle.remove(); });
    });
    return () => cleanups.forEach((c) => c());
  }, [ref, ready, signature]);
}

// ---- commit-on-blur cells (for editing EXISTING rows: one DB write per edit) ----
export function EditText({
  value,
  onCommit,
  mono,
  type = 'text',
  placeholder,
  wrap,
}: {
  value: string;
  onCommit: (v: string) => void;
  mono?: boolean;
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
  wrap?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(taRef, wrap ? v : '');

  if (wrap) {
    return (
      <textarea
        ref={taRef}
        rows={1}
        className={`sheet-input sheet-wraptext${mono ? ' mono' : ''}`}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== value) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
      />
    );
  }
  return (
    <input
      className={`sheet-input${mono ? ' mono' : ''}`}
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
    />
  );
}

export function EditSelect({
  value,
  options,
  onCommit,
  disabled,
}: {
  value: string;
  options: Option[];
  onCommit: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <select className="sheet-select" value={value} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// GST / TDS cell — one column instead of two. At rest it shows only the money;
// clicking it opens the rate list, and picking one drops straight back to the
// (now recomputed) money. Renders its own <td>.
export function RateCell({
  rate,
  options,
  amount,
  onCommit,
  readOnly,
  label,
}: {
  /** current rate as a plain number string, e.g. '18' */
  rate: string;
  options: Option[];
  /** already-formatted amount, e.g. inr(gstAmt) */
  amount: string;
  onCommit: (v: string) => void;
  readOnly?: boolean;
  /** used in the tooltip, e.g. 'GST' */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const blurTimer = useRef<number>(0);
  // a 0% line carries no money — dim it so real GST/TDS rows stand out
  const cls = `rate-cell-val${Number(rate) === 0 ? ' zero' : ''}`;

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 90) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); };
  }, [open]);

  if (readOnly) return <td className="rate-cell"><span className={`${cls} ro`} title={`${label ?? 'Rate'} ${rate}%`}>{amount}</span></td>;

  function openMenu() {
    setActive(Math.max(0, options.findIndex((o) => o.value === rate)));
    setOpen(true);
  }
  function choose(v: string) {
    window.clearTimeout(blurTimer.current);
    onCommit(v);
    setOpen(false);
    btnRef.current?.focus();
  }

  return (
    <td className="rate-cell">
      <button
        ref={btnRef}
        type="button"
        className={`rate-cell-btn${open ? ' open' : ''}`}
        title={`${label ?? 'Rate'} ${rate}% — click to change`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) openMenu(); else setActive((i) => Math.min(i + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(options[active].value); }
          else if (e.key === 'Enter' && !open) { e.preventDefault(); focusNextInRow(e.currentTarget); }
          else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
        }}
      >
        <span className={cls}>{amount}</span>
      </button>
      {open && rect && createPortal(
        <div className="sheet-combo-menu rate-menu" style={{ left: rect.left, top: rect.top, width: rect.width }}>
          {options.map((o, i) => (
            <div
              key={o.value}
              className={`sheet-combo-opt${i === active ? ' active' : ''}${o.value === rate ? ' picked' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(o.value); }}
            >
              {o.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </td>
  );
}

export function SheetText({
  value,
  onChange,
  placeholder,
  mono,
  type = 'text',
  wrap,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Accepted for compatibility; Enter now advances to the next field, not submit. */
  onEnter?: () => void;
  placeholder?: string;
  mono?: boolean;
  type?: 'text' | 'number' | 'date';
  wrap?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(taRef, wrap ? value : '');

  if (wrap) {
    return (
      <textarea
        ref={taRef}
        rows={1}
        className={`sheet-input sheet-wraptext${mono ? ' mono' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
      />
    );
  }
  return (
    <input
      className={`sheet-input${mono ? ' mono' : ''}`}
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNextInRow(e.currentTarget); } }}
    />
  );
}

export function SheetSelect({
  value,
  onChange,
  options,
  placeholder = '—',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select className="sheet-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// Searchable dropdown cell — type to filter a long list (e.g. employees). Works in both
// the add-row and when editing an existing row (commits on pick). The menu is rendered in
// a portal with fixed positioning so it never gets clipped by the scrolling sheet.
// A plain text input that also suggests known values in a themed dropdown. Unlike
// SheetCombo the typed text IS the value, so anything outside the list is still allowed
// (native <datalist> is unstyled by the browser, hence this).
export function SuggestInput({
  value,
  options,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number>(0);

  const q = value.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 200) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); };
  }, [open]);

  function choose(v: string) {
    window.clearTimeout(blurTimer.current);
    onChange(v);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        style={style}
        value={value}
        placeholder={placeholder}
        onFocus={() => { setActive(0); setOpen(true); }}
        onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true); }}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open && filtered[active]) { e.preventDefault(); choose(filtered[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
        }}
      />
      {open && rect && filtered.length > 0 && createPortal(
        <div className="sheet-combo-menu" style={{ left: rect.left, top: rect.top, width: rect.width }}>
          {filtered.map((o, i) => (
            <div
              key={o}
              className={`sheet-combo-opt${i === active ? ' active' : ''}${o === value ? ' picked' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
            >
              {o}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function SheetCombo({
  value,
  options,
  onChange,
  placeholder = '—',
  disabled,
  wrap,
  displayLabel,
  caret,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** show the selected label wrapped over multiple lines when idle, so a narrow
      column still reveals the full name (input overlays it while searching) */
  wrap?: boolean;
  /** text shown for the current selection when idle, instead of the option's own
      label — lets the dropdown list carry rich labels while the cell shows a short name */
  displayLabel?: string;
  /** show a small ▾ caret so the cell reads as an editable dropdown, not plain text */
  caret?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  // what the cell shows when not actively searching
  const idleLabel = displayLabel !== undefined ? displayLabel : selected?.label ?? '';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number>(0);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  // Offer a "Clear" row (value '') so a mis-picked cell can be emptied again. Only when
  // something is selected and you're not mid-search — so typing-then-Enter still picks the
  // first match rather than clearing. Prepended to the navigable list, so arrows/Enter work.
  const showClear = value !== '' && !q;
  const items: Option[] = showClear ? [{ value: '', label: '— Clear —' }, ...filtered] : filtered;

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 220) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); };
  }, [open]);

  function openMenu() { setQuery(''); setActive(0); setOpen(true); }
  function close() { setOpen(false); setQuery(''); }

  function choose(v: string, advance: boolean) {
    window.clearTimeout(blurTimer.current);
    onChange(v);
    close();
    if (advance && inputRef.current) focusNextInRow(inputRef.current);
    else inputRef.current?.blur();
  }

  const input = (
    <input
      ref={inputRef}
      className={`sheet-input${wrap ? ' combo-wrap-input' : ''}${caret && !wrap ? ' combo-has-caret' : ''}`}
      disabled={disabled}
      value={open ? query : idleLabel}
      placeholder={open ? selected?.label || 'type to search…' : (wrap ? '' : placeholder)}
      onFocus={openMenu}
      onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
      onBlur={() => { blurTimer.current = window.setTimeout(close, 120); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (open && items[active]) choose(items[active].value, true);
          else focusNextInRow(e.currentTarget);
        } else if (e.key === 'Escape') { e.preventDefault(); close(); }
      }}
    />
  );

  const menu = open && rect && createPortal(
    <div className="sheet-combo-menu" style={{ left: rect.left, top: rect.top, width: rect.width }}>
      {items.length === 0 ? (
        <div className="sheet-combo-empty">No matches</div>
      ) : (
        items.map((o, i) => (
          <div
            key={o.value === '' ? '__clear' : o.value}
            className={`sheet-combo-opt${i === active ? ' active' : ''}${o.value !== '' && o.value === value ? ' picked' : ''}`}
            style={o.value === '' ? { fontStyle: 'italic', color: 'var(--muted)' } : undefined}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => { e.preventDefault(); choose(o.value, false); }}
          >
            {o.label}
          </div>
        ))
      )}
    </div>,
    document.body,
  );

  // Wrap mode: the label sits in normal flow (wraps, so it grows the row and shows the
  // full name however narrow the column is); the input is layered on top — transparent
  // while idle, opaque once you focus to search. When open the label keeps its box
  // (visibility:hidden) so the row height doesn't collapse under the input.
  if (wrap) {
    return (
      <span className={`combo-wrap${open ? ' open' : ''}`}>
        <span className={`combo-wrap-text${idleLabel ? '' : ' ph'}`}>{idleLabel || placeholder}</span>
        {input}
        {menu}
      </span>
    );
  }

  if (caret) {
    return (
      <span className="combo-caret-wrap">
        {input}
        <span className="combo-caret" aria-hidden>▾</span>
        {menu}
      </span>
    );
  }

  return (
    <>
      {input}
      {menu}
    </>
  );
}


