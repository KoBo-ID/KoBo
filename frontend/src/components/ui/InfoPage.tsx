import React from 'react';

/** Reading page for Terms, Privacy and Contact: one narrow column, open sections divided by hairlines. */
export const InfoPage: React.FC<{ title: string; intro?: string; children: React.ReactNode }> = ({ title, intro, children }) => (
  <div className="app-container" style={{ maxWidth: '760px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
    <h1 className="page-title" style={{ fontSize: 'var(--step-3)' }}>{title}</h1>
    {intro && <p style={{ margin: '0.75rem 0 0', color: 'var(--text-muted)', fontSize: 'var(--step-0)', lineHeight: 1.65 }}>{intro}</p>}
    <div style={{ marginTop: '2rem' }}>{children}</div>
  </div>
);

export const InfoSection: React.FC<{ heading: string; children: React.ReactNode }> = ({ heading, children }) => (
  <section style={{ padding: '1.75rem 0', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
    <h2 style={{ margin: 0, fontSize: 'var(--step-1)', fontWeight: 700, color: 'var(--text-main)' }}>{heading}</h2>
    <div style={{ color: 'var(--text-main)', fontSize: 'var(--step-0)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>{children}</div>
  </section>
);

export const InfoList: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);
