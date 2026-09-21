import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext({
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {}
});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type, message, duration = 4000) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, type, message }]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
  }, [remove]);

  const success = useCallback((msg, dur) => add('success', msg, dur), [add]);
  const error = useCallback((msg, dur) => add('error', msg, dur), [add]);
  const info = useCallback((msg, dur) => add('info', msg, dur), [add]);

  return (
    <ToastContext.Provider value={{ show: add, success, error, info }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item ${t.type}`}>
            <div className="toast-icon">
              {t.type === 'success' && <CheckCircle2 size={18} />}
              {t.type === 'error' && <AlertCircle size={18} />}
              {t.type === 'info' && <Info size={18} />}
            </div>
            <div className="toast-message">{t.message}</div>
            <button className="toast-close" onClick={() => remove(t.id)} aria-label="Закрыть">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
