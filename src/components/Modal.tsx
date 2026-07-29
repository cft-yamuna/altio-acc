import { type ReactNode, useEffect } from 'react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div className="card" style={{ ...panel, width }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={head}>
          <h3 style={{ fontSize: 16 }}>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
        {footer && <div style={foot}>{footer}</div>}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(38,51,46,0.42)',
  display: 'grid',
  placeItems: 'center',
  // Above the detail drawer (55) and the portalled sheet menus (combo 60, column filter 70)
  // so a confirm dialog opened from inside a drawer sits on top, not behind it.
  zIndex: 80,
  padding: 20,
};
const panel: React.CSSProperties = { maxHeight: '90vh', overflow: 'auto' };
const head: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--line)',
};
const foot: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '14px 20px',
  borderTop: '1px solid var(--line)',
};


