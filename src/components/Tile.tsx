// Summary tiles used on tracker pages (Sales, Expense, Reports).
// A tile shows a big derived number with a small uppercase label; the `tone`
// tints the value the same way status chips are tinted.

type Tone = 'default' | 'ok' | 'warn' | 'bad' | 'accent';

const TONE_COLOR: Record<Tone, string> = {
  default: 'var(--ink)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  accent: 'var(--accent-deep)',
};

export function Tile({
  label,
  value,
  sub,
  tone = 'default',
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  /** makes the tile a button (e.g. click "Unbalanced" to jump to the offending rows) */
  onClick?: () => void;
  /** highlights the tile while its filter is on */
  active?: boolean;
}) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px', minWidth: 0,
        ...(onClick ? { cursor: 'pointer' } : {}),
        ...(active ? { outline: '2px solid var(--accent)', outlineOffset: '-1px' } : {}),
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div style={lbl}>{label}</div>
      <div className="mono" style={{ ...val, color: TONE_COLOR[tone] }}>{value}</div>
      {sub && <div style={subStyle}>{sub}</div>}
    </div>
  );
}

export function TileRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      {children}
    </div>
  );
}

const lbl: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  fontWeight: 600,
  marginBottom: 6,
};
const val: React.CSSProperties = { fontSize: 21, fontWeight: 600, lineHeight: 1.1 };
const subStyle: React.CSSProperties = { fontSize: 11, color: 'var(--faint)', marginTop: 4 };


