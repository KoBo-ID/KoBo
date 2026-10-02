import React from 'react';

/** Centered card for the full-page auth outcomes (reset password, email verification). */
export const AuthCard: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="app-container" style={{ paddingTop: '4rem', paddingBottom: '4rem', display: 'flex', justifyContent: 'center' }}>
    <div
      style={{
        width: '100%',
        maxWidth: '440px',
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-sm)',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        textAlign: 'center',
        alignItems: 'center',
      }}
    >
      {icon}
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</h1>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>{children}</div>
    </div>
  </div>
);
