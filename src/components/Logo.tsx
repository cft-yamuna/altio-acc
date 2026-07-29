export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`altio-logo-frame${compact ? ' altio-logo-frame-compact' : ''}`}>
      <img className="altio-logo" src="/altio-logo.png" alt="Altio AI" />
    </div>
  );
}
