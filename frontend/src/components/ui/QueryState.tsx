import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { Button } from './Button';

/** Failed request: Indonesian message and a retry button. Reserves vertical space like the content it replaces. */
export const ErrorState: React.FC<{ message: string; onRetry: () => void; minHeight?: string }> = ({
  message,
  onRetry,
  minHeight = '20rem',
}) => (
  <div
    role="alert"
    style={{
      minHeight,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
      textAlign: 'center',
      color: 'var(--text-muted)',
    }}
  >
    <span>{message}</span>
    <Button variant="outline" size="sm" onClick={onRetry}>
      Coba Lagi
    </Button>
  </div>
);

/** A record that does not exist (NOT_FOUND from the API). */
export const NotFoundState: React.FC<{ title: string; text: string; linkTo: string; linkLabel: string }> = ({
  title,
  text,
  linkTo,
  linkLabel,
}) => (
  <div
    className="app-container"
    style={{ paddingTop: '4rem', paddingBottom: '4rem', textAlign: 'center', minHeight: '50vh' }}
  >
    <SearchX size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
    <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{title}</h1>
    <p style={{ color: 'var(--text-muted)', margin: '0.5rem auto 1.5rem', maxWidth: '420px' }}>{text}</p>
    <Link to={linkTo}>
      <Button variant="primary" size="md">
        {linkLabel}
      </Button>
    </Link>
  </div>
);
