import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Root render error boundary so a runtime UI crash shows an Indonesian recovery
 * screen instead of a blank page, without adding heavy dependencies to the initial chunk.
 */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1rem',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            padding: '2rem 1.5rem',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 'var(--step-2)', fontWeight: 800, color: 'var(--text-main)' }}>
            Terjadi kesalahan tampilan
          </h1>
          <p
            style={{
              margin: '0.75rem 0 1.5rem',
              fontSize: 'var(--step--1)',
              color: 'var(--text-muted)',
              lineHeight: 1.55,
            }}
          >
            Maaf, halaman ini mengalami kendala saat ditampilkan. Muat ulang halaman atau kembali ke beranda untuk melanjutkan.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.625rem 1.25rem',
                fontSize: 'var(--step-0)',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                borderRadius: 'var(--radius-btn)',
                border: '1px solid transparent',
                backgroundColor: 'var(--primary)',
                color: 'var(--text-inverse)',
                boxShadow: 'var(--shadow-xs)',
                cursor: 'pointer',
              }}
            >
              Muat Ulang
            </button>
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.625rem 1.25rem',
                fontSize: 'var(--step-0)',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                borderRadius: 'var(--radius-btn)',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'transparent',
                color: 'var(--text-main)',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              Kembali ke Beranda
            </a>
          </div>
        </div>
      </div>
    );
  }
}
