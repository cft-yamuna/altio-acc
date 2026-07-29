export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 style={{ fontSize: 19 }}>{title}</h1>
        {subtitle && <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>
    </div>
  );
}
