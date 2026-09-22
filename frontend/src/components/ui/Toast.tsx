import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '../../store/AppContext';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useAppStore();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 'var(--z-toast)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: '420px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const getIcon = () => {
          switch (toast.type) {
            case 'success':
              return <CheckCircle2 size={20} color="var(--status-paid)" />;
            case 'error':
              return <AlertCircle size={20} color="var(--status-overdue)" />;
            case 'warning':
              return <AlertTriangle size={20} color="var(--status-due)" />;
            default:
              return <Info size={20} color="var(--primary)" />;
          }
        };

        const getBorderColor = () => {
          switch (toast.type) {
            case 'success':
              return 'var(--status-paid-border)';
            case 'error':
              return 'var(--status-overdue-border)';
            case 'warning':
              return 'var(--status-due-border)';
            default:
              return 'var(--border-subtle)';
          }
        };

        return (
          <div
            key={toast.id}
            className="animate-slide-up"
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.875rem',
              padding: '0.875rem 1.125rem',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              border: `1px solid ${getBorderColor()}`,
              color: 'var(--text-main)',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ flexShrink: 0, display: 'flex' }}>{getIcon()}</span>
              <span>{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="interactive-tap"
              style={{
                color: 'var(--text-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.2rem',
                borderRadius: 'var(--radius-xs)',
              }}
              aria-label="Tutup notifikasi"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
