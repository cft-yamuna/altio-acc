// App-wide confirm dialog: replaces the browser's plain window.confirm() with a styled
// in-app modal. useConfirm() returns a function you await — it resolves true/false.
//
//   const confirm = useConfirm();
//   if (await confirm({ message: 'Delete this?', danger: true })) remove();
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

export type ConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false),
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          title={opts.title ?? 'Please confirm'}
          onClose={() => finish(false)}
          width={420}
          footer={
            <>
              <button className="btn" onClick={() => finish(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
              <button
                className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => finish(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--txt)' }}>{opts.message}</div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}


