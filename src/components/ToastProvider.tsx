import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Toast, type ToastVariant } from "lojee-ui";

type Show = (message: string, variant?: ToastVariant) => void;

const ToastContext = createContext<Show>(() => {});

/** No-op outside a provider, so components stay testable in isolation. */
export const useToast = (): Show => useContext(ToastContext);

interface ToastState {
  open: boolean;
  message: string;
  variant: ToastVariant;
  key: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ open: false, message: "", variant: "success", key: 0 });
  const show = useCallback<Show>((message, variant = "success") => {
    setToast((t) => ({ open: true, message, variant, key: t.key + 1 }));
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast
        key={toast.key}
        open={toast.open}
        variant={toast.variant}
        duration={4000}
        position="bottom-right"
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      >
        {toast.message}
      </Toast>
    </ToastContext.Provider>
  );
}
